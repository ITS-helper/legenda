import type { ComponentType, ReactNode } from 'react'

type FlowStep = { title: string; subtitle: string; accent?: boolean }

function DeepDiveShell({ children }: { children: ReactNode }) {
  return <div className="metric-deep-dive">{children}</div>
}

function DeepDiveSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="metric-deep-dive-section">
      <h5>{title}</h5>
      {children}
    </section>
  )
}

function DeepDiveFlow({ steps, label }: { steps: FlowStep[]; label: string }) {
  return (
    <div className="metric-flow" aria-label={label}>
      {steps.map((step, index) => (
        <div key={step.title} className="metric-flow-group">
          {index > 0 ? (
            <div className="metric-flow-arrow" aria-hidden="true">
              →
            </div>
          ) : null}
          <div className={`metric-flow-step${step.accent ? ' metric-flow-step-accent' : ''}`}>
            <strong>{step.title}</strong>
            <span>{step.subtitle}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function DeepDiveFormula({ children }: { children: string }) {
  return <pre className="metric-deep-dive-formula">{children}</pre>
}

function DeepDiveNote({ children, center }: { children: ReactNode; center?: boolean }) {
  return <p className={`metric-deep-dive-note${center ? ' metric-deep-dive-note-center' : ''}`}>{children}</p>
}

function DeepDiveText({ children }: { children: ReactNode }) {
  return <p className="metric-deep-dive-text">{children}</p>
}

export function ActivityMetricDeepDive() {
  return (
    <DeepDiveShell>
      <DeepDiveSection title="Цепочка данных">
        <DeepDiveText>
          Три строки в карточке — это три уровня одной метрики: от минут в Excel до процента на карточке бригады.
        </DeepDiveText>
        <DeepDiveFlow
          label="Схема цепочки активности"
          steps={[
            { title: 'Отчёт 11 · AA_BLE', subtitle: 'work_sec по минутам' },
            { title: 'ble_minute_facts', subtitle: '1 строка = 1 минута' },
            { title: 'shift_daily_metrics', subtitle: 'сумма за смену' },
            { title: 'brigade_daily_metrics', subtitle: 'activity_pct' },
            { title: 'Дашборд / рассылка', subtitle: 'карточки бригад', accent: true },
          ]}
        />
      </DeepDiveSection>

      <DeepDiveSection title="1. Минута телеметрии — AA_BLE → ble_minute_facts.work_sec">
        <DeepDiveText>
          <strong>Отчёт 11</strong> — файл <code>AA_BLE</code>: телеметрия с умных часов по минутам. Каждая строка — одна
          минута (или короткий хвост на стыке смены).
        </DeepDiveText>
        <div className="metric-deep-dive-table-wrap">
          <table className="metric-deep-dive-table">
            <thead>
              <tr>
                <th>Поле</th>
                <th>Смысл</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>work_sec</code>
                </td>
                <td>активная работа</td>
              </tr>
              <tr>
                <td>
                  <code>go_sec</code>
                </td>
                <td>ходьба</td>
              </tr>
              <tr>
                <td>
                  <code>idle_sec</code>
                </td>
                <td>простой</td>
              </tr>
              <tr>
                <td>
                  <code>total_sec</code>
                </td>
                <td>длина интервала (~60 сек)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <DeepDiveFormula>work_sec + go_sec + idle_sec ≈ total_sec</DeepDiveFormula>
      </DeepDiveSection>

      <DeepDiveSection title="2. Смена → 3. Бригада">
        <DeepDiveFormula>{`work_sec_total  = Σ work_sec  (shift_daily_metrics)
activity_pct    = 100 × Σ work_sec_total / Σ total_sec_total  (brigade_daily_metrics)`}</DeepDiveFormula>
        <DeepDiveNote>
          Проценты по бригаде — сумма секунд всех смен, не среднее арифметическое процентов отдельных смен.
        </DeepDiveNote>
      </DeepDiveSection>

      <DeepDiveSection title="Структура минуты (схема)">
        <div className="metric-minute-bar" aria-label="Структура одной минуты">
          <div className="metric-minute-segment metric-minute-work" style={{ width: '55%' }}>
            <span>work_sec</span>
          </div>
          <div className="metric-minute-segment metric-minute-go" style={{ width: '20%' }}>
            <span>go_sec</span>
          </div>
          <div className="metric-minute-segment metric-minute-idle" style={{ width: '25%' }}>
            <span>idle_sec</span>
          </div>
        </div>
      </DeepDiveSection>
    </DeepDiveShell>
  )
}

export function WeakActivityMetricDeepDive() {
  return (
    <DeepDiveShell>
      <DeepDiveSection title="Цепочка данных">
        <DeepDiveText>
          «Слабая активность» в Legenda — <strong>расчётная метрика</strong>, не отдельное поле в Excel. Берётся общий
          простой и из него вычитается длительный простой.
        </DeepDiveText>
        <DeepDiveFlow
          label="Схема слабой активности"
          steps={[
            { title: 'AA_BLE', subtitle: 'idle_sec по минутам' },
            { title: 'idle_sec_total', subtitle: 'сумма за смену' },
            { title: 'Отчёт 10', subtitle: 'длительные эпизоды' },
            { title: 'weak_activity', subtitle: 'idle − long_idle', accent: true },
          ]}
        />
      </DeepDiveSection>

      <DeepDiveSection title="Откуда берётся idle_sec">
        <DeepDiveText>
          В системе мониторинга поле <code>idle_sec</code> — секунды бездействия / слабой активности по датчику (рука
          почти не двигается). Импортируется из AA_BLE в <code>ble_minute_facts</code>, затем суммируется в{' '}
          <code>idle_sec_total</code> на смену.
        </DeepDiveText>
        <DeepDiveFormula>{`idle_sec_total = Σ idle_sec  (shift_daily_metrics)

weak_activity_sec = max(idle_sec_total − long_idle_sec_total, 0)
weak_activity_pct = 100 × weak_activity_sec / total_sec`}</DeepDiveFormula>
      </DeepDiveSection>

      <DeepDiveSection title="Схема: простой делится на две части">
        <div className="metric-split-bar" aria-label="Деление простоя">
          <div className="metric-split-segment metric-split-weak" style={{ width: '35%' }}>
            <span>Слабая активность</span>
            <small>короткие паузы</small>
          </div>
          <div className="metric-split-segment metric-split-long" style={{ width: '65%' }}>
            <span>Длительный простой</span>
            <small>эпизоды ≥ порога</small>
          </div>
        </div>
        <DeepDiveNote center>
          <code>idle_sec_total</code> = слабая активность + длительный простой
        </DeepDiveNote>
        <DeepDiveNote>
          Короткие паузы (ожидание, стояние с инструментом, микродвижения) остаются в слабой активности. Длинные
          непрерывные эпизоды бездействия попадают в «длительный простой».
        </DeepDiveNote>
      </DeepDiveSection>
    </DeepDiveShell>
  )
}

export function LongIdleMetricDeepDive() {
  return (
    <DeepDiveShell>
      <DeepDiveSection title="Цепочка данных">
        <DeepDiveFlow
          label="Схема длительного простоя"
          steps={[
            { title: 'Отчёт 10', subtitle: 'long_idle_arh' },
            { title: 'idle_episodes', subtitle: 'эпизоды простоя' },
            { title: 'shift_daily_metrics', subtitle: 'long_idle_sec_total' },
            { title: 'brigade_daily_metrics', subtitle: 'long_idle_pct', accent: true },
          ]}
        />
      </DeepDiveSection>

      <DeepDiveSection title="Что такое эпизод">
        <DeepDiveText>
          <strong>Отчёт 10</strong> (<code>idle_episodes</code>, файл <code>long_idle_arh</code>) — список эпизодов
          бездействия внутри смены. У каждого эпизода есть <code>duration_min</code> — длительность в минутах.
        </DeepDiveText>
        <DeepDiveFormula>{`long_idle_sec = Σ(duration_min × 60)  WHERE duration_min ≥ порог

long_idle_pct = 100 × long_idle_sec / total_sec`}</DeepDiveFormula>
        <DeepDiveNote>
          Порог задаётся в настройках («Порог длительного простоя», по умолчанию 10 мин). Эпизоды <strong>короче</strong>{' '}
          порога не попадают сюда — они остаются в «слабой активности».
        </DeepDiveNote>
      </DeepDiveSection>

      <DeepDiveSection title="Пример эпизода">
        <div className="metric-deep-dive-table-wrap">
          <table className="metric-deep-dive-table">
            <thead>
              <tr>
                <th>Интервал</th>
                <th>idle_sec в минутах</th>
                <th>Куда попадает</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>14:08–14:10 (2 мин)</td>
                <td>22, 13, 4 сек</td>
                <td>Слабая активность</td>
              </tr>
              <tr className="metric-deep-dive-table-summary">
                <td>15:56–16:00 (5+ мин)</td>
                <td>~60 сек каждая минута</td>
                <td>
                  <strong>Длительный простой</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <DeepDiveNote>
          В длинном эпизоде сумма секунд может быть чуть меньше «идеальных» 5×60 — датчики иногда фиксируют
          микродвижения.
        </DeepDiveNote>
      </DeepDiveSection>

      <DeepDiveSection title="Где ещё используется">
        <DeepDiveNote>
          Блок 4 «Местоположение и простои» показывает те же эпизоды с привязкой к BLE-зоне (
          <code>idle_episodes_daily</code>).
        </DeepDiveNote>
      </DeepDiveSection>
    </DeepDiveShell>
  )
}

export function GoMetricDeepDive() {
  return (
    <DeepDiveShell>
      <DeepDiveSection title="Цепочка данных">
        <DeepDiveFlow
          label="Схема ходьбы между зонами"
          steps={[
            { title: 'AA_BLE', subtitle: 'go_sec по минутам' },
            { title: 'ble_minute_facts', subtitle: '1 строка = 1 мин' },
            { title: 'shift_daily_metrics', subtitle: 'go_sec_total' },
            { title: 'brigade_daily_metrics', subtitle: 'go_pct', accent: true },
          ]}
        />
      </DeepDiveSection>

      <DeepDiveSection title="Что такое go_sec">
        <DeepDiveText>
          Поле <code>go_sec</code> в AA_BLE — секунды <strong>ходьбы / перемещения</strong> между BLE-зонами. Система
          классифицирует минуту как движение, когда человек идёт, а не работает на месте и не стоит без движения.
        </DeepDiveText>
        <DeepDiveFormula>{`go_sec_total = Σ go_sec  (по минутам смены)
go_pct     = 100 × Σ go_sec_total / Σ total_sec_total  (по бригаде)`}</DeepDiveFormula>
      </DeepDiveSection>

      <DeepDiveSection title="Место в структуре минуты">
        <div className="metric-minute-bar" aria-label="GO в структуре минуты">
          <div className="metric-minute-segment metric-minute-work" style={{ width: '50%' }}>
            <span>work_sec</span>
          </div>
          <div className="metric-minute-segment metric-minute-go" style={{ width: '30%' }}>
            <span>go_sec</span>
          </div>
          <div className="metric-minute-segment metric-minute-idle" style={{ width: '20%' }}>
            <span>idle_sec</span>
          </div>
        </div>
        <DeepDiveNote center>
          Активность + ходьба + простой ≈ 100 % от <code>total_sec</code>
        </DeepDiveNote>
        <DeepDiveNote>
          Высокий <code>go_pct</code> часто означает много переходов между участками, а не «лень» — это отдельная ось
          от активности и простоя.
        </DeepDiveNote>
      </DeepDiveSection>
    </DeepDiveShell>
  )
}

export function PvMetricDeepDive() {
  return (
    <DeepDiveShell>
      <DeepDiveSection title="Цепочка данных">
        <DeepDiveFlow
          label="Схема ПВ"
          steps={[
            { title: 'AA_BLE', subtitle: 'zona + total_sec' },
            { title: 'ble_minute_facts', subtitle: 'zona = 1 → ПВ' },
            { title: 'shift_daily_metrics', subtitle: 'pv_sec_total' },
            { title: 'zone_daily_metrics', subtitle: 'детализация по зонам', accent: true },
          ]}
        />
      </DeepDiveSection>

      <DeepDiveSection title="Что такое ПВ">
        <DeepDiveText>
          <strong>ПВ (производственная зона)</strong> — BLE-зона с кодом <code>zona = 1</code>. Время в этой зоне
          суммируется как <code>pv_sec_total</code> на смену.
        </DeepDiveText>
        <DeepDiveFormula>{`pv_sec_total = Σ total_sec  WHERE zona = '1'

pv_pct = 100 × pv_sec / Σ(секунды по видимым зонам)`}</DeepDiveFormula>
        <DeepDiveNote>
          На карточке бригады процент ПВ считается от суммы секунд по <strong>видимым</strong> зонам (настраивается в
          блоке 4). Зона 0 скрыта; КПП (13) в блоке «Местоположение» показывается отдельно.
        </DeepDiveNote>
      </DeepDiveSection>

      <DeepDiveSection title="Схема: где был сотрудник">
        <div className="metric-zone-bar" aria-label="Пример распределения по зонам">
          <div className="metric-zone-segment metric-zone-pv" style={{ width: '45%' }}>
            <span>zona 1 · ПВ</span>
          </div>
          <div className="metric-zone-segment metric-zone-other" style={{ width: '30%' }}>
            <span>другие зоны</span>
          </div>
          <div className="metric-zone-segment metric-zone-kpp" style={{ width: '25%' }}>
            <span>КПП · 13</span>
          </div>
        </div>
        <DeepDiveNote center>Условный пример — доли зависят от смены и объекта</DeepDiveNote>
      </DeepDiveSection>
    </DeepDiveShell>
  )
}

export function ShiftDurationMetricDeepDive() {
  return (
    <DeepDiveShell>
      <DeepDiveSection title="Цепочка данных">
        <DeepDiveFlow
          label="Схема длительности смены"
          steps={[
            { title: 'faceID / LongIDLE', subtitle: '«Итого в часах»' },
            { title: 'shifts', subtitle: 'on_watch_duration_seconds' },
            { title: 'brigade_daily_metrics', subtitle: 'avg_shift_duration_sec', accent: true },
          ]}
        />
      </DeepDiveSection>

      <DeepDiveSection title="Откуда берётся время">
        <DeepDiveText>
          Это метрика <strong>не из AA_BLE</strong>, а из отчёта посещаемости: <code>faceID</code> (отчёт 6) или{' '}
          <code>LongIDLE</code>, если faceID ещё не загружен. Поле «Итого находился в часах» сохраняется как{' '}
          <code>on_watch_duration_seconds</code> в таблице <code>analytics.shifts</code>.
        </DeepDiveText>
        <DeepDiveFormula>{`avg_shift_duration_sec = round(
  AVG(on_watch_duration_seconds) FILTER (WHERE on_watch_duration_seconds > 0)
)`}</DeepDiveFormula>
        <DeepDiveNote>
          На карточке бригады показывается <strong>среднее</strong> время «в часах» по всем сменам бригады за день —
          от получения до сдачи умных часов.
        </DeepDiveNote>
      </DeepDiveSection>

      <DeepDiveSection title="Схема: смена в часах">
        <div className="metric-timeline" aria-label="Длительность смены">
          <div className="metric-timeline-point metric-timeline-start">
            <strong>Получил часы</strong>
            <span>watch_received_at</span>
          </div>
          <div className="metric-timeline-track">
            <span>on_watch_duration_seconds</span>
          </div>
          <div className="metric-timeline-point metric-timeline-end">
            <strong>Сдал часы</strong>
            <span>watch_returned_at</span>
          </div>
        </div>
        <DeepDiveNote>
          Если отчёт выгружен до сдачи часов, поле сдачи может быть пустым — тогда длительность считается по доступным
          данным на момент импорта.
        </DeepDiveNote>
      </DeepDiveSection>
    </DeepDiveShell>
  )
}

const METRIC_DEEP_DIVES: Record<string, ComponentType> = {
  activity: ActivityMetricDeepDive,
  weak_activity: WeakActivityMetricDeepDive,
  long_idle: LongIdleMetricDeepDive,
  go: GoMetricDeepDive,
  pv: PvMetricDeepDive,
  shift_duration: ShiftDurationMetricDeepDive,
}

export function getMetricDeepDive(metricId: string) {
  return METRIC_DEEP_DIVES[metricId] ?? null
}
