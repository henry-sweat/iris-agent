<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Iris agent

Personal to-do/goal tracker: a Next.js app plus a Claude Agent SDK chat agent. Both share one JSON-file store.

## Commands

- Node 24 (`.nvmrc`). Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`.
- `npm run typecheck`: `tsc --noEmit`. `npm test`: vitest, which only picks up `lib/**/*.test.ts`. Single test: `npx vitest run lib/domain/service.test.ts -t "<name>"`.
- No linter or formatter is configured. Match the surrounding style: double quotes, 2-space indent, ~120-col lines.

## Architecture rules

- `lib/domain/service.ts` is the single code path behind both the agent tools (`lib/agent/tools.ts`) and the API routes (`app/api/**`). Put logic in services; tools and routes stay thin wrappers.
- Occurrences are generated only by `lib/domain/engine.ts`, lazily on reads (`heal`). No agent tool may insert occurrences, and `tools.test.ts` enforces this. Occurrence ids are deterministic: `${taskId}@${YYYY-MM-DD}`.
- Schedule edits in `updateTask` delete only *pending* rows. Done/skipped history is never touched.
- Store (`lib/domain/store.ts`): every write goes through `store.mutate` (a serialized per-file queue). Mutate the draft and return `{ changed, result }`. Never mutate a `read()` snapshot. If you change the data shape, bump `version` and add a migration.
- `data/todo.json` (default `TODO_DATA_FILE`) holds the user's real data and is gitignored. Never point tests or experiments at it. Tests use `createStore` on an `mkdtemp` file and inject `now` into `createServices`.
- Dates are `YYYY-MM-DD` strings, treated as floating UTC midnights (see `lib/domain/dates.ts`). "Today" always comes from `dateIn(TIME_ZONE, now)`, never from server-local date math. `TODO_TIME_ZONE` defaults to `America/New_York`.
- Expected failures throw `DomainError(code, message)`. A new code must also be mapped to an HTTP status in `app/api/_errors.ts`.
- Adding a tool that changes data: add its name to `MUTATING_TOOLS` so the UI refreshes. If tool semantics change, update `lib/agent/system-prompt.ts`.
- The agent is deliberately hermetic (`tools: []`, `settingSources: []`, only `mcp__todos__*` allowed). Keep it that way. `@anthropic-ai/claude-agent-sdk` must stay in `serverExternalPackages` because it spawns a native CLI.
- Google Calendar (`lib/calendar/`) is optional: `calendarService` and `appointmentCalendar` are `null` unless the `GOOGLE_*` env vars are set, and `getCalendarEvents` is registered on the `todos` server only then. The only writes are appointment tasks (ad hoc task + `dueAt` + `appointment`), synced by `createTask`/`updateTask` in `service.ts`: the event follows title/date/time changes, `appointment: null` deletes it, archive/skip leave it. Iris only patches or deletes event ids it stored on a task; never add a tool that takes an arbitrary event id. Calendar failures after the task is saved come back as `calendarError`, not a throw. Tests inject a fake `CalendarClient` or `AppointmentCalendar`; never use real credentials.
- `components/ui` (shadcn) and `components/ai-elements` are vendored generated components. App-specific UI lives in `app/_components`.
