import {
  PRESIGN_URL,
  RECONVERT_URL,
  RECONVERT_STATUS_URL,
  RECONVERT_CANCEL_URL,
  assertBackendConfigured,
} from './config'

/** 本文が空のときブラウザ既定の英語 statusText を避けるため */
function httpStatusTextJa(status: number): string {
  const map: Record<number, string> = {
    400: 'リクエストが不正です',
    401: '認証が必要です',
    403: 'アクセスが拒否されました',
    404: '見つかりません',
    405: '許可されていないメソッドです',
    408: 'リクエストがタイムアウトしました',
    413: 'ペイロードが大きすぎます',
    429: 'リクエストが多すぎます',
    500: 'サーバーでエラーが発生しました',
    502: 'ゲートウェイが不正な応答を返しました',
    503: 'サービスが一時的に利用できません',
    504: 'ゲートウェイがタイムアウトしました',
  }
  return map[status] ?? `HTTP エラー（${status}）`
}

async function httpErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text) as { message?: string; error?: string }
    if (j.message) return j.message
    if (j.error) return j.error
  } catch { /* plain text */ }
  const trimmed = text.slice(0, 800)
  return trimmed || httpStatusTextJa(res.status)
}

/** 署名付きアップロード URL と jobId を取得（AI 再変換用） */
export async function requestPresignedUrl(signal?: AbortSignal): Promise<{ uploadUrl: string; jobId: string }> {
  assertBackendConfigured()
  const res = await fetch(PRESIGN_URL, { method: 'POST', signal })
  if (!res.ok) {
    let detail = await httpErrorDetail(res)
    if (res.status === 403 && detail.includes('Missing Authentication Token')) {
      detail +=
        ' （REST API では VITE_API_ENDPOINT の末尾にステージ名が必要です。例: …amazonaws.com/prod）'
    }
    throw new Error(`署名付き URL の取得に失敗しました（${res.status}）: ${detail}`)
  }
  return res.json()
}

/** S3 に直接アップロード（AI 再変換用） */
export async function uploadToS3(uploadUrl: string, file: File, signal?: AbortSignal): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  })
  if (!res.ok) {
    const detail = await httpErrorDetail(res)
    throw new Error(`S3 へのアップロードに失敗しました（${res.status}）: ${detail}`)
  }
}

/** AI 再変換リクエスト → reconvertId を返す */
export async function requestReconvert(
  jobId: string,
  sheetNames: string[],
  signal?: AbortSignal,
): Promise<{ reconvertId: string }> {
  assertBackendConfigured()
  const res = await fetch(RECONVERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, sheetNames }),
    signal,
  })
  if (!res.ok) {
    throw new Error(`AI 再変換のリクエストに失敗しました（${res.status}）: ${await httpErrorDetail(res)}`)
  }
  return res.json()
}

/** サーバー側の AI 再変換ジョブをキャンセル（S3 にマーカーを置く） */
export async function requestReconvertCancel(reconvertId: string): Promise<void> {
  assertBackendConfigured()
  const res = await fetch(RECONVERT_CANCEL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reconvertId }),
  })
  if (!res.ok) {
    throw new Error(`AI 再変換のキャンセルに失敗しました（${res.status}）: ${await httpErrorDetail(res)}`)
  }
}

/** AI 再変換ステータスを確認 */
export async function checkReconvertStatus(
  reconvertId: string,
  signal?: AbortSignal,
): Promise<{
  status: 'processing' | 'done' | 'error' | 'cancelled'
  downloadUrl?: string
  error?: string
}> {
  const res = await fetch(`${RECONVERT_STATUS_URL}?reconvertId=${encodeURIComponent(reconvertId)}`, {
    signal,
  })
  if (!res.ok) {
    throw new Error(`AI 再変換の状態確認に失敗しました（${res.status}）: ${await httpErrorDetail(res)}`)
  }
  return res.json()
}

/**
 * AI 再変換結果 JSON をダウンロードして返す
 * Lambda は { sheets: [{ name, markdown }] } 形式で保存する
 */
export async function fetchReconvertResult(
  downloadUrl: string,
  signal?: AbortSignal,
): Promise<{ name: string; markdown: string }[]> {
  const res = await fetch(downloadUrl, { cache: 'no-store', signal })
  if (!res.ok) {
    throw new Error(`再変換結果のダウンロードに失敗しました（${res.status}）: ${await httpErrorDetail(res)}`)
  }
  const json = await res.json() as { sheets?: { name: string; markdown: string }[] }
  return json.sheets ?? []
}
