import { useState } from 'react'

/** タブと同じタイトルが先頭 # で重複する場合、レンダー時のみ省略 */
function markdownForRenderedPreview(md: string, sheetTitle: string | undefined, hasTabs: boolean): string {
  if (!hasTabs || !sheetTitle) return md
  const lines = md.split('\n')
  const first = lines[0]?.trim()
  if (first === `# ${sheetTitle.trim()}`) {
    return lines.slice(1).join('\n').replace(/^\n+/, '')
  }
  return md
}

export interface PreviewSheet {
  name: string
  markdown: string
}

interface Props {
  sheets: PreviewSheet[]
  activeName: string | null
  onActiveNameChange: (name: string) => void
  onMarkdownChange?: (sheetName: string, markdown: string) => void
}

export default function MarkdownPreview({
  sheets,
  activeName,
  onActiveNameChange,
  onMarkdownChange,
}: Props) {
  const [showPreview, setShowPreview] = useState(false)

  const active = sheets.find((s) => s.name === activeName) ?? sheets[0]
  const text = active?.markdown ?? ''
  const hasTabs = sheets.length > 1
  const renderedMd = markdownForRenderedPreview(text, active?.name, hasTabs)

  if (sheets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/80 p-8 text-center text-sm text-gray-500">
        出力対象のシートを1つ以上選ぶと、ここにプレビューが表示されます。
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-brand-800">プレビュー（Markdown）</span>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs text-brand-700 underline hover:text-brand-800"
        >
          {showPreview ? 'テキスト表示に戻す' : 'プレビュー表示（レンダリング）'}
        </button>
      </div>

      {sheets.length > 1 && (
        <div
          className="-mx-1 flex gap-1 overflow-x-auto pb-1"
          role="tablist"
          aria-label="シートを切り替え"
        >
          {sheets.map((s) => {
            const isActive = s.name === active?.name
            return (
              <button
                key={s.name}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onActiveNameChange(s.name)}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50'
                }`}
              >
                <span className="max-w-[min(20rem,28vw)] truncate block">{s.name}</span>
              </button>
            )
          })}
        </div>
      )}

      <div
        title="下辺をドラッグして高さを変更できます"
        className="flex min-h-[14rem] max-h-[min(90vh,56rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white resize-y"
        style={{ height: 'min(38rem, 52vh)' }}
      >
        {showPreview ? (
          <div
            className="preview-area min-h-0 flex-1 overflow-auto p-4 text-sm leading-relaxed text-gray-800"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(renderedMd) }}
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => active && onMarkdownChange?.(active.name, e.target.value)}
            className="preview-area box-border min-h-0 w-full flex-1 resize-none border-0 bg-white p-4 font-mono text-xs text-gray-800 focus:outline-none focus:ring-0"
            aria-label={sheets.length > 1 ? `${active?.name} の Markdown` : 'Markdown ソース'}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}

/** 簡易 Markdown → HTML 変換（外部ライブラリ不使用） */
function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-1.5">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-0 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 rounded text-xs">$1</code>')
    .replace(/^\| (.+) \|$/gm, (line) => {
      if (/^\|[\s-|]+\|$/.test(line)) return ''
      const cells = line.slice(1, -1).split('|').map((c) => {
        const inner = c.trim().replace(/&lt;br\s*\/?&gt;/gi, '<br>')
        return `<td class="border px-2 py-1">${inner}</td>`
      })
      return `<tr>${cells.join('')}</tr>`
    })
    .replace(/(<tr>.*<\/tr>)/gs, '<table class="my-2 border-collapse text-xs">$1</table>')
    .replace(/^- (.+)$/gm, '<li data-md="ul">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li data-md="ol">$2</li>')

  // ソースの空行を <br> にしない（見出しの margin と二重にならないようタグ間の空白のみ除去）
  html = html.replace(/>(?:\s*\n\s*)+</g, '><')
  html = html.replace(/(?:<li data-md="ul">[\s\S]*?<\/li>)+/g, (block) => {
    const inner = block.replace(/ data-md="ul"/g, '')
    return `<ul class="my-1.5 ml-4 list-disc space-y-0.5 pl-5">${inner}</ul>`
  })
  html = html.replace(/(?:<li data-md="ol">[\s\S]*?<\/li>)+/g, (block) => {
    const inner = block.replace(/ data-md="ol"/g, '')
    return `<ol class="my-1.5 ml-4 list-decimal space-y-0.5 pl-5">${inner}</ol>`
  })

  return html.trim()
}
