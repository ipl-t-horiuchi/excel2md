import { useCallback, useEffect, useRef, useState } from 'react'
import FileDropzone from './components/FileDropzone'
import SheetSelector from './components/SheetSelector'
import MarkdownPreview from './components/MarkdownPreview'
import ActionButton from './components/ActionButton'
import AiReconvertPanel from './components/AiReconvertPanel'
import {
  requestPresignedUrl,
  uploadToS3,
  requestReconvert,
  checkReconvertStatus,
  fetchReconvertResult,
} from './api'
import { convertXlsxToMarkdown } from './xlsxToMarkdown'
import type { SheetResult } from './types'

type Phase = 'idle' | 'converting' | 'done' | 'error'
type ReconvertPhase = 'idle' | 'uploading' | 'processing' | 'error'

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<SheetResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [splitDownload, setSplitDownload] = useState(false)
  const [copied, setCopied] = useState(false)

  const [reconvertPhase, setReconvertPhase] = useState<ReconvertPhase>('idle')
  const [reconvertErrorMsg, setReconvertErrorMsg] = useState('')
  const [aiConvertedNames, setAiConvertedNames] = useState<Set<string>>(new Set())

  const reconvertPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // AI 再変換用にファイルを保持
  const currentFileRef = useRef<File | null>(null)

  const clearReconvertTimer = useCallback(() => {
    if (reconvertPollRef.current) clearTimeout(reconvertPollRef.current)
    reconvertPollRef.current = null
  }, [])

  useEffect(() => () => clearReconvertTimer(), [clearReconvertTimer])

  const combinedMarkdown = sheets
    .filter((s) => selected.has(s.name))
    .map((s) => `## シート: ${s.name}\n\n${s.markdown}`)
    .join('\n\n---\n\n')

  /** ファイル選択 → ブラウザで即座に変換 */
  const handleFile = useCallback(async (file: File) => {
    clearReconvertTimer()
    currentFileRef.current = file
    setFileName(file.name)
    setPhase('converting')
    setSheets([])
    setSelected(new Set())
    setErrorMsg('')
    setReconvertPhase('idle')
    setReconvertErrorMsg('')
    setAiConvertedNames(new Set())

    try {
      const buffer = await file.arrayBuffer()
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

  /** AI 再変換: ファイルをアップロードして Bedrock で変換 */
  const handleReconvert = useCallback(async (sheetNames: string[]) => {
    const file = currentFileRef.current
    if (!file) return
    clearReconvertTimer()
    setReconvertPhase('uploading')
    setReconvertErrorMsg('')

    try {
      // S3 へアップロード（AI 再変換用）
      const { uploadUrl, jobId } = await requestPresignedUrl()
      await uploadToS3(uploadUrl, file)

      setReconvertPhase('processing')
      const { reconvertId } = await requestReconvert(jobId, sheetNames)

      const poll = async () => {
        try {
          const result = await checkReconvertStatus(reconvertId)
          if (result.status === 'done' && result.downloadUrl) {
            clearReconvertTimer()
            const aiSheets = await fetchReconvertResult(result.downloadUrl)
            const aiMap = new Map(aiSheets.map((s) => [s.name, s.markdown]))
            setSheets((prev) =>
              prev.map((s) =>
                aiMap.has(s.name) ? { ...s, markdown: aiMap.get(s.name)!, aiConverted: true } : s
              )
            )
            setAiConvertedNames((prev) => {
              const next = new Set(prev)
              sheetNames.forEach((n) => next.add(n))
              return next
            })
            setReconvertPhase('idle')
          } else if (result.status === 'error') {
            clearReconvertTimer()
            setReconvertErrorMsg(result.error ?? 'AI 変換中にエラーが発生しました')
            setReconvertPhase('error')
          } else {
            reconvertPollRef.current = setTimeout(poll, 5000)
          }
        } catch (e) {
          clearReconvertTimer()
          setReconvertErrorMsg(e instanceof Error ? e.message : 'AI 変換ステータス確認中にエラーが発生しました')
          setReconvertPhase('error')
        }
      }
      reconvertPollRef.current = setTimeout(poll, 5000)
    } catch (e) {
      clearReconvertTimer()
      setReconvertErrorMsg(e instanceof Error ? e.message : 'AI 変換リクエストに失敗しました')
      setReconvertPhase('error')
    }
  }, [clearReconvertTimer])

  const toggleSheet = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const handleDownload = () => {
    const base = fileName.replace(/\.xlsx$/i, '')
    if (splitDownload) {
      sheets.filter((s) => selected.has(s.name)).forEach((s) =>
        downloadText(`${base}_${s.name}.md`, s.markdown)
      )
    } else {
      downloadText(`${base}.md`, combinedMarkdown)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(combinedMarkdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isConverting = phase === 'converting'

  return (
    <div className="min-h-screen bg-brand-50">
      <header className="bg-brand-800 py-4 shadow-md">
        <div className="mx-auto max-w-3xl px-4">
          <h1 className="text-lg font-bold text-white">Excel → Markdown 変換</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <p className="text-sm text-gray-600">
          設計書などの{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">.xlsx</code>{' '}
          ファイルを選択するとブラウザで即座に Markdown へ変換します。
          精度を上げたいシートは AI（Claude）で再変換できます。
        </p>

        <FileDropzone onFile={handleFile} disabled={isConverting || reconvertPhase === 'uploading' || reconvertPhase === 'processing'} />

        {/* 変換中（ほぼ瞬時だが表示） */}
        {isConverting && (
          <div className="flex items-center gap-3 py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <p className="text-sm text-gray-500">変換中…</p>
          </div>
        )}

        {/* エラー */}
        {phase === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span className="font-semibold">エラー: </span>{errorMsg}
          </div>
        )}

        {/* 変換完了 */}
        {phase === 'done' && sheets.length > 0 && (
          <div className="space-y-5">
            {/* 完了バッジ */}
            <div className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              変換完了（{sheets.length} シート）
            </div>

            {/* AI 再変換パネル */}
            <AiReconvertPanel
              sheetNames={sheets.map((s) => s.name)}
              aiConvertedNames={aiConvertedNames}
              disabled={reconvertPhase === 'uploading' || reconvertPhase === 'processing'}
              onReconvert={handleReconvert}
            />

            {/* AI 再変換ステータス */}
            {(reconvertPhase === 'uploading' || reconvertPhase === 'processing') && (
              <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
                {reconvertPhase === 'uploading' ? 'ファイルをアップロード中…' : 'AI で再変換中です。しばらくお待ちください…'}
              </div>
            )}

            {/* AI 再変換エラー */}
            {reconvertPhase === 'error' && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <span className="font-semibold">AI 変換エラー: </span>{reconvertErrorMsg}
              </div>
            )}

            {/* ダウンロード対象シート選択 */}
            <SheetSelector
              sheetNames={sheets.map((s) => s.name)}
              selected={selected}
              onToggle={toggleSheet}
              onSelectAll={() => setSelected(new Set(sheets.map((s) => s.name)))}
              onClearAll={() => setSelected(new Set())}
            />

            <MarkdownPreview text={combinedMarkdown} />

            <div className="flex flex-wrap items-center gap-4">
              <ActionButton
                label="Markdown をダウンロード"
                variant="primary"
                onClick={handleDownload}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                }
              />
              <ActionButton
                label={copied ? 'コピーしました！' : 'クリップボードにコピー'}
                variant="secondary"
                onClick={handleCopy}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                }
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={splitDownload}
                  onChange={(e) => setSplitDownload(e.target.checked)}
                  className="h-4 w-4 rounded accent-brand-600"
                />
                シートごとに分割してダウンロード
              </label>
            </div>

            <button
              onClick={() => { setPhase('idle'); setSheets([]); setFileName(''); currentFileRef.current = null }}
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
