// «Отчёт по смене»: страница-таблица со строкой на каждого сотрудника —
// ФИО, лента хронологии смены и комментарий с местом для рукописной заметки.
// Рисуется по готовому payload'у: данные и раскраску минут собирает фронт
// (там же, где живёт диалог детализации), сюда приходит уже разложенная геометрия.
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'
import { getRobotoFontBytes } from './roboto-font.ts'
import { REPORT_LOGO_TEXT } from './email-branding.ts'

export type ShiftReportSegmentKind =
  | 'work'
  | 'go'
  | 'weak'
  | 'long_idle'
  | 'none'
  | 'lunch'
  | 'not_worn'

export type ShiftReportSegment = {
  startMin: number
  endMin: number
  kind: ShiftReportSegmentKind
}

export type ShiftReportEmployee = {
  full_name: string
  employee_number: string
  profession: string | null
  /** «07:12 – 22:04 · 14ч 52м» */
  shift_label: string
  activity_pct: number
  axisStartMin: number
  axisEndMin: number
  /** Границы смены для пунктирных маркеров. */
  shiftStartMin: number | null
  shiftEndMin: number | null
  strip: ShiftReportSegment[]
  lunch: ShiftReportSegment[]
  /** Автотекст по метрикам: факты, без оценок. */
  comment: string[]
}

export type ShiftReportBrigade = {
  supervisor_name: string
  employees: ShiftReportEmployee[]
}

export type ShiftReportPayload = {
  reportDate: string
  reportDateLabel: string
  objectName: string
  brigades: ShiftReportBrigade[]
}

const PAGE_WIDTH = 841.89
const PAGE_HEIGHT = 595.28
const MARGIN = 32

const COL_NAME = 128
const COL_COMMENT = 186
const ROW_HEIGHT = 80
const STRIP_HEIGHT = 26

function hex(value: string): RGB {
  const n = value.replace('#', '')
  return rgb(parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255)
}

const C = {
  page: hex('#eef1f6'),
  surface: hex('#ffffff'),
  surface2: hex('#f5f7fb'),
  text: hex('#33404f'),
  textH: hex('#0f1b2d'),
  textMuted: hex('#6b7a8d'),
  border: hex('#dbe1ea'),
  noteBorder: hex('#c6cede'),
}

/** Те же цвета, что в ленте хронологии на дашборде. */
const SEGMENT_COLORS: Record<ShiftReportSegmentKind, RGB> = {
  work: hex('#2563eb'),
  go: hex('#0d9488'),
  weak: hex('#f5a623'),
  long_idle: hex('#d1495b'),
  none: hex('#d7dbe1'),
  lunch: hex('#22c55e'),
  not_worn: hex('#ff1744'),
}

const LEGEND: Array<{ kind: ShiftReportSegmentKind; label: string }> = [
  { kind: 'work', label: 'Активность' },
  { kind: 'go', label: 'Ходьба между зонами' },
  { kind: 'weak', label: 'Слабая активность' },
  { kind: 'long_idle', label: 'Длительный простой' },
  { kind: 'lunch', label: 'Обед' },
  { kind: 'none', label: 'Нет телеметрии' },
]

function pdfText(value: string) {
  return value.replace(/…/g, '...').replace(/[–—]/g, '-')
}

function formatHourLabel(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

class ShiftReportWriter {
  private page: PDFPage
  private y = MARGIN

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly payload: ShiftReportPayload,
  ) {
    this.page = this.addPage()
  }

  private addPage() {
    const page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: C.page })
    return page
  }

  private bottom(top: number, height = 0) {
    return PAGE_HEIGHT - top - height
  }

  private text(value: string, left: number, top: number, size: number, color: RGB = C.text) {
    this.page.drawText(pdfText(value), { x: left, y: this.bottom(top, size), size, font: this.font, color })
  }

  /** Текст с переносом по ширине; возвращает занятую высоту. */
  private textWrapped(value: string, left: number, top: number, size: number, maxWidth: number, color: RGB) {
    const words = pdfText(value).split(/\s+/)
    let line = ''
    let lineTop = top
    const flush = () => {
      if (!line) return
      this.page.drawText(line, { x: left, y: this.bottom(lineTop, size), size, font: this.font, color })
      lineTop += size + 3
      line = ''
    }
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (this.font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
        continue
      }
      flush()
      line = word
    }
    flush()
    return lineTop - top
  }

  private roundedRect(left: number, top: number, width: number, height: number, fill: RGB, stroke?: RGB, radius = 10) {
    const r = Math.min(radius, width / 2, height / 2)
    const path = `M ${r} 0 L ${width - r} 0 Q ${width} 0 ${width} ${r} L ${width} ${height - r} Q ${width} ${height} ${width - r} ${height} L ${r} ${height} Q 0 ${height} 0 ${height - r} L 0 ${r} Q 0 0 ${r} 0 Z`
    this.page.drawSvgPath(path, {
      x: left,
      y: PAGE_HEIGHT - top,
      color: fill,
      borderColor: stroke,
      borderWidth: stroke ? 1 : 0,
    })
  }

  /** Легенда цветов ленты — отдельной строкой по центру под шапкой. */
  private legend(top: number) {
    const gap = 16
    const total = LEGEND.reduce(
      (sum, item) => sum + 11 + this.font.widthOfTextAtSize(pdfText(item.label), 7) + gap,
      -gap,
    )
    let x = (PAGE_WIDTH - total) / 2
    for (const item of LEGEND) {
      this.page.drawRectangle({
        x,
        y: this.bottom(top, 7),
        width: 7,
        height: 7,
        color: SEGMENT_COLORS[item.kind],
      })
      x += 11
      this.text(item.label, x, top, 7, C.textMuted)
      x += this.font.widthOfTextAtSize(pdfText(item.label), 7) + gap
    }
  }

  /** Полная шапка — только на первой странице отчёта. */
  private documentHeader(brigadeName: string) {
    this.text(REPORT_LOGO_TEXT, MARGIN, MARGIN, 16, C.textH)
    this.text(this.payload.objectName, MARGIN, MARGIN + 20, 7, C.textMuted)
    this.text(
      `Отчёт по работе сотрудников бригады ${brigadeName} от ${this.payload.reportDateLabel}`,
      MARGIN,
      MARGIN + 34,
      13,
      C.textH,
    )
    this.legend(MARGIN + 66)
    this.y = MARGIN + 88
  }

  /** Новая бригада на новой странице — только её название и легенда, без логотипа. */
  private brigadeHeader(brigadeName: string) {
    this.text(
      `Бригада ${brigadeName} · смена от ${this.payload.reportDateLabel}`,
      MARGIN,
      MARGIN,
      13,
      C.textH,
    )
    this.legend(MARGIN + 30)
    this.y = MARGIN + 52
  }

  private employeeRow(employee: ShiftReportEmployee) {
    const top = this.y
    const rowWidth = PAGE_WIDTH - MARGIN * 2
    this.roundedRect(MARGIN, top, rowWidth, ROW_HEIGHT, C.surface, C.border, 12)

    // Колонка 1 — сотрудник.
    this.text(employee.full_name, MARGIN + 12, top + 12, 10, C.textH)
    this.text(
      `${employee.profession?.trim() || '—'} · #${employee.employee_number}`,
      MARGIN + 12,
      top + 27,
      6,
      C.textMuted,
    )
    this.text(employee.shift_label, MARGIN + 12, top + 42, 7, C.text)
    this.text(`Активность ${Math.round(employee.activity_pct)}%`, MARGIN + 12, top + 56, 8, C.textH)

    // Колонка 2 — лента хронологии.
    const stripLeft = MARGIN + COL_NAME
    const stripWidth = rowWidth - COL_NAME - COL_COMMENT - 24
    const stripTop = top + 34
    const span = Math.max(1, employee.axisEndMin - employee.axisStartMin)
    const xAt = (min: number) => stripLeft + ((min - employee.axisStartMin) / span) * stripWidth

    // Часовая шкала — над лентой, как в диалоге детализации на дашборде.
    // Если часовые метки не помещаются по ширине, показываем каждую вторую.
    const hours = Math.max(1, Math.round(span / 60))
    const hourStep = stripWidth / hours >= 24 ? 60 : 120
    for (let min = Math.ceil(employee.axisStartMin / 60) * 60; min <= employee.axisEndMin; min += hourStep) {
      const label = formatHourLabel(min)
      const width = this.font.widthOfTextAtSize(label, 6)
      const x = Math.min(Math.max(xAt(min) - width / 2, stripLeft), stripLeft + stripWidth - width)
      this.text(label, x, stripTop - 10, 6, C.textMuted)
      this.page.drawLine({
        start: { x: xAt(min), y: this.bottom(stripTop - 3) },
        end: { x: xAt(min), y: this.bottom(stripTop) },
        thickness: 0.4,
        color: C.border,
      })
    }

    // Подложка ленты белая: серым красим только участки без телеметрии внутри смены.
    this.page.drawRectangle({
      x: stripLeft,
      y: this.bottom(stripTop, STRIP_HEIGHT),
      width: stripWidth,
      height: STRIP_HEIGHT,
      color: C.surface,
      borderColor: C.border,
      borderWidth: 0.5,
    })
    for (const segment of employee.strip) {
      const x = xAt(segment.startMin)
      const width = Math.max(0.4, xAt(segment.endMin) - x)
      this.page.drawRectangle({
        x,
        y: this.bottom(stripTop, STRIP_HEIGHT),
        width,
        height: STRIP_HEIGHT,
        color: SEGMENT_COLORS[segment.kind],
      })
    }
    // Обед закрашиваем поверх ленты: что человек делал в обед, мы не оцениваем.
    for (const segment of employee.lunch) {
      const x = xAt(segment.startMin)
      const width = Math.max(1, xAt(segment.endMin) - x)
      this.page.drawRectangle({
        x,
        y: this.bottom(stripTop, STRIP_HEIGHT),
        width,
        height: STRIP_HEIGHT,
        color: SEGMENT_COLORS.lunch,
      })
      const label = pdfText('Обед')
      const labelWidth = this.font.widthOfTextAtSize(label, 5.5)
      if (width >= labelWidth + 4) {
        this.page.drawText(label, {
          x: x + (width - labelWidth) / 2,
          y: this.bottom(stripTop + STRIP_HEIGHT / 2 + 2, 5.5),
          size: 5.5,
          font: this.font,
          color: C.surface,
        })
      }
    }

    // Маркеры начала и конца смены — пунктиром, как в диалоге.
    const marker = (min: number | null | undefined, color: RGB, label: string, align: 'left' | 'right') => {
      if (min == null || min < employee.axisStartMin || min > employee.axisEndMin) return
      const x = xAt(min)
      this.page.drawLine({
        start: { x, y: this.bottom(stripTop - 2) },
        end: { x, y: this.bottom(stripTop + STRIP_HEIGHT + 2) },
        thickness: 1,
        color,
        dashArray: [2, 2],
      })
      const width = this.font.widthOfTextAtSize(pdfText(label), 5.5)
      const labelX = align === 'left' ? Math.max(stripLeft, x - width - 2) : Math.min(x + 3, stripLeft + stripWidth - width)
      this.text(label, labelX, stripTop + STRIP_HEIGHT + 4, 5.5, color)
    }
    marker(employee.shiftStartMin, SEGMENT_COLORS.lunch, 'начало смены', 'right')
    marker(employee.shiftEndMin, SEGMENT_COLORS.long_idle, 'конец смены', 'left')

    // Колонка 3 — комментарий и поле для заметки.
    const commentLeft = PAGE_WIDTH - MARGIN - COL_COMMENT - 12
    let commentTop = top + 12
    for (const line of employee.comment) {
      commentTop += this.textWrapped(line, commentLeft, commentTop, 7, COL_COMMENT, C.text) + 3
    }

    this.y = top + ROW_HEIGHT + 8
  }

  render() {
    this.payload.brigades.forEach((brigade, brigadeIndex) => {
      if (brigadeIndex === 0) {
        this.documentHeader(brigade.supervisor_name)
      } else {
        this.page = this.addPage()
        this.brigadeHeader(brigade.supervisor_name)
      }

      for (const employee of brigade.employees) {
        // Страница-продолжение — без шапки и легенды, только строки сотрудников.
        if (this.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) {
          this.page = this.addPage()
          this.y = MARGIN
        }
        this.employeeRow(employee)
      }
    })
  }
}

export async function renderShiftReportPdf(payload: ShiftReportPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(getRobotoFontBytes())
  new ShiftReportWriter(doc, font, payload).render()
  return new Uint8Array(await doc.save())
}
