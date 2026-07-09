import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(root, '../public/brand/legenda-wordmark.png')
const pngPath = path.join(root, '../supabase/functions/send-report/assets/legenda-logo.png')
const outPath = path.join(root, '../supabase/functions/send-report/legenda-logo.ts')

const source = fs.readFileSync(sourcePath)
fs.writeFileSync(pngPath, source)

const b64 = source.toString('base64')
const out = `let cachedLogo: Uint8Array | null = null

export const LEGENDA_LOGO_BASE64 = '${b64}'

export function getLegendaLogoBytes(): Uint8Array {
  if (!cachedLogo) {
    const binary = atob(LEGENDA_LOGO_BASE64)
    cachedLogo = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      cachedLogo[index] = binary.charCodeAt(index)
    }
  }
  return cachedLogo
}

export const LEGENDA_LOGO_CID = 'legenda-logo@legenda'
export const LEGENDA_LOGO_MIME = 'image/png'

export function legendaLogoDataUri(): string {
  return \`data:\${LEGENDA_LOGO_MIME};base64,\${LEGENDA_LOGO_BASE64}\`
}
`

fs.writeFileSync(outPath, out)
console.log(`Wrote ${pngPath} (${source.length} bytes)`)
console.log(`Wrote ${outPath} (${b64.length} base64 chars)`)
