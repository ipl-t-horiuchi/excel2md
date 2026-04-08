import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FileDropzone from './components/FileDropzone'
import SheetTable from './components/SheetTable'
import MarkdownPreview from './components/MarkdownPreview'
import ActionButton from './components/ActionButton'
import {
  requestPresignedUrl,
  uploadToS3,
  requestReconvert,
  requestReconvertCancel,
  checkReconvertStatus,
  fetchReconvertResult,
} from './api'
import { convertXlsxToMarkdown } from './xlsxToMarkdown'
import type { SheetResult } from './types'

type Phase = 'idle' | 'converting' | 'done' | 'error'
type ReconvertPhase = 'idle' | 'uploading' | 'processing' | 'error'

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<SheetResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** true のとき、選択シートを1ファイルに結合してダウンロード／コピー */
  const [mergeDownload, setMergeDownload] = useState(false)
  const [previewSheetName, setPreviewSheetName] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [reconvertPhase, setReconvertPhase] = useState<ReconvertPhase>('idle')
  const [reconvertErrorMsg, setReconvertErrorMsg] = useState('')
  const [aiConvertedNames, setAiConvertedNames] = useState<Set<string>>(new Set())

  const reconvertPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconvertAbortRef = useRef<AbortController | null>(null)
  const currentReconvertIdRef = useRef<string | null>(null)
  const currentFileRef = useRef<File | null>(null)

  const clearReconvertTimer = useCallback(() => {
    if (reconvertPollRef.current) clearTimeout(reconvertPollRef.current)
    reconvertPollRef.current = null
  }, [])

  const cancelReconvert = useCallback(async () => {
    const rid = currentReconvertIdRef.current
    clearReconvertTimer()
    if (rid) {
      try {
        await requestReconvertCancel(rid)
      } catch {
        /* サーバーに届かなくてもクライアントは中断する */
      }
      currentReconvertIdRef.current = null
    }
    reconvertAbortRef.current?.abort()
    reconvertAbortRef.current = null
    setReconvertPhase('idle')
  }, [clearReconvertTimer])

  useEffect(
    () => () => {
      clearReconvertTimer()
      reconvertAbortRef.current?.abort()
      reconvertAbortRef.current = null
    },
    [clearReconvertTimer],
  )

  const selectedSheetsOrdered = useMemo(
    () => sheets.filter((s) => selected.has(s.name)),
    [sheets, selected],
  )

  useEffect(() => {
    if (selectedSheetsOrdered.length === 0) {
      setPreviewSheetName(null)
      return
    }
    setPreviewSheetName((prev) => {
      if (prev && selectedSheetsOrdered.some((s) => s.name === prev)) return prev
      return selectedSheetsOrdered[0].name
    })
  }, [selectedSheetsOrdered])

  const combinedMarkdown = useMemo(
    () =>
      selectedSheetsOrdered
        .map((s) => `## シート: ${s.name}\n\n${s.markdown}`)
        .join('\n\n---\n\n'),
    [selectedSheetsOrdered],
  )

  const hasSelection = selected.size > 0
  const aiBusy = reconvertPhase === 'uploading' || reconvertPhase === 'processing'

  const handleFile = useCallback(async (file: File) => {
    clearReconvertTimer()
    reconvertAbortRef.current?.abort()
    reconvertAbortRef.current = null
    currentReconvertIdRef.current = null
    currentFileRef.current = file
    setFileName(file.name)
    setPhase('converting')
    setSheets([])
    setSelected(new Set())
    setPreviewSheetName(null)
    setErrorMsg('')
    setReconvertPhase('idle')
    setReconvertErrorMsg('')
    setAiConvertedNames(new Set())
    setMergeDownload(false)

    try {
      // 先にローディングUIを描画してから重い変換処理を開始する
      await waitForNextPaint()
      const buffer = await file.arrayBuffer()
      await waitForNextPaint()
      const results = convertXlsxToMarkdown(buffer, file.name)
      const sheetResults: SheetResult[] = results.map((s) => ({
        name: s.name,
        markdown: s.markdown,
        aiConverted: false,
      }))
      setSheets(sheetResults)
      setSelected(new Set(sheetResults.map((s) => s.name)))
      setPhase('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '変換中にエラーが発生しました')
      setPhase('error')
    }
  }, [clearReconvertTimer])

  const handleReconvert = useCallback(
    async (sheetNames: string[]) => {
      const file = currentFileRef.current
      if (!file) return
      clearReconvertTimer()
      reconvertAbortRef.current?.abort()
      currentReconvertIdRef.current = null
      const ac = new AbortController()
      reconvertAbortRef.current = ac
      const { signal } = ac

      setReconvertPhase('uploading')
      setReconvertErrorMsg('')

      const isAbort = (e: unknown) =>
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError')

      try {
        const { uploadUrl, jobId } = await requestPresignedUrl(signal)
        if (signal.aborted) return
        await uploadToS3(uploadUrl, file, signal)
        if (signal.aborted) return

        setReconvertPhase('processing')
        const { reconvertId } = await requestReconvert(jobId, sheetNames, signal)
        if (signal.aborted) return
        currentReconvertIdRef.current = reconvertId

        const poll = async () => {
          if (signal.aborted) return
          try {
            const result = await checkReconvertStatus(reconvertId, signal)
            if (signal.aborted) return
            if (result.status === 'done' && result.downloadUrl) {
              clearReconvertTimer()
              const aiSheets = await fetchReconvertResult(result.downloadUrl, signal)
              if (signal.aborted) return
              const aiMap = new Map(aiSheets.map((s) => [s.name, s.markdown]))
              setSheets((prev) =>
                prev.map((s) =>
                  aiMap.has(s.name) ? { ...s, markdown: aiMap.get(s.name)!, aiConverted: true } : s,
                ),
              )
              setAiConvertedNames((prev) => {
                const next = new Set(prev)
                sheetNames.forEach((n) => next.add(n))
                return next
              })
              setReconvertPhase('idle')
              reconvertAbortRef.current = null
              currentReconvertIdRef.current = null
            } else if (result.status === 'error') {
              clearReconvertTimer()
              setReconvertErrorMsg(result.error ?? 'AI 変換中にエラーが発生しました')
              setReconvertPhase('error')
              reconvertAbortRef.current = null
              currentReconvertIdRef.current = null
            } else if (result.status === 'cancelled') {
              clearReconvertTimer()
              setReconvertPhase('idle')
              reconvertAbortRef.current = null
              currentReconvertIdRef.current = null
            } else {
              if (signal.aborted) return
              reconvertPollRef.current = setTimeout(poll, 5000)
            }
          } catch (e) {
            if (isAbort(e) || signal.aborted) {
              currentReconvertIdRef.current = null
              return
            }
            clearReconvertTimer()
            setReconvertErrorMsg(
              e instanceof Error ? e.message : 'AI 変換ステータス確認中にエラーが発生しました',
            )
            setReconvertPhase('error')
            reconvertAbortRef.current = null
            currentReconvertIdRef.current = null
          }
        }
        reconvertPollRef.current = setTimeout(poll, 5000)
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          setReconvertPhase('idle')
          currentReconvertIdRef.current = null
          return
        }
        clearReconvertTimer()
        setReconvertErrorMsg(e instanceof Error ? e.message : 'AI 変換リクエストに失敗しました')
        setReconvertPhase('error')
        reconvertAbortRef.current = null
        currentReconvertIdRef.current = null
      }
    },
    [clearReconvertTimer],
  )

  const toggleSheet = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const handleDownload = () => {
    if (!hasSelection) return
    const base = fileName.replace(/\.xlsx$/i, '')
    if (mergeDownload) {
      downloadText(`${base}.md`, combinedMarkdown)
    } else {
      sheets
        .filter((s) => selected.has(s.name))
        .forEach((s) => downloadText(`${base}_${s.name}.md`, s.markdown))
    }
  }

  const handleCopy = async () => {
    if (!hasSelection) return
    const text = mergeDownload
      ? combinedMarkdown
      : sheets.find((s) => s.name === previewSheetName)?.markdown ?? ''
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isConverting = phase === 'converting'

  return (
    <div className="min-h-screen bg-brand-50">
      <header className="bg-brand-800 py-4 shadow-md">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-lg font-bold text-white">
            <span className="mr-3 rounded bg-white/15 px-2 py-0.5 text-sm tracking-wide">excel2md</span>
            <span className="text-white/90">Excel → Markdown 変換</span>
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm text-gray-600">
          <code className="rounded bg-gray-100 px-1 text-xs">.xlsx</code>{' '}
          ファイルを選択するとブラウザで即座に Markdown へ変換します。
          精度を上げたいシートは AIで再変換できます。
        </p>

        <FileDropzone
          onFile={handleFile}
          disabled={isConverting || aiBusy}
        />

        {isConverting && (
          <div className="flex items-center gap-3 py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <p className="text-sm text-gray-500">変換中…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span className="font-semibold">エラー: </span>{errorMsg}
          </div>
        )}

        {phase === 'done' && sheets.length > 0 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              変換完了（{sheets.length} シート）
            </div>

            <SheetTable
              sheetNames={sheets.map((s) => s.name)}
              outputSelected={selected}
              onToggleOutput={toggleSheet}
              onSelectAllOutput={(names) =>
                setSelected((prev) => {
                  const next = new Set(prev)
                  names.forEach((name) => next.add(name))
                  return next
                })
              }
              onClearAllOutput={() => setSelected(new Set())}
              aiConvertedNames={aiConvertedNames}
              disabled={aiBusy}
              onReconvert={handleReconvert}
              onCancelReconvert={cancelReconvert}
            />

            {reconvertPhase === 'error' && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <span className="font-semibold">AI 変換エラー: </span>{reconvertErrorMsg}
              </div>
            )}

            <MarkdownPreview
              sheets={selectedSheetsOrdered.map((s) => ({ name: s.name, markdown: s.markdown }))}
              activeName={previewSheetName}
              onActiveNameChange={setPreviewSheetName}
              onMarkdownChange={(name, markdown) =>
                setSheets((prev) => prev.map((s) => (s.name === name ? { ...s, markdown } : s)))
              }
            />

            <div className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={mergeDownload}
                  onChange={(e) => setMergeDownload(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-600"
                />
                <span>
                  選択したシートを<strong className="font-medium text-gray-800">1つの Markdown</strong>
                  にまとめてダウンロード／コピーする
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-4">
                <ActionButton
                  label="Markdown をダウンロード"
                  variant="primary"
                  onClick={handleDownload}
                  disabled={!hasSelection}
                  icon={
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  }
                />
                <ActionButton
                  label={copied ? 'コピーしました！' : mergeDownload ? '結合 Markdown をコピー' : '表示中のシートをコピー'}
                  variant="secondary"
                  onClick={handleCopy}
                  disabled={!hasSelection}
                  icon={
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  }
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                cancelReconvert()
                setPhase('idle')
                setSheets([])
                setFileName('')
                currentFileRef.current = null
              }}
              className="text-xs text-gray-400 underline hover:text-gray-600"
            >
              別のファイルを変換する
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
