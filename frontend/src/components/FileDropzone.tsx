import { useCallback, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  disabled: boolean
}

export default function FileDropzone({ onFile, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      if (disabled) return
      const file = e.dataTransfer.files[0]
      if (file && file.name.endsWith('.xlsx')) {
        onFile(file)
      } else {
        alert('.xlsx ファイルをドロップしてください')
      }
    },
    [onFile, disabled]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFile(file)
      e.target.value = ''
    },
    [onFile]
  )

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={[
        'relative flex flex-col items-center justify-center gap-3',
        'rounded-xl border-2 border-dashed p-10 transition-all duration-200 cursor-pointer',
        isDragging
          ? 'drop-active border-brand-600 bg-brand-50'
          : 'border-brand-500 bg-white hover:bg-brand-50',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {/* ファイル選択 input（非表示） */}
      <input
        type="file"
        accept=".xlsx"
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        onChange={handleChange}
        disabled={disabled}
      />

      {/* アイコン */}
      <svg className="h-12 w-12 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>

      <p className="text-sm text-gray-600 select-none">
        クリックまたはドラッグ＆ドロップで <span className="font-semibold text-brand-700">.xlsx</span> ファイルを選択
      </p>
      <p className="text-xs text-gray-400 select-none">複数シートにも対応しています</p>
    </div>
  )
}
