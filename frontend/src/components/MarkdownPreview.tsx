import { useState } from 'react'

interface Props {
  text: string
}

export default function MarkdownPreview({ text }: Props) {
  const [showPreview, setShowPreview] = useState(false)

  if (!text) return null

  return (
    <div className="space-y-2">
      {/* プレビュー切り替えボタン */}
      <button
        onClick={() => setShowPreview((v) => !v)}
        className="text-xs text-brand-700 underline hover:text-brand-800"
      >
        {showPreview ? 'テキスト表示に戻す' : 'プレビュー表示（Markdown レンダリング）'}
      </button>

      {showPreview ? (
        /* レンダリング表示 */
        <div
          className="preview-area prose prose-sm max-w-none overflow-auto rounded-xl border border-gray-200 bg-white p-4"
          style={{ maxHeight: '24rem' }}
          dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
        />
      ) : (
        /* プレーンテキスト表示 */
        <textarea
          readOnly
          value={text}
          className="preview-area w-full resize-none rounded-xl border border-gray-200 bg-white p-4 font-mono text-xs text-gray-800 focus:outline-none"
          style={{ height: '24rem' }}
        />
      )}
    </div>
  )
}

/** 簡易 Markdown → HTML 変換（外部ライブラリ不使用） */
function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 rounded text-xs">$1</code>')
    .replace(/^\| (.+) \|$/gm, (line) => {
      if (/^\|[\s-|]+\|$/.test(line)) return ''
      const cells = line.slice(1, -1).split('|').map((c) => `<td class="border px-2 py-1">${c.trim()}</td>`)
      return `<tr>${cells.join('')}</tr>`
    })
    .replace(/(<tr>.*<\/tr>)/gs, '<table class="border-collapse text-xs my-2">$1</table>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\n\n/g, '<br/><br/>')
}
