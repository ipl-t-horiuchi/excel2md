import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 開発時: Vite が /presign /status を API Gateway へプロキシする
 * → CORS エラー (Failed to fetch) を回避
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = (env.VITE_API_ENDPOINT ?? '').replace(/\/+$/, '')

  return {
    plugins: [react()],
    base: '/excel2md/',
    server: apiBase
      ? {
          proxy: {
            '/presign':          { target: apiBase, changeOrigin: true, secure: true },
            '/status':           { target: apiBase, changeOrigin: true, secure: true },
            '/reconvert-status': { target: apiBase, changeOrigin: true, secure: true },
            '/reconvert-cancel': { target: apiBase, changeOrigin: true, secure: true },
            '/reconvert':        { target: apiBase, changeOrigin: true, secure: true },
          },
        }
      : undefined,
  }
})
