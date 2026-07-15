# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Локальная разработка и деплой

Перенесено из `.cursor/rules/` (использовались с Cursor, теперь действуют и здесь).

- Разрабатываем локально: `npm run dev` (фронт), правки в `supabase/functions/` — тестируем локально/ручным вызовом.
- **Не коммитить и не пушить в `main`**, пока пользователь явно не попросит («закоммить», «запушь», «отправь на деплой»). Не деплоить GitHub Pages и не запускать `supabase functions deploy` без явной команды. Не предлагать push «на всякий случай» в конце задачи. (Согласуется с conservative-профилем выше.)
- Когда пользователь явно просит commit/push/deploy:
  1. Закоммитить, `git push origin main`.
  2. Сразу после push проверить workflow **Deploy Pages**: `gh run list --workflow=deploy-pages.yml --limit 1`, затем `gh run watch <run-id> --exit-status` (если run ещё не появился — подождать 10–20 с и повторить `gh run list`).
  3. В ответе явно указать: хеш коммита, статус деплоя (успех / в процессе / ошибка с причиной), ссылку на run.
  4. Если менялись файлы в `supabase/functions/` — напомнить про `supabase functions deploy <name> --no-verify-jwt` (отдельно от GitHub Pages).
  - Не спрашивать «закоммитить?»/«запушить?» лишний раз в рамках уже данной командой на деплой — но новую команду на deploy в новом чате/задаче нужно получить явно заново.

## Supabase и БД из терминала — постоянное разрешение

Пользователь заранее разрешил без переспроса в каждом случае:

- читать и дополнять `.env.local` (не коммитить в git);
- подключаться к Postgres через `SUPABASE_DB_URL`/pooler (`npm run db:migrate`, `npm run setup:report-cron`);
- выполнять `supabase secrets set`, `supabase functions deploy`, `supabase link`;
- настраивать Vault (`vault.create_secret` / `vault.update_secret`) и `pg_cron` для рассылки.

Секреты не дублировать в правилах, коммитах и ответах пользователю — только в `.env.local` и Supabase.

При проблемах с рассылкой: сначала `npm run setup:report-cron`, затем проверить `net._http_response` и `analytics.email_log`.

Это разрешение **не распространяется** на git push/деплой — см. раздел выше, там нужна явная команда каждый раз.

## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
