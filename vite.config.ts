import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function buildUiTextModule(source: unknown) {
  const json = JSON.stringify(source, null, 2)

  return `export type UiText = typeof defaultUiText

export const defaultUiText = ${json} as const
`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ui-text-apply-endpoint',
      configureServer(server) {
        server.middlewares.use('/__ui-text/apply', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }

          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })

          req.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              const targetPath = path.resolve(process.cwd(), 'src/content/uiText.ts')
              fs.writeFileSync(targetPath, buildUiTextModule(parsed), 'utf8')
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            } catch (error) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              )
            }
          })
        })
      },
    },
  ],
})
