export const REPORT_OBJECT_NAME = 'Легенда Васильевского, корпус 2'
export const REPORT_ESSENCE_DAILY = 'Ежедневный отчёт по интенсивности работы'
export const REPORT_ESSENCE_WEEKLY = 'Еженедельный отчёт по интенсивности работы'
export const REPORT_LOGO_TEXT = 'LEGENDA'

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

export function emailLogoText() {
  return `<div style="margin:0 0 14px;font-size:28px;line-height:1;font-weight:700;letter-spacing:0.08em;color:#000000;font-family:Arial,Helvetica,'Segoe UI',sans-serif;">${REPORT_LOGO_TEXT}</div>`
}

export function emailBrandingHeader(colors: BrandingColors, essence: string, headline: string) {
  return `<tr><td style="padding:24px 24px 8px;">
    ${emailLogoText()}
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${colors.kicker};line-height:1.45;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${escapeHtml(essence)}</div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:${colors.textMuted};margin-top:5px;line-height:1.45;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${escapeHtml(REPORT_OBJECT_NAME)}</div>
    <h1 style="margin:12px 0 0;font-size:22px;color:${colors.textH};font-weight:700;line-height:1.25;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${escapeHtml(headline)}</h1>
  </td></tr>`
}

export function emailHtmlForPreview(innerHtml: string) {
  return innerHtml
}
