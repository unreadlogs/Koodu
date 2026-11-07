# Koodu

An open-source AI agent environment with a persistent companion, multi-agent orchestration, hybrid local-cloud intelligence, and an interactive multi-tab workspace.

The repository contains the vertical prototype:

- `apps/web` — React shell, workspace iframes and browser engines.
- `apps/server` — Fastify API; **all inference and secrets stay here**.
- `protocol` — `@koodu/protocol`, the shared TypeScript/Zod contracts used by the web app and server.
- `assets/companion/` — input spritesheets and manifests; the image renderer is still intentionally pending.

## Prerequisites

- Node.js **22.18+**
- pnpm 12.x (pinned in root `package.json`)
- Linux, macOS, or Windows with WASM/WebAssembly and module workers available in Node.js

## Quick start

```sh
pnpm install
cp .env.example .env
pnpm dev               # web on :5173, server API on :8787
```

Open <http://localhost:5173>. The Vite frontend proxies `/api` to
`http://127.0.0.1:8787`; do not expose the backend directly in normal development.

To run them separately:

```sh
pnpm dev:server       # http://127.0.0.1:8787
pnpm dev:web          # http://localhost:5173
```

## Verify the install

```sh
curl http://127.0.0.1:8787/api/health
```

Run the test/type/build suite:

```sh
pnpm typecheck
pnpm test
pnpm --filter @koodu/web build
```

## Local inference

Both local and cloud inference run server-side and route through the middleware before any action is executed.

`.env`:

```env
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODEL=local-model
# LOCAL_LLM_API_KEY=
```

No additional download is required. The local provider accepts any OpenAI-compatible endpoint (Ollama, llama.cpp server, vLLM).

Local inference is limited to local-safe actions. `spawn_subagent` and `cancel_task`
are never proposed by the local model; they require cloud routing and explicit
user approval. See `docs/adr/0001-server-side-local-inference.md`.

## Not configured / 501

If the local provider is disabled, `/api/intelligence/local` returns:

```json
{ "error": "not_configured", "provider": "local" }
```

The UI still works: browser rules handle canonical commands; intelligence is optional.

## Environment

Copy `.env.example` to `.env`. `.env` is git-ignored. Key settings:

- `PORT`, `HOST` — server bind (defaults `8787`, `127.0.0.1`)
- `ALLOWED_ORIGINS` — browser origins allowed to call the API
- `KOODU_AUTH_PASSWORD` — optional; if set, the app requires login at `/session/auth`
- `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_API_KEY` — optional local OpenAI-compatible provider
- `CLOUD_LLM_BASE_URL`, `CLOUD_LLM_MODEL`, `CLOUD_LLM_API_KEY` — optional cloud provider; keys never reach the browser
- `LLM_TIMEOUT_MS` — local/cloud request timeout (default 15000)

The full example is in `.env.example`.

## Repository map

```text
apps/
  web/            React shell + workspace + engines (.src/app composition root, engines/)
  server/         Fastify API and inference adapters
protocol/         @koodu/protocol: types + Zod schemas shared by web and server
assets/companion/ Character spritesheets and animation_manifest.json files
docs/adr/         Architecture decisions
```

## License

Apache-2.0.
