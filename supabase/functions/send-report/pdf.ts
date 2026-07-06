import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'
import { getRobotoFontBytes } from './roboto-font.ts'

export type BrigadeCardPayload = {
  supervisor_name: string
  subtitle: string
  activity_pct: number
  work_sec: number
  weak_activity_sec: number
  long_idle_sec: number
  go_sec: number
  total_sec: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
  kpp_label: string
  kpp_value: string
  kpp_alert: boolean
  shift_duration: string
}

export type ZonePanelRow = {
  name: string
  value: string
  barPct: number
  alert: boolean
}

export type ReportPdfPayload = {
  title: string
  subtitle: string
  metrics: Array<{ label: string; value: string }>
  brigadeSectionTitle: string
  brigadeCards: BrigadeCardPayload[]
  dynamicsTitle: string
  dynamicsPeriodLabel: string
  dynamicsCards: Array<{
    name: string
    value: string
    delta: string
    compare: string
    sparkline: Array<{ label: string; value: number }>
    sparklineTitle?: string
  }>
  zonesTitle: string
  zonesPeriodLabel: string
  zonesLocationDescription: string
  zonesIdleDescription: string
  zonesIdleSummaryLabel: string
  zonesLocationRows: ZonePanelRow[]
  zonesIdleRows: ZonePanelRow[]
  zonesIdleSummary?: { episodes: number; minutes: number }
  topActivityTitle: string
  topActivityRows: Array<{ name: string; meta: string; value: string }>
  attentionTitle: string
  attentionRows: Array<{ name: string; meta: string; value: string }>
  kppTitle?: string
  kppRows?: Array<{ name: string; meta: string; value: string }>
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const RADIUS = {
  sm: 10,
  md: 14,
  lg: 16,
}

function hex(value: string): RGB {
  const normalized = value.replace('#', '')
  return rgb(
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  )
}

const S = {
  work: hex('#00d5b4'),
  weak: hex('#f5a623'),
  longIdle: hex('#d1495b'),
  go: hex('#004ecf'),
  track: hex('#e8ebf0'),
}

const C = {
  page: hex('#eef1f6'),
  surface: hex('#ffffff'),
  surface2: hex('#f5f7fb'),
  text: hex('#33404f'),
  textH: hex('#0f1b2d'),
  textMuted: hex('#6b7a8d'),
  kicker: hex('#8a97a8'),
  brand: hex('#004ecf'),
  border: hex('#dbe1ea'),
  alert: hex('#d1495b'),
  alertSoft: hex('#fbeaed'),
  work: hex('#00d5b4'),
  workSoft: hex('#e8fbf7'),
  brandSoft: hex('#e8f0fd'),
}

function pdfText(value: string) {
  return value
    .replace(/\u2026/g, '...')
    .replace(/[\u2013\u2014]/g, '-')
}

function pct(value: number) {
  return `${Math.round(value)}%`
}

function deltaColor(delta: string): RGB {
  if (delta.startsWith('+')) return C.work
  if (delta.startsWith('-')) return C.alert
  return C.textMuted
}

class PdfWriter {
  private page: PDFPage
  private y = MARGIN

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.paintPageBackground()
  }

  private paintPageBackground() {
    this.page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: C.page,
    })
  }

  private bottomY(top: number, height: number) {
    return PAGE_HEIGHT - top - height
  }

  private roundedRect(
    left: number,
    top: number,
    width: number,
    height: number,
    fill: RGB,
    stroke?: RGB,
    radius = RADIUS.md,
  ) {
    const r = Math.min(radius, width / 2, height / 2)
    const x = left
    // drawSvgPath: y — верхний край фигуры в PDF-координатах (в отличие от drawRectangle).
    const y = PAGE_HEIGHT - top
    const path = `M ${r} 0 L ${width - r} 0 Q ${width} 0 ${width} ${r} L ${width} ${height - r} Q ${width} ${height} ${width - r} ${height} L ${r} ${height} Q 0 ${height} 0 ${height - r} L 0 ${r} Q 0 0 ${r} 0 Z`

    if (stroke) {
      this.page.drawSvgPath(path, {
        x,
        y,
        color: fill,
        borderColor: stroke,
        borderWidth: 1,
      })
      return
    }

    this.page.drawSvgPath(path, {
      x,
      y,
      color: fill,
      borderWidth: 0,
    })
  }

  private rect(left: number, top: number, width: number, height: number, fill: RGB, stroke = C.border, radius = RADIUS.md) {
    this.roundedRect(left, top, width, height, fill, stroke, radius)
  }

  private dot(left: number, top: number, color: RGB) {
    this.page.drawCircle({
      x: left + 5,
      y: this.bottomY(top, 10) + 5,
      size: 4,
      color,
      borderWidth: 0,
    })
  }

  private text(
    value: string,
    left: number,
    top: number,
    size: number,
    color: RGB = C.text,
    maxWidth?: number,
  ) {
    const content = pdfText(value)
    if (!maxWidth) {
      this.page.drawText(content, { x: left, y: this.bottomY(top, size), size, font: this.font, color })
      return
    }

    const words = content.split(/\s+/)
    let line = ''
    let lineTop = top
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (this.font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) {
        this.page.drawText(line, { x: left, y: this.bottomY(lineTop, size), size, font: this.font, color })
        lineTop += size + 3
        line = word
      } else {
        this.page.drawText(word, { x: left, y: this.bottomY(lineTop, size), size, font: this.font, color })
        lineTop += size + 3
        line = ''
      }
    }
    if (line) {
      this.page.drawText(line, { x: left, y: this.bottomY(lineTop, size), size, font: this.font, color })
    }
  }

  private textCentered(
    value: string,
    top: number,
    size: number,
    color: RGB,
    boxLeft: number,
    boxWidth: number,
  ) {
    const content = pdfText(value)
    const width = this.font.widthOfTextAtSize(content, size)
    this.page.drawText(content, {
      x: boxLeft + Math.max(0, (boxWidth - width) / 2),
      y: this.bottomY(top, size),
      size,
      font: this.font,
      color,
    })
  }

  private textBlockCentered(
    value: string,
    top: number,
    size: number,
    color: RGB,
    boxLeft: number,
    boxWidth: number,
    lineGap = 3,
  ) {
    const words = pdfText(value).split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (this.font.widthOfTextAtSize(candidate, size) <= boxWidth - 8) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = word
    }
    if (line) lines.push(line)

    let lineTop = top
    for (const entry of lines) {
      this.textCentered(entry, lineTop, size, color, boxLeft, boxWidth)
      lineTop += size + lineGap
    }
    return lineTop - top
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = MARGIN
    this.paintPageBackground()
  }

  private ensureSpace(height: number) {
    if (this.y + height <= PAGE_HEIGHT - MARGIN) return
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = MARGIN
    this.paintPageBackground()
  }

  private gap(size = 12) {
    this.y += size
  }

  header(kicker: string, headline: string) {
    this.ensureSpace(72)
    this.text(kicker.toUpperCase(), MARGIN, this.y, 8, C.kicker)
    this.y += 12
    this.text(headline, MARGIN, this.y, 20, C.textH)
    this.y += 28
  }

  sectionTitle(title: string, gapAfter = 18) {
    const titleSize = 14
    this.ensureSpace(titleSize + gapAfter + 20)
    this.gap(16)
    this.text(title, MARGIN, this.y, titleSize, C.textH)
    this.y += titleSize + gapAfter
  }

  metricGrid(metrics: Array<{ label: string; value: string }>, columns = 3) {
    const gap = 8
    const cardWidth = (CONTENT_WIDTH - gap * (columns - 1)) / columns
    const cardHeight = 72
    const rows = Math.ceil(metrics.length / columns)
    this.ensureSpace(rows * (cardHeight + gap))

    for (let index = 0; index < metrics.length; index += 1) {
      const column = index % columns
      const row = Math.floor(index / columns)
      const left = MARGIN + column * (cardWidth + gap)
      const top = this.y + row * (cardHeight + gap)
      const metric = metrics[index]

      this.rect(left, top, cardWidth, cardHeight, C.surface2, C.border, RADIUS.md)
      this.textBlockCentered(metric.label.toUpperCase(), top + 14, 7, C.textMuted, left, cardWidth)
      this.textCentered(metric.value, top + 38, 20, C.textH, left, cardWidth)
    }

    this.y += rows * (cardHeight + gap)
    this.gap(6)
  }

  private structureBar(left: number, top: number, width: number, card: BrigadeCardPayload, height = 16) {
    this.roundedRect(left, top, width, height, S.track, undefined, height / 2)
    if (card.total_sec <= 0) return

    const segments = [
      { share: card.work_sec / card.total_sec, color: S.work },
      { share: card.weak_activity_sec / card.total_sec, color: S.weak },
      { share: card.long_idle_sec / card.total_sec, color: S.longIdle },
      { share: card.go_sec / card.total_sec, color: S.go },
    ].filter((segment) => segment.share > 0)

    let offset = 0
    for (const segment of segments) {
      const segmentWidth = Math.max(2, width * segment.share)
      this.page.drawRectangle({
        x: left + offset,
        y: this.bottomY(top, height),
        width: segmentWidth,
        height,
        color: segment.color,
        borderWidth: 0,
      })
      offset += segmentWidth
    }
  }

  private structureLegend(left: number, top: number, width: number) {
    const items: Array<[RGB, string]> = [
      [S.work, 'Активность'],
      [S.weak, 'Слабая активность'],
      [S.longIdle, 'Длительный простой'],
      [S.go, 'Ходьба между зонами'],
    ]

    const columnWidth = width / 2
    items.forEach(([color, label], index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      const itemLeft = left + column * columnWidth
      const itemTop = top + row * 14
      this.dot(itemLeft, itemTop, color)
      this.text(label, itemLeft + 14, itemTop + 1, 8, C.textMuted)
    })
  }

  private miniStat(
    left: number,
    top: number,
    width: number,
    label: string,
    value: string,
    compact = false,
    alert = false,
  ) {
    const height = compact ? 48 : 60
    const labelSize = compact ? 6 : 7
    const valueSize = compact ? 12 : 15
    const valueColor = alert ? C.alert : C.textH
    const labelLines = Math.ceil(this.font.widthOfTextAtSize(label.toUpperCase(), labelSize) / Math.max(width - 16, 1))
    const labelBlockHeight = labelSize + Math.max(0, labelLines - 1) * (labelSize + 2)
    const contentHeight = labelBlockHeight + 6 + valueSize
    const contentTop = top + Math.max(8, (height - contentHeight) / 2)

    this.rect(left, top, width, height, C.surface, C.border, RADIUS.sm)
    this.textBlockCentered(label.toUpperCase(), contentTop, labelSize, C.textMuted, left, width)
    this.textCentered(value, contentTop + labelBlockHeight + 5, valueSize, valueColor, left, width)
    return height
  }

  private drawBrigadeCard(left: number, top: number, cardWidth: number, card: BrigadeCardPayload, compact: boolean) {
    const innerPad = compact ? 14 : 18
    const statGap = compact ? 8 : 8
    const statWidth = (cardWidth - innerPad * 2 - statGap) / 2
    const statRows = compact ? 3 : 3
    const statHeight = compact ? 48 : 60
    const headerBlock = compact ? 28 : 44
    const barHeight = compact ? 10 : 16
    const legendBlock = compact ? 0 : 28
    const bottomPad = compact ? 16 : 18
    const cardHeight =
      innerPad + headerBlock + barHeight + legendBlock + statHeight * statRows + statGap * (statRows - 1) + bottomPad
    const warn = card.activity_pct < 40

    this.rect(left, top, cardWidth, cardHeight, C.surface2, C.border, RADIUS.lg)

    this.text(card.supervisor_name, left + innerPad, top + innerPad, compact ? 11 : 14, C.textH, cardWidth - 72)
    this.text(
      card.subtitle,
      left + innerPad,
      top + innerPad + (compact ? 13 : 18),
      compact ? 7 : 10,
      C.textMuted,
      cardWidth - innerPad * 2,
    )

    const badgeText = pct(card.activity_pct)
    const badgeWidth = this.font.widthOfTextAtSize(badgeText, compact ? 9 : 11) + (compact ? 14 : 20)
    const badgeHeight = compact ? 20 : 24
    const badgeLeft = left + cardWidth - badgeWidth - innerPad
    this.roundedRect(
      badgeLeft,
      top + innerPad - 1,
      badgeWidth,
      badgeHeight,
      warn ? C.alertSoft : C.brandSoft,
      warn ? C.alert : C.brand,
      badgeHeight / 2,
    )
    this.text(
      badgeText,
      badgeLeft + (compact ? 7 : 10),
      top + innerPad + (compact ? 2 : 4),
      compact ? 9 : 11,
      warn ? C.alert : C.brand,
    )

    const barTop = top + innerPad + headerBlock
    this.structureBar(left + innerPad, barTop, cardWidth - innerPad * 2, card, barHeight)
    if (!compact) {
      this.structureLegend(left + innerPad, barTop + barHeight + 6, cardWidth - innerPad * 2)
    }

    let statTop = barTop + barHeight + legendBlock + (compact ? 10 : 12)
    this.miniStat(left + innerPad, statTop, statWidth, 'Активность', pct(card.activity_pct), compact)
    this.miniStat(
      left + innerPad + statWidth + statGap,
      statTop,
      statWidth,
      'Слабая активность',
      pct(card.weak_activity_pct),
      compact,
    )

    statTop += statHeight + statGap
    this.miniStat(left + innerPad, statTop, statWidth, 'Длительный простой', pct(card.long_idle_pct), compact)
    this.miniStat(
      left + innerPad + statWidth + statGap,
      statTop,
      statWidth,
      'Ходьба между зонами',
      pct(card.go_pct),
      compact,
    )

    statTop += statHeight + statGap
    this.miniStat(left + innerPad, statTop, statWidth, card.kpp_label, card.kpp_value, compact, card.kpp_alert)
    this.miniStat(
      left + innerPad + statWidth + statGap,
      statTop,
      statWidth,
      'Длительность смены',
      card.shift_duration,
      compact,
    )

    return cardHeight
  }

  brigadeDashboardCards(cards: BrigadeCardPayload[]) {
    const compact = cards.length >= 2
    const gap = 10
    const columns = compact ? 2 : 1
    const cardWidth = compact ? (CONTENT_WIDTH - gap) / 2 : CONTENT_WIDTH
    const innerPad = compact ? 14 : 18
    const statGap = compact ? 8 : 8
    const statHeight = compact ? 48 : 60
    const headerBlock = compact ? 28 : 44
    const barHeight = compact ? 10 : 16
    const legendBlock = compact ? 0 : 28
    const bottomPad = compact ? 16 : 18
    const cardHeight =
      innerPad + headerBlock + barHeight + legendBlock + statHeight * 3 + statGap * 2 + bottomPad
    const rows = Math.ceil(cards.length / columns)
    const blockHeight = rows * cardHeight + Math.max(0, rows - 1) * gap

    this.ensureSpace(blockHeight + 8)
    const blockTop = this.y

    for (let index = 0; index < cards.length; index += 1) {
      const column = index % columns
      const row = Math.floor(index / columns)
      const left = MARGIN + column * (cardWidth + gap)
      const top = blockTop + row * (cardHeight + gap)
      this.drawBrigadeCard(left, top, cardWidth, cards[index], compact)
    }

    this.y = blockTop + blockHeight + 8
  }

  private sparklineBars(
    left: number,
    top: number,
    width: number,
    points: Array<{ label: string; value: number }>,
  ) {
    if (points.length < 2) {
      this.text('Мало данных', left, top + 4, 7, C.textMuted)
      return 24
    }

    const chartHeight = 28
    const gap = 4
    const barWidth = Math.max(8, Math.min(14, Math.floor((width - gap * (points.length - 1)) / points.length)))
    const values = points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    let offset = 0
    for (let index = 0; index < points.length; index += 1) {
      const value = points[index].value
      const barHeight = Math.max(4, Math.round(((value - min) / range) * (chartHeight - 6)) + 4)
      const isLast = index === points.length - 1
      const barLeft = left + offset
      this.page.drawRectangle({
        x: barLeft,
        y: this.bottomY(top + chartHeight - barHeight, barHeight),
        width: barWidth,
        height: barHeight,
        color: isLast ? C.brand : hex('#9eb8ea'),
        borderWidth: 0,
      })
      offset += barWidth + gap
    }

    this.text(points[0].label, left, top + chartHeight + 4, 6, C.textMuted)
    const lastLabel = points[points.length - 1].label
    const lastLabelWidth = this.font.widthOfTextAtSize(pdfText(lastLabel), 6)
    this.text(lastLabel, left + width - lastLabelWidth, top + chartHeight + 4, 6, C.textMuted)

    return chartHeight + 14
  }

  dynamicsCards(
    cards: Array<{
      name: string
      value: string
      delta: string
      compare: string
      sparkline: Array<{ label: string; value: number }>
      sparklineTitle?: string
    }>,
    periodLabel: string,
  ) {
    const gap = 10
    const cardWidth = (CONTENT_WIDTH - gap) / 2
    const cardHeight = 132
    const rows = Math.ceil(cards.length / 2)
    const blockHeight = rows * (cardHeight + gap)

    this.ensureSpace(blockHeight + 8)
    const blockTop = this.y

    for (let index = 0; index < cards.length; index += 1) {
      const column = index % 2
      const row = Math.floor(index / 2)
      const left = MARGIN + column * (cardWidth + gap)
      const top = blockTop + row * (cardHeight + gap)
      const card = cards[index]

      this.rect(left, top, cardWidth, cardHeight, C.surface, C.border, RADIUS.lg)
      this.text(card.name, left + 12, top + 12, 11, C.textH, cardWidth - 24)
      this.text(periodLabel.toUpperCase(), left + 12, top + 30, 6, C.textMuted)
      this.text(card.value, left + 12, top + 44, 20, C.textH)

      const deltaWidth = this.font.widthOfTextAtSize(pdfText(card.delta), 10)
      this.text(card.delta, left + cardWidth - deltaWidth - 12, top + 34, 10, deltaColor(card.delta))
      this.text(card.compare, left + cardWidth - 118, top + 48, 6, C.textMuted, 106)

      const sparkTop = top + 68
      if (card.sparklineTitle) {
        this.text(card.sparklineTitle, left + 12, sparkTop, 6, C.textMuted, cardWidth - 24)
      }
      this.sparklineBars(left + 12, sparkTop + (card.sparklineTitle ? 10 : 0), cardWidth - 24, card.sparkline)
    }

    this.y = blockTop + blockHeight + 20
  }

  private zoneBar(left: number, top: number, width: number, barPct: number, alert = false) {
    const height = 8
    this.roundedRect(left, top, width, height, S.track, undefined, height / 2)
    const fillWidth = Math.max(barPct > 0 ? 2 : 0, (width * barPct) / 100)
    if (fillWidth <= 0) return
    this.page.drawRectangle({
      x: left,
      y: this.bottomY(top, height),
      width: fillWidth,
      height,
      color: alert ? C.alert : C.brand,
      borderWidth: 0,
    })
  }

  private estimateZonePanelHeight(rows: ZonePanelRow[], hasSummary: boolean) {
    const headerHeight = hasSummary ? 106 : 72
    const rowsHeight = rows.length > 0 ? rows.length * 30 + 8 : 28
    return headerHeight + rowsHeight + 20
  }

  private zonePanel(
    left: number,
    top: number,
    width: number,
    options: {
      kicker: string
      title: string
      description: string
      rows: ZonePanelRow[]
      emptyText: string
      summary?: { label: string; episodes: number; minutes: number }
    },
  ) {
    const rowHeight = 30
    const headerHeight = options.summary ? 106 : 72
    const rowsHeight = options.rows.length > 0 ? options.rows.length * rowHeight + 8 : 28
    const panelHeight = headerHeight + rowsHeight + 20

    this.rect(left, top, width, panelHeight, C.surface, C.border, RADIUS.lg)

    this.text(options.kicker.toUpperCase(), left + 12, top + 12, 7, C.textMuted)

    if (options.summary) {
      const summaryLeft = left + width - 108
      this.text(options.summary.label.toUpperCase(), summaryLeft, top + 12, 6, C.textMuted, 96)
      this.text(`${options.summary.episodes} эп.`, summaryLeft, top + 24, 11, C.textH, 96)
      this.text(`${options.summary.minutes} мин суммарно`, summaryLeft, top + 40, 6, C.textMuted, 96)
    }

    this.text(options.title, left + 12, top + 28, 10, C.textH, options.summary ? width - 124 : width - 24)
    this.text(options.description, left + 12, top + (options.summary ? 58 : 44), 7, C.textMuted, width - 24)

    let rowTop = top + headerHeight
    if (options.rows.length === 0) {
      this.text(options.emptyText, left + 12, rowTop, 8, C.textMuted, width - 24)
      return panelHeight
    }

    for (const row of options.rows) {
      const nameColor = row.alert ? C.alert : C.textH
      const valueColor = row.alert ? C.alert : C.textMuted
      this.text(row.name, left + 12, rowTop, 8, nameColor, width - 88)
      const valueWidth = this.font.widthOfTextAtSize(pdfText(row.value), 8)
      this.text(row.value, left + width - valueWidth - 12, rowTop, 8, valueColor)
      this.zoneBar(left + 12, rowTop + 13, width - 24, row.barPct, row.alert)
      rowTop += rowHeight
    }

    return panelHeight
  }

  zonesBlock(payload: {
    periodLabel: string
    locationDescription: string
    idleDescription: string
    idleSummaryLabel: string
    locationRows: ZonePanelRow[]
    idleRows: ZonePanelRow[]
    idleSummary?: { episodes: number; minutes: number }
  }) {
    const gap = 10
    const panelWidth = (CONTENT_WIDTH - gap) / 2
    const introHeight = 28
    const leftPanelHeight = this.estimateZonePanelHeight(payload.locationRows, false)
    const rightPanelHeight = this.estimateZonePanelHeight(payload.idleRows, Boolean(payload.idleSummary))
    const blockHeight = introHeight + Math.max(leftPanelHeight, rightPanelHeight) + 8

    this.ensureSpace(blockHeight + 8)
    const top = this.y

    this.text(
      `Где сотрудники проводили время ${payload.periodLabel} и эпизоды длительного бездействия от 10 минут с привязкой к зоне.`,
      MARGIN,
      top,
      8,
      C.textMuted,
      CONTENT_WIDTH,
    )

    const panelTop = top + introHeight
    const leftHeight = this.zonePanel(MARGIN, panelTop, panelWidth, {
      kicker: 'Местоположение',
      title: 'Распределение времени по зонам',
      description: payload.locationDescription,
      rows: payload.locationRows,
      emptyText: `Нет данных по зонам ${payload.periodLabel}.`,
    })

    const rightHeight = this.zonePanel(MARGIN + panelWidth + gap, panelTop, panelWidth, {
      kicker: 'Простои',
      title: 'Длительные простои',
      description: payload.idleDescription,
      rows: payload.idleRows,
      emptyText: `Данные о длительных простоях ${payload.periodLabel} не загружены или простоев нет.`,
      summary: payload.idleSummary
        ? {
            label: payload.idleSummaryLabel,
            episodes: payload.idleSummary.episodes,
            minutes: payload.idleSummary.minutes,
          }
        : undefined,
    })

    this.y = panelTop + Math.max(leftHeight, rightHeight) + 12
  }

  personList(
    rows: Array<{ name: string; meta: string; value: string }>,
    emptyText: string,
    variant: 'default' | 'alert' | 'success' = 'default',
  ) {
    if (rows.length === 0) {
      this.text(emptyText, MARGIN, this.y, 9, C.textMuted)
      this.y += 20
      return
    }

    const fill = variant === 'alert' ? C.alertSoft : variant === 'success' ? C.workSoft : C.surface
    const stroke = variant === 'alert' ? C.alert : variant === 'success' ? C.work : C.border
    const padY = 12

    const rowHeights = rows.map((row) => {
      const valueWidth = this.font.widthOfTextAtSize(pdfText(row.value), 10)
      return valueWidth > 96 ? 40 : 34
    })
    const listHeight = padY * 2 + rowHeights.reduce((sum, height) => sum + height, 0)

    this.ensureSpace(listHeight + 12)
    const top = this.y
    this.rect(MARGIN, top, CONTENT_WIDTH, listHeight, fill, stroke, RADIUS.lg)

    let rowTop = top + padY
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowHeight = rowHeights[index]
      const valueWidth = this.font.widthOfTextAtSize(pdfText(row.value), 10)
      const valueOnOwnLine = valueWidth > 96

      if (valueOnOwnLine) {
        this.text(row.name, MARGIN + 14, rowTop, 10, C.textH, CONTENT_WIDTH - 28)
        this.text(row.meta, MARGIN + 14, rowTop + 14, 7, C.textMuted, CONTENT_WIDTH - 28)
        this.text(row.value, MARGIN + 14, rowTop + 26, 8, C.textH, CONTENT_WIDTH - 28)
      } else {
        this.text(row.name, MARGIN + 14, rowTop, 10, C.textH, CONTENT_WIDTH - 110)
        this.text(row.value, PAGE_WIDTH - MARGIN - valueWidth - 14, rowTop, 10, C.textH)
        this.text(row.meta, MARGIN + 14, rowTop + 14, 7, C.textMuted, CONTENT_WIDTH - 28)
      }

      rowTop += rowHeight
    }

    this.y = top + listHeight + 12
  }

  footer(label: string) {
    this.ensureSpace(36)
    this.gap(12)
    const top = this.y
    this.rect(MARGIN, top, CONTENT_WIDTH, 26, C.surface2, C.border, RADIUS.md)
    this.text(label, MARGIN + 14, top + 9, 8, C.textMuted)
    this.y = top + 26
  }
}

export async function renderReportPdf(payload: ReportPdfPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(getRobotoFontBytes())
  const writer = new PdfWriter(doc, font)

  writer.header(payload.title.toUpperCase(), payload.subtitle)
  writer.metricGrid(payload.metrics, 3)
  writer.sectionTitle(payload.brigadeSectionTitle, 14)
  writer.brigadeDashboardCards(payload.brigadeCards)
  writer.sectionTitle(payload.dynamicsTitle, 16)
  writer.dynamicsCards(payload.dynamicsCards, payload.dynamicsPeriodLabel)

  writer.newPage()
  writer.sectionTitle(payload.zonesTitle, 14)
  writer.zonesBlock({
    periodLabel: payload.zonesPeriodLabel,
    locationDescription: payload.zonesLocationDescription,
    idleDescription: payload.zonesIdleDescription,
    idleSummaryLabel: payload.zonesIdleSummaryLabel,
    locationRows: payload.zonesLocationRows,
    idleRows: payload.zonesIdleRows,
    idleSummary: payload.zonesIdleSummary,
  })

  writer.newPage()
  writer.sectionTitle(payload.topActivityTitle, 16)
  writer.personList(payload.topActivityRows, 'Нет данных для топа по активности.', 'success')
  writer.sectionTitle(payload.attentionTitle, 16)
  writer.personList(payload.attentionRows, 'Сотрудников с активностью ниже 30% нет.', 'alert')

  if (payload.kppTitle) {
    writer.newPage()
    writer.sectionTitle(payload.kppTitle, 16)
    writer.personList(payload.kppRows ?? [], 'На КПП никого не фиксировалось.', 'alert')
  }

  writer.footer('Work Watch Analytics')

  return new Uint8Array(await doc.save())
}
