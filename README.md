# Iris

A personal to-do and goal tracker with a built-in chat agent. You manage goals, recurring tasks and daily check-offs
from a Next.js UI, or ask the agent to do it for you in plain language. Both share the same data store.

Everything is organized around three **pillars**: health, wealth and happiness.

## Features

- **Goals**, each under a pillar, optionally nested and with a target date.
- **Tasks**, either recurring (an [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) rule such as
  `FREQ=WEEKLY;BYDAY=MO,WE,FR`) or one-off with a due date. Each task is aligned to goals or a pillar.
- **Occurrences**: each scheduled instance of a task, marked done, skipped or reopened. With the `carry` miss policy,
  a missed occurrence stays overdue until you deal with it.
- **Agent chat**: a Claude agent (via the [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview))
  that can read your agenda, check things off, create and edit tasks and goals, and summarize progress by pillar.
  Conversations are resumable at `/s/<sessionId>`.
- **Google Calendar (optional)**: the agent reads your primary calendar so it plans around your meetings. Ad hoc
  to-dos that are really appointments ("dentist Tue 3pm") get a time slot and show up as events on your calendar;
  renaming or rescheduling the to-do updates the event. Iris never edits events it didn't create.

## Getting started

Requirements: Node 24 (see `.nvmrc`) and an [Anthropic API key](https://console.anthropic.com/).

```sh
npm install
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

### Configuration

| Variable            | Default            | Purpose                                                  |
| ------------------- | ------------------ | -------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | required for chat  | Used by the Agent SDK's CLI process to call Claude.      |
| `TODO_DATA_FILE`    | `data/todo.json`   | Path to the JSON data store. Created on first write.     |
| `TODO_TIME_ZONE`    | `America/New_York` | Time zone that decides what "today" is.                  |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | unset | Optional Google Calendar access (below). |

The API key is used only by the chat. It stays on the server and is never sent to the browser.

### Google Calendar (optional)

A plain Google API key can only read public calendars, so this uses OAuth with the `calendar.events` scope (read
events, and create and edit the appointment events Iris owns). Set it up once:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the
   **Google Calendar API**.
2. Configure the OAuth consent screen (External), add yourself as a user, then set its publishing status to
   **In production**. While it's in "Testing", Google expires refresh tokens after 7 days. An unverified app is fine
   for personal use; you'll click through a warning once.
3. Create an OAuth client ID of type **Desktop app**, and put its ID and secret in `.env.local` as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Run `npm run gcal:auth`, open the printed URL, approve, and copy the printed `GOOGLE_REFRESH_TOKEN=…` line into
   `.env.local`. Restart the dev server.

With any of the three variables unset, the calendar tool is left out and appointments are unavailable. If you set this
up when it was read-only, run `npm run gcal:auth` again: the old token only has the `calendar.readonly` scope.

## Scripts

| Command             | Description                                        |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Start the dev server.                              |
| `npm run build`     | Production build.                                  |
| `npm start`         | Serve the production build.                        |
| `npm run typecheck` | `tsc --noEmit`.                                    |
| `npm test`          | Run the vitest suite (`lib/**/*.test.ts`).         |
| `npm run gcal:auth` | One-time Google Calendar OAuth; prints a refresh token. |

## Architecture

```
app/
  page.tsx, s/[sessionId]/   UI: planner panel + agent chat
  _components/               app-specific components
  api/                       thin HTTP wrappers over the services
lib/
  domain/
    service.ts               all business logic (shared by API routes and agent tools)
    engine.ts                generates occurrences from task schedules
    store.ts                 JSON-file store with a serialized write queue and migrations
    recurrence.ts, dates.ts  rrule expansion and YYYY-MM-DD date helpers
  agent/
    run.ts                   runs one agent turn via the Claude Agent SDK
    tools.ts                 MCP tools exposed to the agent
    system-prompt.ts         agent instructions
  calendar/                  optional Google Calendar client: reading events, syncing appointment events
scripts/gcal-auth.ts         one-time OAuth consent for Google Calendar
components/ui, components/ai-elements   vendored shadcn / AI Elements components
```

How the pieces fit together:

- **One code path.** The API routes and the agent tools both call `lib/domain/service.ts`, so the UI and the agent
  behave the same way.
- **Occurrences are lazy.** They aren't stored ahead of time. `engine.ts` fills them in when you read the agenda. Ids
  are deterministic (`<taskId>@<YYYY-MM-DD>`), so they never duplicate. Changing a task's schedule removes only
  *pending* occurrences, so done and skipped history is kept.
- **The agent can only touch your to-dos.** It has no built-in tools (no Bash, file access, etc.) and ignores local
  Claude settings. Its only tools are the `mcp__todos__*` tools in `lib/agent/tools.ts` (including
  `getCalendarEvents` when Google Calendar is configured).

### HTTP API

| Route                          | Description                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `GET /api/todos`               | Goals and tasks.                                                               |
| `GET /api/agenda?from=&to=`    | Occurrences in a date range (defaults to today), plus overdue items.           |
| `POST /api/occurrences/:id`    | `{ "action": "complete" \| "skip" \| "reopen", "note"?: string }`              |
| `POST /api/chat`               | Streams one agent turn.                                                        |

## Data

Your data lives in `data/todo.json`, which is gitignored. Back it up yourself. Tests never touch it; they use
temporary files.

## Contributing

See [AGENTS.md](AGENTS.md) for the conventions this codebase follows: where logic goes, store rules, date handling
and error codes.

## License

[MIT](LICENSE)
