import {
  getLegendaLogoBytes,
  LEGENDA_LOGO_CID,
  LEGENDA_LOGO_MIME,
  legendaLogoDataUri,
} from './legenda-logo.ts'

export const REPORT_OBJECT_NAME = 'Легенда Васильевского, корпус 2'
export const REPORT_ESSENCE_DAILY = 'Ежедневный отчёт по интенсивности работы'
export const REPORT_ESSENCE_WEEKLY = 'Еженедельный отчёт по интенсивности работы'

type BrandingColors = {
  kicker: string
  textMuted: string
  textH: string
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function emailLogoImg(useCid = true) {
  const source = useCid ? `cid:${LEGENDA_LOGO_CID}` : legendaLogoDataUri()
  return `<img src="${source}" width="108" height="28" alt="LEGENDA" style="display:block;width:108px;max-width:108px;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;margin:0 0 14px;" />`
}

export function emailBrandingHeader(
  colors: BrandingColors,
  essence: string,
  headline: string,
  useCid = true,
) {
  return `<tr><td style="padding:24px 24px 8px;">
    ${emailLogoImg(useCid)}
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${colors.kicker};line-height:1.45;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${escapeHtml(essence)}</div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:${colors.textMuted};margin-top:5px;line-height:1.45;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${escapeHtml(REPORT_OBJECT_NAME)}</div>
    <h1 style="margin:12px 0 0;font-size:22px;color:${colors.textH};font-weight:700;line-height:1.25;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${escapeHtml(headline)}</h1>
  </td></tr>`
}

export function inlineLogoAttachment() {
  return {
    filename: 'legenda-logo.png',
    content: getLegendaLogoBytes(),
    cid: LEGENDA_LOGO_CID,
    contentDisposition: 'inline' as const,
    contentType: LEGENDA_LOGO_MIME,
  }
}

export function emailHtmlForPreview(innerHtml: string) {
  return innerHtml.replaceAll(`cid:${LEGENDA_LOGO_CID}`, legendaLogoDataUri())
}
