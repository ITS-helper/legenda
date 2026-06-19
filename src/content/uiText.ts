export type UiText = {
  brand: string
  heroTitle: string
  heroDescription: string
  compareTitle: string
  compareEmpty: string
  compareDateFallback: string
  filters: {
    date: string
    supervisor: string
    compareMetric: string
    allBrigades: string
  }
  compareMetrics: {
    productivity: string
    work: string
    idle: string
    sleep: string
  }
  loading: string
  noData: string
  loadErrorPrefix: string
  metrics: {
    workersTitle: string
    workersAllNote: string
    workTitle: string
    workNote: string
    idleTitle: string
    idleNote: string
    sleepTitle: string
    sleepNote: string
  }
  sections: {
    brigadesKicker: string
    brigadesTitle: string
    topKicker: string
    topTitle: string
    shiftsKicker: string
    shiftsTitle: string
  }
  table: {
    worker: string
    supervisor: string
    work: string
    idle: string
    total: string
    productivity: string
    sleep: string
    noSupervisor: string
  }
  compareMeta: {
    workersSuffix: string
  }
  editor: {
    open: string
    close: string
    title: string
    description: string
    reset: string
    saveJson: string
    import: string
    applyToFile: string
    applySuccess: string
    applyErrorPrefix: string
    saved: string
  }
}

export const defaultUiText: UiText = {
  brand: 'Legenda Analytics',
  heroTitle: 'Сравнение двух бригад по работе, idle, сну и продуктивности.',
  heroDescription:
    'Верхний блок ориентирован на сравнение бригад. Ниже можно провалиться в людей и отсортировать смены под нужный разрез.',
  compareTitle: 'Сравнение бригад',
  compareEmpty: 'Пока нет данных по бригадам.',
  compareDateFallback: 'Дата не выбрана',
  filters: {
    date: 'Дата',
    supervisor: 'Начальник',
    compareMetric: 'Метрика сравнения',
    allBrigades: 'Все бригады',
  },
  compareMetrics: {
    productivity: 'Продуктивность',
    work: 'Рабочее время',
    idle: 'Idle',
    sleep: 'Сон',
  },
  loading: 'Загружаем аналитику из Supabase...',
  noData: 'Нет загруженных отчетных дней.',
  loadErrorPrefix: 'Ошибка загрузки:',
  metrics: {
    workersTitle: 'Сотрудники в выборке',
    workersAllNote: 'Все бригады в выборке',
    workTitle: 'Рабочее время',
    workNote: 'от трекаемого времени',
    idleTitle: 'Idle время',
    idleNote: 'от трекаемого времени',
    sleepTitle: 'Сон по устройствам',
    sleepNote: 'от трекаемого времени',
  },
  sections: {
    brigadesKicker: 'Бригады',
    brigadesTitle: 'Сравнение по начальникам',
    topKicker: 'Топ 5',
    topTitle: 'Самые продуктивные смены',
    shiftsKicker: 'Смены',
    shiftsTitle: 'Сортируемая таблица за день',
  },
  table: {
    worker: 'Сотрудник',
    supervisor: 'Начальник',
    work: 'Работа',
    idle: 'Idle',
    total: 'Всего',
    productivity: 'Продуктивность',
    sleep: 'Сон',
    noSupervisor: 'Без начальника',
  },
  compareMeta: {
    workersSuffix: 'сотрудников',
  },
  editor: {
    open: 'Редактировать текст',
    close: 'Закрыть редактор',
    title: 'Редактор текстов',
    description:
      'Меняй тексты прямо на странице, сохраняй черновик локально, выгружай JSON и при необходимости записывай правки прямо в uiText.ts.',
    reset: 'Сбросить',
    saveJson: 'Сохранить JSON',
    import: 'Загрузить и применить JSON',
    applyToFile: 'Применить в uiText.ts',
    applySuccess: 'Правки записаны в uiText.ts',
    applyErrorPrefix: 'Не удалось записать в uiText.ts:',
    saved: 'Черновик сохранен локально',
  },
}
