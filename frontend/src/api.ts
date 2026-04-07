import {
  PRESIGN_URL,
  RECONVERT_URL,
  RECONVERT_STATUS_URL,
  assertBackendConfigured,
} from './config'

async function httpErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text) as { message?: string; error?: string }
    if (j.message) return j.message
    if (j.error) return j.error
  } catch { /* plain text */ }
  return text.slice(0, 800) || res.statusText
}

/** 署名付きアップロード URL と jobId を取得（AI 再変換用） */
export async function requestPresignedUrl(): Promise<{ uploadUrl: string; jobId: string }> {
  assertBackendConfigured()
  const res = await fetch(PRESIGN_URL, { method: 'POST' })
  if (!res.ok) {
    let detail = await httpErrorDetail(res)
    if (res.status === 403 && detail.includes('Missing Authentication Token')) {
      detail +=
        ' （REST API では VITE_API_ENDPOINT の末尾にステージ名が必要です。例: …amazonaws.com/prod）'
    }
    throw new Error(`presign failed (${res.status}): ${detail}`)
  }
  return res.json()
}

/** S3 に直接アップロード（AI 再変換用） */
export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    const detail = await httpErrorDetail(res)
    throw new Error(`S3 upload failed (${res.status}): ${detail}`)
  }
}

/** AI 再変換リクエスト → reconvertId を返す */
export async function requestReconvert(
  jobId: string,
  sheetNames: string[]
): Promise<{ reconvertId: string }> {
  assertBackendConfigured()
  const res = await fetch(RECONVERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, sheetNames }),
  })
  if (!res.ok) throw new Error(`reconvert failed (${res.status}): ${await httpErrorDetail(res)}`)
  return res.json()
}

/** AI 再変換ステータスを確認 */
export async function checkReconvertStatus(
  reconvertId: string
): Promise<{ status: 'processing' | 'done' | 'error'; downloadUrl?: string; error?: string }> {
  const res = await fetch(`${RECONVERT_STATUS_URL}?reconvertId=${encodeURIComponent(reconvertId)}`)
  if (!res.ok) throw new Error(`reconvert-status failed (${res.status}): ${await httpErrorDetail(res)}`)
  return res.json()
}

/**
 * AI 再変換結果 JSON をダウンロードして返す
 * Lambda は { sheets: [{ name, markdown }] } 形式で保存する
 */
export async function fetchReconvertResult(
  downloadUrl: string
): Promise<{ name: string; markdown: string }[]> {
  const res = await fetch(downloadUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`result download failed (${res.status}): ${await httpErrorDetail(res)}`)
  const json = await res.json() as { sheets?: { name: string; markdown: string }[] }
  return json.sheets ?? []
}
