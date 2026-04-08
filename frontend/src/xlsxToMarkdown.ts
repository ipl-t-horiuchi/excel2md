import * as XLSX from 'xlsx'

export interface SheetMarkdown {
  name: string
  markdown: string
}

interface LogicalCell {
  c: number
  val: string
  colSpan: number
  rowSpan: number
}

interface LogicalRow {
  r: number
  cells: LogicalCell[]
}

interface Block {
  rows: LogicalRow[]
  title?: string
}

interface SubTable {
  titleRow: LogicalRow | null
  bodyRows: LogicalRow[]
}

// ---- ユーティリティ ----

const escapeCell = (s: unknown): string =>
  String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** 表セル用: 改行は Markdown 表で行を壊さないよう HTML の改行にする（GFM と整合） */
const escapeTableCell = (s: unknown): string =>
  String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')

const trimEmptyColumns = (grid: string[][]): string[][] => {
  if (grid.length === 0) return grid
  const colCount = grid[0].length
  let start = 0
  let end = colCount - 1
  while (start <= end && grid.every(row => !row[start])) start++
  while (end >= start && grid.every(row => !row[end])) end--
  if (start > end) return [[]]
  return grid.map(row => row.slice(start, end + 1))
}

const trimColumnsWithEmptyHeader = (grid: string[][]): string[][] => {
  if (grid.length < 2) return grid
  const header = grid[0]
  const hasData = (v: string) => v !== '' && String(v).trim() !== ''
  const keepCols = header.map((v, i) =>
    hasData(v) || grid.some((row, ri) => ri > 0 && hasData(row[i]))
  )
  if (keepCols.every(Boolean)) return grid
  return grid.map(row => row.filter((_, i) => keepCols[i]))
}

// ---- ブロック/テーブル判定ヘルパー ----

/**
 * セクション見出し行の判定（構造のみ・名称ハードコードなし）
 * - 番号付き見出し (5)... → 確定
 * - colSpan >= 3 の幅広結合 → 確定
 * - 直後がテーブルヘッダー行 → 見出しと判断
 */
const isSectionTitleRow = (row: LogicalRow, nextRow?: LogicalRow): boolean => {
  const nonEmpty = row.cells.filter(c => c.val !== '')
  if (nonEmpty.length !== 1) return false
  const { val, colSpan = 1 } = nonEmpty[0]
  const valStr = String(val).trim()
  if (!valStr || /^\d+$/.test(valStr)) return false
  if (/^\(\d+(?:-\d+)*\)/.test(valStr)) return true
  if (colSpan >= 3) return true
  if (nextRow) {
    const nextNonEmpty = nextRow.cells.filter(c => c.val !== '')
    if (nextNonEmpty.length >= 2 && !/^\d+$/.test(String(nextNonEmpty[0].val).trim())) return true
  }
  return false
}

const isStandaloneNoteRow = (row: LogicalRow): boolean => {
  const nonEmpty = row.cells.filter(c => c.val !== '')
  if (nonEmpty.length !== 1) return false
  return String(nonEmpty[0].val).trim().startsWith('※')
}

const isTableBlock = (block: Block): boolean => {
  if (block.rows.some((row, i) => isSectionTitleRow(row, block.rows[i + 1]))) return true
  if (block.rows.length < 2) return false
  const byCount: Record<number, number> = {}
  for (const r of block.rows) {
    const n = r.cells.length
    if (n >= 3) byCount[n] = (byCount[n] || 0) + 1
  }
  return Object.values(byCount).some(n => n >= 2)
}

const blockToKeyValueList = (block: Block): { sectionTitle: string; pairs: { k: string; v: string }[] } => {
  const pairs: { k: string; v: string }[] = []
  let sectionTitle = ''
  block.rows.forEach((row, ri) => {
    const vals = row.cells.map(c => c.val)
    if (ri === 0 && vals.length >= 3 && vals[0] && vals[1] && vals[2]) {
      sectionTitle = vals[0]
      pairs.push({ k: vals[1], v: vals[2] })
      for (let i = 4; i < vals.length - 1; i += 2) {
        const k = vals[i], v = vals[i + 1]
        if (k) pairs.push({ k, v: v ?? '' })
      }
    } else {
      for (let i = 0; i < vals.length - 1; i += 2) {
        const k = vals[i], v = vals[i + 1]
        if (k) pairs.push({ k, v: v ?? '' })
      }
    }
  })
  return { sectionTitle, pairs }
}

/**
 * ブロック分割（行間ギャップ or セクション見出し行で区切る）
 */
const detectBlocks = (rows: LogicalRow[]): Block[] => {
  const blocks: Block[] = []
  let current: LogicalRow[] = []
  let lastR = -2
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowGap = lastR >= 0 && row.r - lastR > 1
    const isTitle = isSectionTitleRow(row, rows[i + 1])
    if ((rowGap || isTitle) && current.length > 0) {
      blocks.push({ rows: [...current] })
      current = []
    }
    current.push(row)
    lastR = row.r
  }
  if (current.length) blocks.push({ rows: current })
  return blocks
}

/**
 * ブロック内をセクション見出し行でサブテーブルに分割
 */
const splitToSubTables = (rows: LogicalRow[]): SubTable[] => {
  const result: SubTable[] = []
  let titleRow: LogicalRow | null = null
  let bodyRows: LogicalRow[] = []
  const flush = () => {
    if (bodyRows.length > 0 || titleRow) {
      result.push({ titleRow, bodyRows: [...bodyRows] })
    }
    titleRow = null
    bodyRows = []
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (isSectionTitleRow(row, rows[i + 1])) {
      flush()
      titleRow = row
    } else {
      bodyRows.push(row)
    }
  }
  flush()
  return result
}

const getValAtCol = (row: LogicalRow, colIdx: number): string => {
  const cell = row.cells.find(c => colIdx >= c.c && colIdx < c.c + (c.colSpan || 1))
  return cell ? cell.val : ''
}

// ---- メイン変換関数 ----

export function convertXlsxToMarkdown(buffer: ArrayBuffer, _fileName?: string): SheetMarkdown[] {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellStyles: true,
    cellNF: true,
    cellText: true,
  })

  const results: SheetMarkdown[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const merges: XLSX.Range[] = (sheet['!merges'] as XLSX.Range[] | undefined) || []
    const ref = sheet['!ref']
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)

    const formatCellValue = (r: number, c: number): string => {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = sheet[addr] as XLSX.CellObject | undefined
      if (!cell) return ''
      const v = cell.v
      const z = (cell.z as string) || ''
      if (v == null) return ''
      if (typeof v === 'number' && v >= 10000 && v < 100000 && /[dDyYmM]/.test(z)) {
        try {
          // XLSX.SSF は型定義にないため unknown キャスト
          const ssfMod = (XLSX as unknown as { SSF?: { parse_date_code?: (v: number) => { y: number; m: number; d: number } | null } }).SSF
          const d = ssfMod?.parse_date_code?.(v)
          if (d && d.y) {
            const y = d.y < 100 ? 1900 + d.y : d.y
            return `${y}/${d.m}/${d.d}`
          }
        } catch { /* ignore */ }
      }
      if (cell.w) return String(cell.w).trim()
      return String(v).trim()
    }

    const getMergeAt = (r: number, c: number): XLSX.Range | undefined =>
      merges.find(m => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c)

    const logicalValue = (r: number, c: number, useOwnCellIfUnderMerge = false): string => {
      const m = getMergeAt(r, c)
      if (useOwnCellIfUnderMerge && m && m.s.r < r) {
        return formatCellValue(r, c)
      }
      const sr = m ? m.s.r : r
      const sc = m ? m.s.c : c
      return formatCellValue(sr, sc)
    }

    // 論理セル行の構築（colspan/rowspan 正規化）
    const logicalCells: LogicalRow[] = []
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: LogicalCell[] = []
      for (let c = range.s.c; c <= range.e.c;) {
        const m = getMergeAt(r, c)
        const isTopLeft = !m || (m.s.r === r && m.s.c === c)
        const isUnderRowspan = !!m && m.s.r < r
        if (!isTopLeft && !isUnderRowspan) { c = m!.e.c + 1; continue }
        const val = logicalValue(r, c, true)
        const colSpan = isUnderRowspan ? 1 : (m ? m.e.c - m.s.c + 1 : 1)
        const rowSpan = isUnderRowspan ? 1 : (m ? m.e.r - m.s.r + 1 : 1)
        row.push({ c, val, colSpan, rowSpan })
        c = isUnderRowspan ? c + 1 : (m ? m.e.c + 1 : c + 1)
      }
      if (row.length) logicalCells.push({ r, cells: row })
    }

    // 完全空行・Excel方眼紙余白行を除外
    const isFillerRow = (row: LogicalRow): boolean => {
      const allEmpty = row.cells.every(c => c.val === '')
      const manySingle = row.cells.length >= 15 && row.cells.every(c => c.colSpan === 1 && c.rowSpan === 1)
      return allEmpty && (manySingle || row.cells.length >= 20)
    }
    const filteredRows = logicalCells.filter(row =>
      !row.cells.every(c => c.val === '') && !isFillerRow(row)
    )

    const blocks = detectBlocks(filteredRows)

    const mdParts: string[] = []
    mdParts.push(`# ${sheetName}\n`)

    /** シート名と同一の見出しは # で既に出しているため ## を省略 */
    const isDuplicateOfSheetTitle = (t: string) =>
      String(t).trim() === String(sheetName).trim()

    for (const block of blocks) {
      const blockTitle = block.title || null
      if (blockTitle && !isDuplicateOfSheetTitle(blockTitle)) {
        mdParts.push(`## ${escapeCell(blockTitle)}\n\n`)
      }

      if (isTableBlock(block)) {
        for (const { titleRow, bodyRows } of splitToSubTables(block.rows)) {
          if (!blockTitle) {
            const titleVal = titleRow
              ? String(titleRow.cells.find(c => c.val !== '')?.val ?? '').trim()
              : null
            if (titleVal && !isDuplicateOfSheetTitle(titleVal)) {
              mdParts.push(`## ${escapeCell(titleVal)}\n\n`)
            }
          }

          if (bodyRows.length === 0) continue

          const noteRows = bodyRows.filter(isStandaloneNoteRow)
          const tableCandidateRows = bodyRows.filter(r => !isStandaloneNoteRow(r))
          if (tableCandidateRows.length === 0) {
            for (const noteRow of noteRows) {
              const note = String(noteRow.cells.find(c => c.val !== '')?.val ?? '').trim()
              if (note) mdParts.push(`${escapeCell(note)}\n`)
            }
            if (noteRows.length) mdParts.push('\n')
            continue
          }

          // ヘッダー行判定（先頭非空セルが非数値なら見出し行）
          const nonEmptyFirst = tableCandidateRows[0].cells.filter(c => c.val !== '')
          const hasHeaderRow = nonEmptyFirst.length >= 2
            && !/^\d+$/.test(String(nonEmptyFirst[0].val).trim())
          const headerRow = hasHeaderRow ? tableCandidateRows[0] : null
          const dataRows = (hasHeaderRow ? tableCandidateRows.slice(1) : tableCandidateRows)
            .filter(r => r.cells.some(c => c.val !== ''))

          const colIndices = (() => {
            if (headerRow) {
              return headerRow.cells.filter(c => c.val !== '').map(c => c.c)
            }
            if (dataRows.length > 0) {
              return [...new Set(dataRows.flatMap(r => r.cells.map(c => c.c)))].sort((a, b) => a - b)
            }
            return tableCandidateRows[0].cells.map(c => c.c)
          })()
          if (colIndices.length === 0) continue

          const effectiveRows = headerRow ? [headerRow, ...dataRows] : dataRows
          const grid = effectiveRows.map(row => colIndices.map(ci => getValAtCol(row, ci)))
          let trimmed = trimEmptyColumns(grid)
          trimmed = trimColumnsWithEmptyHeader(trimmed)

          if (trimmed.length > 0 && trimmed[0].length > 0) {
            const lines = trimmed.map(row => '| ' + row.map(c => escapeTableCell(c)).join(' | ') + ' |')
            const sep = '| ' + trimmed[0].map(() => '---').join(' | ') + ' |'
            mdParts.push(lines[0] + '\n' + sep + '\n' + lines.slice(1).join('\n') + '\n')
          }
          for (const noteRow of noteRows) {
            const note = String(noteRow.cells.find(c => c.val !== '')?.val ?? '').trim()
            if (note) mdParts.push(`${escapeCell(note)}\n`)
          }
          if (noteRows.length) mdParts.push('\n')
        }
      } else {
        const { sectionTitle, pairs } = blockToKeyValueList(block)
        if (!blockTitle && sectionTitle && !isDuplicateOfSheetTitle(sectionTitle)) {
          mdParts.push(`## ${escapeCell(sectionTitle)}\n\n`)
        }
        for (const { k, v } of pairs) mdParts.push(`- **${escapeCell(k)}**: ${escapeCell(v)}\n`)
        mdParts.push('\n')
      }
    }

    results.push({ name: sheetName, markdown: mdParts.join('') })
  }

  return results
}
