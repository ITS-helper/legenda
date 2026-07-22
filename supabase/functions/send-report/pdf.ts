import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'npm:pdf-lib@1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'
import { getRobotoFontBytes } from './roboto-font.ts'
import { REPORT_LOGO_TEXT } from './email-branding.ts'
import { formatEpisodeCount } from './zones.ts'
import { brigadeGridColumns, isCompactBrigadeCardLayout, isHorizontalBrigadeLayout } from './brigadeLayout.ts'

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
  shift_duration: string
  volume_total?: string
}

export type ZonePanelRow = {
  name: string
  value: string
  barPct: number
  alert: boolean
}

export type BrigadeZonesPdfSection = {
  supervisor_name: string
  zonesPeriodLabel: string
  zonesLocationDescription: string
  zonesIdleDescription: string
  zonesIdleSummaryLabel: string
  zonesLocationRows: ZonePanelRow[]
  zonesIdleRows: ZonePanelRow[]
  zonesIdleSummary?: { episodes: number; minutes: number }
}

export type ReportPdfPayload = {
  title: string
  reportEssence: string
  reportObjectName: string
  subtitle: string
  metrics: Array<{ label: string; value: string }>
  metricsColumns?: number
  brigadeSectionTitle: string
  brigadeCards: BrigadeCardPayload[]
  dynamicsTitle: string
  dynamicsPeriodLabel: string
  dynamicsCards: Array<{
    name: string
    value: string
    delta: string
    compare: string
    sparkline: Array<{ label: string; value: number; empty?: boolean }>
    sparklineTitle?: string
  }>
  volumeDynamicsTitle?: string
  volumeDynamicsPeriodLabel?: string
  volumeDynamicsCards?: Array<{
    name: string
    value: string
    delta: string
    compare: string
    sparkline: Array<{ label: string; value: number; empty?: boolean }>
    sparklineTitle?: string
  }>
  weeklyOutputTitle?: string
  weeklyOutputPeriodLabel?: string
  weeklyOutputCards?: Array<{
    name: string
    value: string
    delta: string
    compare: string
    sparkline: Array<{ label: string; value: number; empty?: boolean }>
    sparklineTitle?: string
  }>
  zonesTitle: string
  zonesBrigadeSections: BrigadeZonesPdfSection[]
  attentionSection?: {
    title: string
    description: string
    rows: Array<{ name: string; meta: string; value: string }>
    emptyText: string
  }
  dynamicsBeforeBrigades?: boolean
  /** Недельный порядок: бригады → активность → объёмы → выработка → внимание → зоны. */
  weeklyLayout?: boolean
  singlePage?: boolean
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const RADIUS = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
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

function resolveMetricsColumns(metrics: Array<{ label: string; value: string }>, requested?: number) {
  if (requested != null && requested > 0) return requested
  if (metrics.length === 5) return 5
  return 3
}

class PdfWriter {
  private page: PDFPage
  private y = MARGIN
  private pageHeight: number
  private readonly singlePage: boolean

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    options?: { pageHeight?: number; singlePage?: boolean },
  ) {
    this.pageHeight = options?.pageHeight ?? PAGE_HEIGHT
    this.singlePage = options?.singlePage ?? false
    this.page = doc.addPage([PAGE_WIDTH, this.pageHeight])
    this.paintPageBackground()
  }

  private paintPageBackground() {
    this.page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: this.pageHeight,
      color: C.page,
    })
  }

  private bottomY(top: number, height: number) {
    return this.pageHeight - top - height
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
    const y = this.pageHeight - top
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

  private card(
    left: number,
    top: number,
    width: number,
    height: number,
    fill: RGB = C.surface,
    stroke = C.border,
    radius = RADIUS.lg,
  ) {
    this.rect(left, top, width, height, fill, stroke, radius)
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
    if (this.singlePage) return
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.pageHeight = PAGE_HEIGHT
    this.y = MARGIN
    this.paintPageBackground()
  }

  private ensureSpace(height: number) {
    if (this.singlePage) return
    if (this.y + height <= this.pageHeight - MARGIN) return
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.pageHeight = PAGE_HEIGHT
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

  brandedHeader(essence: string, objectName: string, headline: string) {
    const logoSize = 22
    this.ensureSpace(logoSize + 78)

    this.text(REPORT_LOGO_TEXT, MARGIN, this.y, logoSize, rgb(0, 0, 0))
    this.y += logoSize + 12
    this.text(essence.toUpperCase(), MARGIN, this.y, 8, C.kicker)
    this.y += 11
    this.text(objectName.toUpperCase(), MARGIN, this.y, 7, C.textMuted)
    this.y += 12
    this.text(headline, MARGIN, this.y, 20, C.textH)
    this.y += 28
    this.gap(24)
  }

  sectionTitle(title: string, gapAfter = 18, followingContentHeight = 0) {
    const titleSize = 14
    const titleBlockHeight = 16 + titleSize + gapAfter
    this.ensureSpace(titleBlockHeight + followingContentHeight + 8)
    this.gap(16)
    this.text(title, MARGIN, this.y, titleSize, C.textH)
    this.y += titleSize + gapAfter
  }

  metricGrid(metrics: Array<{ label: string; value: string }>, columns = 3) {
    const resolvedColumns = resolveMetricsColumns(metrics, columns)
    const compactRow = resolvedColumns >= metrics.length && metrics.length >= 4
    const gap = compactRow ? 8 : 16
    const cardWidth = (CONTENT_WIDTH - gap * (resolvedColumns - 1)) / resolvedColumns
    const cardHeight = compactRow ? 74 : 88
    const rows = Math.ceil(metrics.length / resolvedColumns)
    const lastRowCount = metrics.length % resolvedColumns || resolvedColumns
    this.ensureSpace(rows * (cardHeight + gap))

    for (let index = 0; index < metrics.length; index += 1) {
      const column = index % resolvedColumns
      const row = Math.floor(index / resolvedColumns)
      const isLastRow = row === rows - 1
      const rowCount = isLastRow ? lastRowCount : resolvedColumns
      const rowWidth = rowCount * cardWidth + Math.max(0, rowCount - 1) * gap
      const rowOffset = rowCount < columns ? (CONTENT_WIDTH - rowWidth) / 2 : 0
      const left = MARGIN + rowOffset + column * (cardWidth + gap)
      const top = this.y + row * (cardHeight + gap)
      const metric = metrics[index]

      if (compactRow) {
        const pad = 8
        const labelSize = 5.5
        const innerGap = 3
        const valueSize = metric.value.length > 9 ? 13 : 16
        const labelWidth = Math.max(cardWidth - 8, 1)
        const labelLines = Math.ceil(
          this.font.widthOfTextAtSize(metric.label.toUpperCase(), labelSize) / labelWidth,
        )
        const labelBlockHeight = labelSize + Math.max(0, labelLines - 1) * (labelSize + 2)
        const contentHeight = labelBlockHeight + innerGap + valueSize
        const contentTop = top + pad + Math.max(0, (cardHeight - pad * 2 - contentHeight) / 2)

        this.card(left, top, cardWidth, cardHeight, C.surface2, C.border, RADIUS.lg)
        this.textBlockCentered(
          metric.label.toUpperCase(),
          contentTop,
          labelSize,
          C.textMuted,
          left,
          cardWidth,
          2,
        )
        this.textCentered(
          metric.value,
          contentTop + labelBlockHeight + innerGap,
          valueSize,
          C.textH,
          left,
          cardWidth,
        )
        continue
      }

      const labelSize = 7
      const labelWidth = Math.max(cardWidth - 24, 1)
      const labelLines = Math.ceil(
        this.font.widthOfTextAtSize(metric.label.toUpperCase(), labelSize) / labelWidth,
      )
      const labelBlockHeight = labelSize + Math.max(0, labelLines - 1) * (labelSize + 2)
      const valueSize = metric.value.length > 9 ? 18 : 22
      const contentHeight = 14 + labelBlockHeight + 8 + valueSize + 14
      const contentTop = top + Math.max(12, (cardHeight - contentHeight) / 2)

      this.card(left, top, cardWidth, cardHeight, C.surface, C.border, RADIUS.xl)
      this.textBlockCentered(
        metric.label.toUpperCase(),
        contentTop,
        labelSize,
        C.textMuted,
        left,
        cardWidth,
      )
      this.textCentered(
        metric.value,
        contentTop + labelBlockHeight + 8,
        valueSize,
        C.textH,
        left,
        cardWidth,
      )
    }

    this.y += rows * (cardHeight + gap)
    this.gap(8)
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
    const labelSize = compact ? 6 : 7
    const valueSize = compact ? 12 : 15
    const valueColor = alert ? C.alert : C.textH
    const labelWidth = Math.max(width - 20, 1)
    const labelLines = Math.ceil(this.font.widthOfTextAtSize(label.toUpperCase(), labelSize) / labelWidth)
    const labelBlockHeight = labelSize + Math.max(0, labelLines - 1) * (labelSize + 2)
    const contentHeight = labelBlockHeight + 6 + valueSize
    const height = compact
      ? Math.max(52, contentHeight + 16)
      : Math.max(60, contentHeight + 20)
    const contentTop = top + Math.max(8, (height - contentHeight) / 2)

    this.card(left, top, width, height, C.surface, C.border, RADIUS.sm)
    this.textBlockCentered(label.toUpperCase(), contentTop, labelSize, C.textMuted, left, width)
    this.textCentered(value, contentTop + labelBlockHeight + 5, valueSize, valueColor, left, width)
    return height
  }

  private drawBrigadeCard(left: number, top: number, cardWidth: number, card: BrigadeCardPayload, compact: boolean) {
    const innerPad = compact ? 14 : 18
    const statGap = compact ? 8 : 8
    const statWidth = (cardWidth - innerPad * 2 - statGap) / 2
    const statRows = 3
    const statHeight = compact ? 54 : 60
    const headerBlock = compact ? 40 : 44
    const barHeight = compact ? 10 : 16
    const legendBlock = 28
    const bottomPad = compact ? 16 : 18
    const cardHeight =
      innerPad + headerBlock + barHeight + legendBlock + statHeight * statRows + statGap * (statRows - 1) + bottomPad
    const warn = card.activity_pct < 40

    this.card(left, top, cardWidth, cardHeight, C.surface2, C.border, RADIUS.xl)

    const badgeText = pct(card.activity_pct)
    const badgeWidth = this.font.widthOfTextAtSize(badgeText, compact ? 9 : 11) + (compact ? 14 : 20)
    const badgeHeight = compact ? 20 : 24
    const badgeLeft = left + cardWidth - badgeWidth - innerPad
    const textWidth = cardWidth - innerPad * 2 - badgeWidth - 8

    this.text(card.supervisor_name, left + innerPad, top + innerPad, compact ? 11 : 14, C.textH, textWidth)
    this.text(
      card.subtitle,
      left + innerPad,
      top + innerPad + (compact ? 13 : 18),
      compact ? 7 : 10,
      C.textMuted,
      textWidth,
    )

    const badgeTop = top + innerPad + (compact ? 4 : 6)
    this.roundedRect(
      badgeLeft,
      badgeTop,
      badgeWidth,
      badgeHeight,
      warn ? C.alertSoft : C.brandSoft,
      warn ? C.alert : C.brand,
      badgeHeight / 2,
    )
    this.text(
      badgeText,
      badgeLeft + (compact ? 7 : 10),
      badgeTop + (compact ? 3 : 5),
      compact ? 9 : 11,
      warn ? C.alert : C.brand,
    )

    const barTop = top + innerPad + headerBlock
    this.structureBar(left + innerPad, barTop, cardWidth - innerPad * 2, card, barHeight)
    this.structureLegend(left + innerPad, barTop + barHeight + 6, cardWidth - innerPad * 2)

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
    this.miniStat(left + innerPad, statTop, statWidth, 'Длительность смены', card.shift_duration, compact)
    if (card.volume_total) {
      this.miniStat(
        left + innerPad + statWidth + statGap,
        statTop,
        statWidth,
        'Объём',
        card.volume_total,
        compact,
      )
    }

    return cardHeight
  }

  brigadeDashboardCards(cards: BrigadeCardPayload[]) {
    const columns = brigadeGridColumns(cards.length)
    const compact = isCompactBrigadeCardLayout(cards.length)
    const gap = 16
    const cardWidth = columns === 1 ? CONTENT_WIDTH : (CONTENT_WIDTH - gap) / columns
    const innerPad = compact ? 14 : 18
    const statGap = compact ? 8 : 8
    const statHeight = compact ? 54 : 60
    const headerBlock = compact ? 40 : 44
    const barHeight = compact ? 10 : 16
    const legendBlock = 28
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
    points: Array<{ label: string; value: number; empty?: boolean }>,
  ) {
    if (points.length < 2) {
      this.text('Мало данных', left, top + 4, 7, C.textMuted)
      return 24
    }

    const chartHeight = 30
    const labelHeight = 10
    const gap = 2
    const barWidth = Math.max(4, Math.floor((width - gap * (points.length - 1)) / points.length))
    const numericValues = points.filter((point) => !point.empty).map((point) => point.value)
    const min = Math.min(...numericValues)
    const max = Math.max(...numericValues)
    const range = max - min || 1

    let offset = 0
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const isLast = index === points.length - 1
      const barHeight = point.empty
        ? 2
        : Math.max(4, Math.round(((point.value - min) / range) * (chartHeight - 6)) + 4)
      const barLeft = left + offset
      this.page.drawRectangle({
        x: barLeft,
        y: this.bottomY(top + chartHeight - barHeight, barHeight),
        width: barWidth,
        height: barHeight,
        color: point.empty ? S.track : isLast ? C.brand : rgb(0 / 255, 78 / 255, 207 / 255, 0.35),
        borderWidth: 0,
      })

      const label = pdfText(point.label)
      const labelSize = 5
      const labelWidth = this.font.widthOfTextAtSize(label, labelSize)
      const labelLeft = barLeft + Math.max(0, (barWidth - labelWidth) / 2)
      this.text(label, labelLeft, top + chartHeight + 4, labelSize, isLast ? C.brand : C.textMuted)
      offset += barWidth + gap
    }

    return chartHeight + labelHeight + 6
  }

  dynamicsCards(
    cards: Array<{
      name: string
      value: string
      delta: string
      compare: string
      sparkline: Array<{ label: string; value: number; empty?: boolean }>
      sparklineTitle?: string
    }>,
    periodLabel: string,
  ) {
    const gap = 16
    const columns = brigadeGridColumns(cards.length)
    const cardWidth = columns === 1 ? CONTENT_WIDTH : (CONTENT_WIDTH - gap) / columns
    const innerPad = 16
    const cardHeight = 190
    const rows = Math.ceil(cards.length / columns)
    const blockHeight = rows * (cardHeight + gap)

    this.ensureSpace(blockHeight + 8)
    const blockTop = this.y

    for (let index = 0; index < cards.length; index += 1) {
      const column = index % columns
      const row = Math.floor(index / columns)
      const left = MARGIN + column * (cardWidth + gap)
      const top = blockTop + row * (cardHeight + gap)
      const card = cards[index]
      const dayBoxTop = top + 52
      const dayBoxHeight = 54
      const periodText = periodLabel.toUpperCase()

      this.card(left, top, cardWidth, cardHeight, C.surface, C.border, RADIUS.xl)
      this.text(card.name, left + innerPad, top + innerPad, 12, C.textH, cardWidth - innerPad * 2)
      this.text('Активность', left + innerPad, top + innerPad + 16, 6, C.textMuted)

      this.roundedRect(
        left + innerPad,
        dayBoxTop,
        cardWidth - innerPad * 2,
        dayBoxHeight,
        C.surface2,
        undefined,
        RADIUS.md,
      )
      this.text(periodText, left + innerPad + 12, dayBoxTop + 10, 6, C.textMuted)
      this.text(
        card.compare,
        left + innerPad + 12,
        dayBoxTop + 18,
        6,
        C.textMuted,
        cardWidth - innerPad * 2 - 24,
      )
      this.text(card.value, left + innerPad + 12, dayBoxTop + 32, 22, C.textH)

      const deltaWidth = this.font.widthOfTextAtSize(pdfText(card.delta), 11)
      this.text(
        card.delta,
        left + cardWidth - innerPad - deltaWidth - 12,
        dayBoxTop + 10,
        11,
        deltaColor(card.delta),
      )

      const sparkTop = dayBoxTop + dayBoxHeight + 12
      if (card.sparklineTitle) {
        this.text(card.sparklineTitle, left + innerPad, sparkTop, 6, C.textMuted, cardWidth - innerPad * 2)
      }
      this.sparklineBars(
        left + innerPad,
        sparkTop + (card.sparklineTitle ? 10 : 0),
        cardWidth - innerPad * 2,
        card.sparkline,
      )
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
    return estimateZonePanelHeight(rows, hasSummary)
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
      minHeight?: number
    },
  ) {
    const rowHeight = 30
    const headerHeight = options.summary ? 106 : 72
    const rowsHeight = options.rows.length > 0 ? options.rows.length * rowHeight + 8 : 28
    const panelHeight = Math.max(headerHeight + rowsHeight + 20, options.minHeight ?? 0)

    this.card(left, top, width, panelHeight, C.surface, C.border, RADIUS.lg)

    this.text(options.kicker.toUpperCase(), left + 12, top + 12, 7, C.textMuted)

    if (options.summary) {
      const summaryLeft = left + width - 108
      this.text(options.summary.label.toUpperCase(), summaryLeft, top + 12, 6, C.textMuted, 96)
      this.text(formatEpisodeCount(options.summary.episodes), summaryLeft, top + 24, 11, C.textH, 96)
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

  zonesBrigadeMatrix(sections: BrigadeZonesPdfSection[]) {
    if (sections.length === 0) return

    const gap = 10
    const introHeight = 28

    if (isHorizontalBrigadeLayout(sections.length)) {
      const sectionGap = 16
      const blockHeight =
        introHeight +
        sections.reduce((sum, section) => {
          const locationHeight = this.estimateZonePanelHeight(section.zonesLocationRows, false)
          const idleHeight = this.estimateZonePanelHeight(
            section.zonesIdleRows,
            Boolean(section.zonesIdleSummary),
          )
          return sum + 18 + locationHeight + 10 + idleHeight + sectionGap
        }, 0) +
        8

      this.ensureSpace(blockHeight + 8)
      const top = this.y

      this.text(
        'Где сотрудники проводили время и эпизоды длительного бездействия от 10 минут с привязкой к зоне.',
        MARGIN,
        top,
        8,
        C.textMuted,
        CONTENT_WIDTH,
      )

      let currentTop = top + introHeight
      for (const section of sections) {
        this.text(section.supervisor_name, MARGIN, currentTop, 10, C.textH, CONTENT_WIDTH)

        const locationTop = currentTop + 18
        const locationHeight = this.zonePanel(MARGIN, locationTop, CONTENT_WIDTH, {
          kicker: 'Местоположение',
          title: 'Распределение времени по зонам',
          description: section.zonesLocationDescription,
          rows: section.zonesLocationRows,
          emptyText: `Нет данных по зонам ${section.zonesPeriodLabel}.`,
        })

        const idleTop = locationTop + locationHeight + 10
        const idleHeight = this.zonePanel(MARGIN, idleTop, CONTENT_WIDTH, {
          kicker: 'Простои',
          title: 'Длительные простои',
          description: section.zonesIdleDescription,
          rows: section.zonesIdleRows,
          emptyText: `Данные о длительных простоях ${section.zonesPeriodLabel} не загружены или простоев нет.`,
          summary: section.zonesIdleSummary
            ? {
                label: section.zonesIdleSummaryLabel,
                episodes: section.zonesIdleSummary.episodes,
                minutes: section.zonesIdleSummary.minutes,
              }
            : undefined,
        })

        currentTop = idleTop + idleHeight + sectionGap
      }

      this.y = currentTop + 8
      return
    }

    const columnWidth = (CONTENT_WIDTH - gap * (sections.length - 1)) / sections.length
    const maxLocationHeight = Math.max(
      ...sections.map((section) => this.estimateZonePanelHeight(section.zonesLocationRows, false)),
      0,
    )
    const maxIdleHeight = Math.max(
      ...sections.map((section) => this.estimateZonePanelHeight(section.zonesIdleRows, Boolean(section.zonesIdleSummary))),
      0,
    )
    const blockHeight = introHeight + 18 + maxLocationHeight + 10 + maxIdleHeight + 8

    this.ensureSpace(blockHeight + 8)
    const top = this.y

    this.text(
      'Где сотрудники проводили время и эпизоды длительного бездействия от 10 минут с привязкой к зоне.',
      MARGIN,
      top,
      8,
      C.textMuted,
      CONTENT_WIDTH,
    )

    let headerTop = top + introHeight
    for (let index = 0; index < sections.length; index += 1) {
      const left = MARGIN + index * (columnWidth + gap)
      this.text(sections[index].supervisor_name, left, headerTop, 10, C.textH, columnWidth)
    }

    const locationTop = headerTop + 18
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index]
      const left = MARGIN + index * (columnWidth + gap)
      this.zonePanel(left, locationTop, columnWidth, {
        kicker: 'Местоположение',
        title: 'Распределение времени по зонам',
        description: section.zonesLocationDescription,
        rows: section.zonesLocationRows,
        emptyText: `Нет данных по зонам ${section.zonesPeriodLabel}.`,
        minHeight: maxLocationHeight,
      })
    }

    const idleTop = locationTop + maxLocationHeight + 10
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index]
      const left = MARGIN + index * (columnWidth + gap)
      this.zonePanel(left, idleTop, columnWidth, {
        kicker: 'Простои',
        title: 'Длительные простои',
        description: section.zonesIdleDescription,
        rows: section.zonesIdleRows,
        emptyText: `Данные о длительных простоях ${section.zonesPeriodLabel} не загружены или простоев нет.`,
        summary: section.zonesIdleSummary
          ? {
              label: section.zonesIdleSummaryLabel,
              episodes: section.zonesIdleSummary.episodes,
              minutes: section.zonesIdleSummary.minutes,
            }
          : undefined,
        minHeight: maxIdleHeight,
      })
    }

    this.y = idleTop + maxIdleHeight + 12
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

  attentionSection(section: NonNullable<ReportPdfPayload['attentionSection']>) {
    this.sectionTitle(section.title, 10, personListHeight(section.rows))
    this.text(section.description, MARGIN, this.y, 8, C.textMuted, CONTENT_WIDTH)
    this.y += 14
    this.personList(section.rows, section.emptyText, 'alert')
  }
}

function brigadeBlockHeight(cardCount: number) {
  const columns = brigadeGridColumns(cardCount)
  const compact = isCompactBrigadeCardLayout(cardCount)
  const gap = 16
  const innerPad = compact ? 14 : 18
  const statGap = 8
  const statHeight = compact ? 54 : 60
  const headerBlock = compact ? 40 : 44
  const barHeight = compact ? 10 : 16
  const legendBlock = 28
  const bottomPad = compact ? 16 : 18
  const cardHeight =
    innerPad + headerBlock + barHeight + legendBlock + statHeight * 3 + statGap * 2 + bottomPad
  const rows = Math.ceil(cardCount / columns)
  return rows * cardHeight + Math.max(0, rows - 1) * gap + 8
}

function dynamicsBlockHeight(cardCount: number) {
  const gap = 16
  const cardHeight = 190
  const columns = brigadeGridColumns(cardCount)
  const rows = Math.ceil(cardCount / columns)
  return rows * (cardHeight + gap) + 20
}

function estimateZonePanelHeight(rows: ZonePanelRow[], hasSummary: boolean) {
  const headerHeight = hasSummary ? 106 : 72
  const rowsHeight = rows.length > 0 ? rows.length * 30 + 8 : 28
  return headerHeight + rowsHeight + 20
}

function metricGridHeight(metrics: Array<{ label: string; value: string }>, columns = 3) {
  const resolvedColumns = resolveMetricsColumns(metrics, columns)
  const compactRow = resolvedColumns >= metrics.length && metrics.length >= 4
  const gap = compactRow ? 8 : 16
  const cardHeight = compactRow ? 74 : 88
  const rows = Math.ceil(metrics.length / resolvedColumns)
  return rows * (cardHeight + gap) + 8
}

function sectionTitleHeight(gapAfter: number) {
  return 16 + 14 + gapAfter
}

function zonesBrigadeMatrixHeight(sections: BrigadeZonesPdfSection[]) {
  if (sections.length === 0) return 0

  const introHeight = 28

  if (isHorizontalBrigadeLayout(sections.length)) {
    const sectionGap = 16
    return (
      introHeight +
      sections.reduce((sum, section) => {
        const locationHeight = estimateZonePanelHeight(section.zonesLocationRows, false)
        const idleHeight = estimateZonePanelHeight(
          section.zonesIdleRows,
          Boolean(section.zonesIdleSummary),
        )
        return sum + 18 + locationHeight + 10 + idleHeight + sectionGap
      }, 0) +
      12
    )
  }

  const maxLocationHeight = Math.max(
    ...sections.map((section) => estimateZonePanelHeight(section.zonesLocationRows, false)),
    0,
  )
  const maxIdleHeight = Math.max(
    ...sections.map((section) =>
      estimateZonePanelHeight(section.zonesIdleRows, Boolean(section.zonesIdleSummary))
    ),
    0,
  )

  return introHeight + 18 + maxLocationHeight + 10 + maxIdleHeight + 12
}

function personListHeight(rows: Array<{ name: string; meta: string; value: string }>) {
  if (rows.length === 0) return 20
  const padY = 12
  const rowHeights = rows.map((row) => {
    const valueWidth = 96 // approximate check in personList
    return row.value.length > 12 ? 40 : 34
  })
  return padY * 2 + rowHeights.reduce((sum, height) => sum + height, 0) + 12
}

function attentionSectionHeight(section?: ReportPdfPayload['attentionSection']) {
  if (!section) return 0
  return sectionTitleHeight(10) + 14 + personListHeight(section.rows) + 8
}

function estimateReportPdfHeight(payload: ReportPdfPayload) {
  let height = MARGIN + 85 + 24 + metricGridHeight(payload.metrics, payload.metricsColumns ?? 3)

  if (payload.weeklyLayout) {
    height += sectionTitleHeight(14) + brigadeBlockHeight(payload.brigadeCards.length)
    height += sectionTitleHeight(16) + dynamicsBlockHeight(payload.dynamicsCards.length)
    if (payload.volumeDynamicsCards?.length) {
      height += sectionTitleHeight(16) + dynamicsBlockHeight(payload.volumeDynamicsCards.length)
    }
    if (payload.weeklyOutputCards?.length) {
      height += sectionTitleHeight(16) + dynamicsBlockHeight(payload.weeklyOutputCards.length)
    }
    height += attentionSectionHeight(payload.attentionSection)
    height += sectionTitleHeight(18) + zonesBrigadeMatrixHeight(payload.zonesBrigadeSections)
    return Math.max(PAGE_HEIGHT, Math.ceil(height))
  }

  if (payload.dynamicsBeforeBrigades) {
    height += sectionTitleHeight(16) + dynamicsBlockHeight(payload.dynamicsCards.length)
    height += sectionTitleHeight(14) + brigadeBlockHeight(payload.brigadeCards.length)
    height += attentionSectionHeight(payload.attentionSection)
  } else {
    height += sectionTitleHeight(14) + brigadeBlockHeight(payload.brigadeCards.length)
    height += attentionSectionHeight(payload.attentionSection)
    height += sectionTitleHeight(16) + dynamicsBlockHeight(payload.dynamicsCards.length)
  }

  if (payload.volumeDynamicsCards?.length) {
    height += sectionTitleHeight(16) + dynamicsBlockHeight(payload.volumeDynamicsCards.length)
  }

  height += sectionTitleHeight(18) + zonesBrigadeMatrixHeight(payload.zonesBrigadeSections)
  height += MARGIN + 24

  return Math.max(PAGE_HEIGHT, Math.ceil(height))
}

export async function renderReportPdf(payload: ReportPdfPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(getRobotoFontBytes())
  const singlePage = payload.singlePage ?? false
  const pageHeight = singlePage ? estimateReportPdfHeight(payload) : PAGE_HEIGHT
  const writer = new PdfWriter(doc, font, { pageHeight, singlePage })

  writer.brandedHeader(payload.reportEssence, payload.reportObjectName, payload.subtitle)
  writer.metricGrid(payload.metrics, payload.metricsColumns ?? 3)

  if (payload.weeklyLayout) {
    // Бригады → Динамика активности → Динамика объёмов → Выработка → Внимание → Зоны.
    writer.sectionTitle(payload.brigadeSectionTitle, 14, brigadeBlockHeight(payload.brigadeCards.length))
    writer.brigadeDashboardCards(payload.brigadeCards)
    writer.sectionTitle(payload.dynamicsTitle, 16, dynamicsBlockHeight(payload.dynamicsCards.length))
    writer.dynamicsCards(payload.dynamicsCards, payload.dynamicsPeriodLabel)
    if (payload.volumeDynamicsCards?.length) {
      writer.sectionTitle(
        payload.volumeDynamicsTitle ?? 'Динамика выполненных объёмов',
        16,
        dynamicsBlockHeight(payload.volumeDynamicsCards.length),
      )
      writer.dynamicsCards(payload.volumeDynamicsCards, payload.volumeDynamicsPeriodLabel ?? 'За неделю')
    }
    if (payload.weeklyOutputCards?.length) {
      writer.sectionTitle(
        payload.weeklyOutputTitle ?? 'Выработка на человека по неделям',
        16,
        dynamicsBlockHeight(payload.weeklyOutputCards.length),
      )
      writer.dynamicsCards(payload.weeklyOutputCards, payload.weeklyOutputPeriodLabel ?? 'По неделям')
    }
    if (payload.attentionSection) {
      writer.attentionSection(payload.attentionSection)
    }
    if (!singlePage) {
      writer.newPage()
    }
    writer.sectionTitle(payload.zonesTitle, 14)
    writer.zonesBrigadeMatrix(payload.zonesBrigadeSections)
    return new Uint8Array(await doc.save())
  }

  if (payload.dynamicsBeforeBrigades) {
    writer.sectionTitle(payload.dynamicsTitle, 16, dynamicsBlockHeight(payload.dynamicsCards.length))
    writer.dynamicsCards(payload.dynamicsCards, payload.dynamicsPeriodLabel)
    writer.sectionTitle(payload.brigadeSectionTitle, 14, brigadeBlockHeight(payload.brigadeCards.length))
    writer.brigadeDashboardCards(payload.brigadeCards)
    if (payload.attentionSection) {
      writer.attentionSection(payload.attentionSection)
    }
  } else {
    writer.sectionTitle(payload.brigadeSectionTitle, 14, brigadeBlockHeight(payload.brigadeCards.length))
    writer.brigadeDashboardCards(payload.brigadeCards)
    if (payload.attentionSection) {
      writer.attentionSection(payload.attentionSection)
    }
    writer.sectionTitle(payload.dynamicsTitle, 16, dynamicsBlockHeight(payload.dynamicsCards.length))
    writer.dynamicsCards(payload.dynamicsCards, payload.dynamicsPeriodLabel)
  }

  if (payload.volumeDynamicsCards?.length) {
    writer.sectionTitle(
      payload.volumeDynamicsTitle ?? 'Динамика выполненных объёмов',
      16,
      dynamicsBlockHeight(payload.volumeDynamicsCards.length),
    )
    writer.dynamicsCards(
      payload.volumeDynamicsCards,
      payload.volumeDynamicsPeriodLabel ?? 'За неделю',
    )
  }

  if (!singlePage) {
    writer.newPage()
  }
  writer.sectionTitle(payload.zonesTitle, 14)
  writer.zonesBrigadeMatrix(payload.zonesBrigadeSections)

  return new Uint8Array(await doc.save())
}
