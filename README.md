# SentryOS — Desktop Environment Emulator

A browser-based desktop environment built with Next.js 16, React 19, and the Sentry SDK. Drag windows, launch apps, chat with an AI agent, and play SentrySnake — all fully instrumented with Sentry observability.

Built for the **SentryOS Hackathon** by the Solutions Engineering team.

## Desktop Apps

| App | Description |
|-----|-------------|
| **Install Guide** | Markdown viewer with onboarding docs |
| **Agents Folder** | File manager for AI agent apps |
| **Chat** | AI assistant powered by the Claude Agent SDK with real-time tool streaming |
| **SentrySnake** | Classic snake game — fully instrumented (see below) |

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and double-click any desktop icon to get started.

---

## 🐍 SentrySnake

A classic snake game that lives on the SentryOS desktop — and doubles as a showcase for Sentry's observability features.

### How to Play

- Double-click the **SentrySnake** icon on the desktop
- **Arrow keys** or **WASD** to steer the snake
- **Space** or **P** to pause/resume
- Eat the pink food dots to grow and score points
- Every 50 points the snake speeds up
- Hit a wall or yourself and it's game over

### Design

The game matches the SentryOS aesthetic end-to-end:

- **Snake body**: Sentry blurple (`#7553ff`) with a gradient fade from head to tail and a glow on the head
- **Food**: Sentry pink (`#ff45a8`) with a subtle glow
- **Grid**: Deep purple (`#0f0c14`) on a dark background
- **UI chrome**: Same header/footer bars, borders, and typography as all other SentryOS windows
- **High score**: Persisted in `localStorage` across sessions

### 🔭 Observability — What Gets Tracked

This is where it gets interesting. Every SentrySnake session generates real telemetry in Sentry — structured logs, custom metrics, and distributed tracing spans. Here's the full breakdown:

#### Spans (Distributed Tracing)

Each game session is wrapped in a Sentry span:

```
snake.game_session (op: "game")
├── snake.grid_size: 20
├── snake.initial_speed: 150
├── snake.final_score: 120
├── snake.death_reason: "wall" | "self"
├── snake.duration_ms: 34520
└── snake.final_speed: 85
```

This means every game shows up as a traced operation in Sentry's **Tracing** view — you can see how long the session lasted, what killed the snake, and how fast it was going at the end.

#### Structured Logs (`Sentry.logger`)

| Event | Level | Attributes |
|-------|-------|------------|
| Snake game started | `info` | — |
| Snake game paused | `info` | `score` |
| Snake game resumed | `info` | `score` |
| Snake speed increased | `info` | `score`, `newSpeed` |
| Snake new high score | `info` | `score` |
| Snake game over | `warn` | `reason`, `score`, `durationMs`, `speed` |

These show up in Sentry's **Logs** explorer, fully searchable and filterable. You can query things like "show me all game overs where score > 100" or "find all speed increases."

#### Custom Metrics (`Sentry.metrics`)

| Metric | Type | What It Tracks |
|--------|------|---------------|
| `snake.game_started` | counter | Total games played |
| `snake.game_over` | counter | Deaths (with `reason` attribute: `wall` or `self`) |
| `snake.food_eaten` | counter | Total food pellets consumed |
| `snake.final_score` | distribution | Score distribution across all games |
| `snake.game_duration_ms` | distribution | How long games last |
| `snake.high_score` | gauge | Current all-time high score |

With these metrics you can build dashboards like:
- **Average score** and **p95 score** across all players
- **Wall vs. self-collision** death ratio
- **Game duration** percentiles
- **Food eaten per game** trends

---

## 🔭 Full Application Observability

SentrySnake is just one piece — the entire SentryOS app is instrumented with Sentry structured logging and custom metrics.

### Chat Agent (Server + Client)

**Server-side** (`/api/chat`):
- Request lifecycle logging (received, completed, failed)
- Prompt length and conversation depth distributions
- Tool invocation counters per tool type (WebSearch, Bash, Read, etc.)
- Request duration and text chunk distributions
- Error tracking with failure reason attribution

**Client-side** (`Chat.tsx`):
- Message send events with prompt length
- Stream duration and response length distributions
- Tool observation counters
- API error and network failure tracking

### Window Manager

Every window action is tracked:
- `window.opened` / `window.closed` / `window.minimized` / `window.maximized` (counters by window ID)
- `window.open_count` (gauge — how many windows are open right now)

### Desktop Shell

- `desktop.session_started` — fires when SentryOS loads
- `desktop.app_launched` — fires per app with the app name as an attribute

### Global Error Boundary

- Structured error logging before `Sentry.captureException` — captures error name, message, and digest

---

## Sentry Configuration

| Layer | Config File | What's Enabled |
|-------|------------|----------------|
| Server | `sentry.server.config.ts` | 100% traces, structured logs, PII |
| Edge | `sentry.edge.config.ts` | 100% traces, structured logs, PII |
| Client | `src/instrumentation-client.ts` | 100% traces, structured logs, session replay (10%), error replay (100%) |
| Build | `next.config.ts` | Source maps, `/monitoring` tunnel, Vercel cron monitors |

## Tech Stack

- **Next.js 16** with App Router
- **React 19** with hooks and context
- **TailwindCSS 4** for styling
- **@sentry/nextjs 10** for observability
- **@anthropic-ai/claude-agent-sdk** for AI chat
- **react-rnd** for draggable/resizable windows
- **lucide-react** for icons
- **JetBrains Mono** font throughout

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| Blurple | `#7553ff` | Primary actions, snake body, active states |
| Pink | `#ff45a8` | Accents, food, user messages |
| Window BG | `#1e1a2a` | App backgrounds |
| Header BG | `#2a2438` | Title bars, input areas |
| Border | `#362552` | All borders and dividers |
| Deep Purple | `#0f0c14` | Desktop wallpaper, game grid |
| Text | `#e8e4f0` | Primary text |
| Muted | `#9086a3` | Secondary text, labels |

---

*Built with Next.js and Sentry for the SentryOS Hackathon.*
