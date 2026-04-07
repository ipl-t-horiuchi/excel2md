import { useState } from 'react'

interface Props {
  sheetNames: string[]
  aiConvertedNames: Set<string>
  disabled: boolean
  onReconvert: (selected: string[]) => void
}

export default function AiReconvertPanel({ sheetNames, aiConvertedNames, disabled, onReconvert }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const handleClick = () => {
    if (selected.size === 0) return
    onReconvert([...selected])
    setSelected(new Set())
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-1 text-sm font-semibold text-amber-800">AI で精度向上（任意）</p>
      <p className="mb-3 text-xs text-amber-700">
        複雑な表・結合セルが多いシートは AI（Claude）で再変換するとより正確になります。
      </p>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
        {sheetNames.map((name) => (
          <label key={name} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={selected.has(name)}
              onChange={() => toggle(name)}
              disabled={disabled}
              className="h-4 w-4 rounded accent-amber-600 disabled:cursor-not-allowed"
            />
            <span>{name}</span>
            {aiConvertedNames.has(name) && (
              <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                AI済
              </span>
            )}
          </label>
        ))}
      </div>

      <button
        onClick={handleClick}
        disabled={disabled || selected.size === 0}
        className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            AI 変換中…
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            選択シートを AI 変換（{selected.size} シート）
          </>
        )}
      </button>
    </div>
  )
}
