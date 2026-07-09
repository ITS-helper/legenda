let cachedLogo: Uint8Array | null = null

export function getLegendaLogoBytes(): Uint8Array {
  if (!cachedLogo) {
    cachedLogo = Deno.readFileSync(new URL('./assets/legenda-logo.png', import.meta.url))
  }
  return cachedLogo
}

export const LEGENDA_LOGO_CID = 'legenda-logo@legenda'

export function legendaLogoDataUri(): string {
  const bytes = getLegendaLogoBytes()
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return `data:image/png;base64,${btoa(binary)}`
}
