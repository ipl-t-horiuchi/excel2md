interface Props {
  sheetNames: string[]
  selected: Set<string>
  onToggle: (name: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}

export default function SheetSelector({ sheetNames, selected, onToggle, onSelectAll, onClearAll }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-700">出力対象シート</p>

      {/* チェックボックス一覧 */}
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        {sheetNames.map((name) => (
          <label key={name} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={selected.has(name)}
              onChange={() => onToggle(name)}
              className="h-4 w-4 rounded accent-brand-600"
            />
            <span>{name}</span>
          </label>
        ))}
      </div>

      {/* 操作ボタン */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSelectAll}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
        >
          全選択
        </button>
        <button
          onClick={onClearAll}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
        >
          全解除
        </button>
      </div>
    </div>
  )
}
