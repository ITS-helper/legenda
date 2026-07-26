// Позволяет импортировать модули edge function (Deno) из node-скриптов предпросмотра:
// `npm:pdf-lib@1.17.1` и `https://esm.sh/@supabase/supabase-js@2` превращаются в обычные пакеты,
// а nodemailer подменяется заглушкой (локально письма не отправляем).
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const NODEMAILER_STUB = pathToFileURL(join(here, 'nodemailer-stub.mjs')).href

/** `npm:pkg@1.2.3` / `https://esm.sh/pkg@2` → `pkg` (scoped-имена сохраняются). */
function bareName(specifier) {
  const withoutHost = specifier.replace(/^npm:/, '').replace(/^https:\/\/esm\.sh\//, '')
  const at = withoutHost.lastIndexOf('@')
  return at > 0 ? withoutHost.slice(0, at) : withoutHost
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('npm:') || specifier.startsWith('https://esm.sh/')) {
    const name = bareName(specifier)
    if (name === 'nodemailer') return { url: NODEMAILER_STUB, shortCircuit: true }
    return nextResolve(name, context)
  }
  return nextResolve(specifier, context)
}
