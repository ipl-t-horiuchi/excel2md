const rawBase = import.meta.env.VITE_API_ENDPOINT ?? ''
export const API_BASE = typeof rawBase === 'string' ? rawBase.replace(/\/+$/, '') : ''

export const PRESIGN_URL           = import.meta.env.DEV ? '/presign'          : `${API_BASE}/presign`
export const RECONVERT_URL         = import.meta.env.DEV ? '/reconvert'        : `${API_BASE}/reconvert`
export const RECONVERT_STATUS_URL  = import.meta.env.DEV ? '/reconvert-status' : `${API_BASE}/reconvert-status`

export function assertBackendConfigured(): void {
  if (!API_BASE) {
    throw new Error(
      'frontend/.env に VITE_API_ENDPOINT を設定し、npm run dev を再起動してください。'
    )
  }
}
