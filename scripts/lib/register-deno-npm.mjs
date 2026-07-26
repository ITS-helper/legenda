// Подготовка node к импорту модулей edge function:
// 1) специферы `npm:`/`https://esm.sh/` разрешаются как обычные пакеты (см. deno-npm-loader.mjs);
// 2) глобальный Deno подменяется минимальной заглушкой — env из process.env, serve не поднимает сервер.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./deno-npm-loader.mjs', pathToFileURL(import.meta.filename))

globalThis.Deno ??= {
  env: {
    get: (key) => process.env[key],
    set: (key, value) => {
      process.env[key] = value
    },
  },
  /** Обработчик запросов edge function запоминаем, но HTTP-сервер не поднимаем. */
  serve: (handler) => {
    globalThis.__denoServeHandler = handler
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve() }
  },
}
