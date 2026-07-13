# AGENTS.md — WaForge project instructions for AI coding agents

This file scopes how automated agents (Grok, Claude, Cursor, Copilot, etc.) should work in this repository.

## Product identity

- **Product name:** WaForge (not WaForge, not Quantura-as-product).
- **Company:** Quantura Technologies — https://www.quanturatech.com
- **Description:** AI-powered self-hosted WhatsApp API gateway (REST, webhooks, MCP, dashboard, BYO LLM).
- **License:** MIT
- **Node:** `>=22` (see `package.json` `engines` and `.nvmrc`)
- **Stack:** NestJS 11 API (`src/`), React + Vite dashboard (`dashboard/`), TypeORM, SQLite/Postgres, optional Redis/BullMQ, engines `whatsapp-web.js` and Baileys.

## Working directory

Always operate from the **WaForge** project root:

```text
D:\quantura_projects\WaForge
```

Do not assume a sibling WaForge path. Prefer absolute paths under this root when shelling.

## Non-negotiables

1. **Do not invent product claims.** Features must match code, `.env.example`, or `docs/`.
2. **Never commit secrets:** `.env`, `data/`, session folders, `.api-key`, real API keys, `node_modules`, local SQLite DBs.
3. **Branding:** user-facing strings and README say **WaForge**. Company footer may say Quantura Technologies. Avoid reintroducing WaForge as the product name in new UI/docs (legacy assets may still exist under `docs/logo/` / `WaForge_*` filenames).
4. **Do not expand scope** beyond the user request. Prefer editing existing files over creating docs.
5. **Security:** no exploit PoCs, no attacking systems. Local vulnerability fixes only when asked.

## Layout (high level)

| Path | Role |
|------|------|
| `src/` | NestJS modules: session, message, webhook, auth, mcp, ai, plugins, engine adapters |
| `src/engine/` | Engine factory + whatsapp-web.js / Baileys adapters |
| `src/core/agent-tools/` | Protocol-neutral tool registry used by MCP |
| `dashboard/` | Operator UI (port **2886** in dev) |
| `docs/` | Numbered specs and runbooks — start at `docs/README.md` |
| `test/` | e2e Jest tests |
| `scripts/` | backup, smoke, openapi export |
| `.env.example` | **Single source of truth** for configuration knobs |
| `docker-compose.yml` / `Dockerfile` | Production-oriented deploy |

## Dev commands

```bash
npm install                 # or: npm install --legacy-peer-deps if needed
npm run dev                 # API (2785) + dashboard (2886) via concurrently
npm run start:dev           # API only
npm run dashboard:dev       # dashboard only
npm run build / build:all
npm test / npm run test:e2e
npm run lint
```

### Ports

| Service | Port / path |
|---------|-------------|
| API | `http://localhost:2785` |
| Swagger | `http://localhost:2785/api/docs` |
| Health | `http://localhost:2785/api/health` |
| MCP | `POST /mcp` (same host; enable with `MCP_ENABLED=true`) |
| Dashboard (Vite) | `http://localhost:2886` |

### Local admin key

With `ALLOW_DEV_API_KEY=true`, the seed admin key is **`dev-admin-key`**. Never enable that flag in production. Otherwise a random key is written to `data/.api-key` / startup banner.

Dashboard login posts to `/api/auth/validate` with header `X-API-Key`.

## Configuration rules

- Prefer documenting env vars that already exist in `.env.example`.
- AI auto-reply: `AI_AUTO_REPLY_ENABLED`, `AI_PROVIDER` (`openai` \| `anthropic` \| `grok` \| `gemini`), `AI_API_KEY`, …
- MCP: `MCP_ENABLED`, `MCP_READONLY` (default recommend true for observers).
- Group cleanup: `GROUP_CLEANUP_*`.
- Engine: `ENGINE_TYPE=whatsapp-web.js` or `baileys`.
- Runtime state lives under `data/` (gitignored): SQLite, sessions, media, plugins, logs.

## Coding conventions

- **TypeScript** throughout; NestJS module/service/controller patterns in `src/`.
- Match existing style (Prettier + ESLint configs at repo root / dashboard).
- Dashboard: React function components, React Query hooks in `dashboard/src/hooks/`, API client in `dashboard/src/services/api.ts`, i18n under `dashboard/src/i18n/locales/`.
- When changing user-visible dashboard strings, update all locale JSON files (or run `dashboard` i18n parity check).
- Prefer reusing existing services for new MCP tools / REST endpoints — do not bypass auth or DTOs.
- Engine-specific code belongs in adapters under `src/engine/`, not scattered through modules.

## Docs

- Specs are numbered `docs/01-…` through `docs/28-…`. Cross-link rather than duplicating.
- README is the public product face; keep it accurate and short. Deep detail goes in `docs/`.
- Agent/session junk files (e.g. a one-line `grok` resume pointer) must not be committed; use this `AGENTS.md` instead.

## Git hygiene

- Ensure `.gitignore` covers `node_modules/`, `dist/`, `data/`, `.env`, `*.sqlite`, `*.log`, `.wwebjs_*`, IDE/OS junk.
- Allow `docs/screenshots/**` for README images.
- Meaningful commit messages; prefer branch `main`.
- Remote expected: `https://github.com/quanturatch/waforge.git`

## Testing notes

- Unit: Jest (`npm test`).
- e2e: `npm run test:e2e` (often sets `ALLOW_DEV_API_KEY=true` and uses `dev-admin-key`).
- Do not rely on live WhatsApp accounts in CI; mock engines where fixtures exist under `test/`.

## When stuck

1. Read `.env.example` and the relevant `docs/NN-*.md`.
2. Grep `src/modules/` and `src/engine/` before inventing new modules.
3. Ask the user only when product behavior is ambiguous — do not guess WhatsApp ToS-sensitive behavior.

## Out of scope for agents unless asked

- Force-pushing to shared remotes
- Committing `data/sessions` or production keys
- Renaming the product back to WaForge
- Broad refactors unrelated to the task
