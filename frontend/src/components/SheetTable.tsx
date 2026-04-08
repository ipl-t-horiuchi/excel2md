import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  sheetNames: string[]
  outputSelected: Set<string>
  onToggleOutput: (name: string) => void
  onSelectAllOutput: (sheetNames: string[]) => void
  onClearAllOutput: () => void
  aiConvertedNames: Set<string>
  disabled: boolean
  onReconvert: (sheetNames: string[]) => void
  onCancelReconvert?: () => void | Promise<void>
}

export default function SheetTable({
  sheetNames,
  outputSelected,
  onToggleOutput,
  onSelectAllOutput,
  onClearAllOutput,
  aiConvertedNames,
  disabled,
  onReconvert,
  onCancelReconvert,
}: Props) {
  const [query, setQuery] = useState('')
  const [aiSelected, setAiSelected] = useState<Set<string>>(new Set())
  const wasDisabledRef = useRef(disabled)

  useEffect(() => {
    // 変換開始時は選択を保持し、完了後にだけクリアする
    if (wasDisabledRef.current && !disabled) {
      setAiSelected(new Set())
    }
    wasDisabledRef.current = disabled
  }, [disabled])

  const filteredNames = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sheetNames
    return sheetNames.filter((n) => n.toLowerCase().includes(q))
  }, [sheetNames, query])

  const toggleAi = (name: string) =>
    setAiSelected((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const handleAiConvert = () => {
    if (aiSelected.size === 0) return
    onReconvert([...aiSelected])
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-gray-800">シート一覧</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="シート名で絞り込み…"
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:max-w-xs"
          aria-label="シート名で絞り込み"
        />
      </div>

      <p className="mb-3 text-xs text-gray-500">
        「出力」はダウンロード・プレビュー対象です。「AI」は任意で、複雑な表向けに再変換します。
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <th scope="col" className="px-3 py-2">
                シート名
              </th>
              <th scope="col" className="w-24 px-2 py-2 text-center">
                出力
              </th>
              <th scope="col" className="w-28 px-2 py-2 text-center text-amber-800">
                AI 再変換
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredNames.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-gray-500">
                  該当するシートがありません
                </td>
              </tr>
            ) : (
              filteredNames.map((name) => (
                <tr key={name} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/80">
                  <td className="px-3 py-2.5 font-medium text-gray-800">
                    <span className="break-all">{name}</span>
                    {aiConvertedNames.has(name) && (
                      <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        AI済
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={outputSelected.has(name)}
                      onChange={() => onToggleOutput(name)}
                      className="h-4 w-4 rounded accent-brand-600"
                      aria-label={`${name} を出力に含める`}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={aiSelected.has(name)}
                      onChange={() => toggleAi(name)}
                      disabled={disabled}
                      className="h-4 w-4 rounded accent-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${name} を AI で再変換`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSelectAllOutput(filteredNames)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50"
        >
          出力を全選択
        </button>
        <button
          type="button"
          onClick={onClearAllOutput}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50"
        >
          出力を全解除
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-amber-100 pt-4">
        <button
          type="button"
          onClick={handleAiConvert}
          disabled={disabled || aiSelected.size === 0}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {disabled ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              AI 変換中…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              選択シートを AI 変換（{aiSelected.size} シート）
            </>
          )}
        </button>
        {disabled && onCancelReconvert && (
          <button
            type="button"
            onClick={onCancelReconvert}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 sm:w-auto"
          >
            キャンセル
          </button>
        )}
      </div>
    </div>
  )
}
