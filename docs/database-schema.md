# Koodu SQLite database reference

## Database file and status

- Default file: `assets/database/koodu.sqlite` (repo root).
- Override: `KOODU_DATABASE_PATH`; relative overrides resolve from the repository root.
- Driver: `better-sqlite3`; WAL mode, foreign keys, and a 5-second busy timeout are enabled.
- Startup runs `CREATE TABLE/INDEX IF NOT EXISTS` in `apps/server/src/storage/database.ts`.
- Schema creation and feature wiring are listed separately below; some tables remain planned or unused.
- SQLite `INTEGER` is used for booleans (`0` false, `1` true), timestamps, and counts. `TEXT` timestamps use ISO-8601 unless a table explicitly stores Unix milliseconds.

## Table-by-table columns

### `app_settings` — Settings page preferences

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `key` | `TEXT` | Primary key, required | Stable setting key, e.g. `ui.preferences.v1` or `companion.selected`. |
| `value_json` | `TEXT` | Required | JSON value. Preferences example: `{"animateCompanion":true,"showCommandHint":true,"startupPage":"/"}`. Selected pet example: `"kumo"`. |
| `updated_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | SQLite UTC timestamp updated on writes by the persistence layer. |

Use separate keys for independent settings groups; validate JSON against application schemas before writing. Do not store API keys here.

### `companion_profiles` — available pet/avatar definitions

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key, required | Stable character id such as `kumo` or `kitsu`. |
| `display_name` | `TEXT` | Required | Human-facing name such as `Kumo`. |
| `asset_directory` | `TEXT` | Required | Relative asset folder, e.g. `companion/kumo`; must be resolved under the approved asset root. |
| `manifest_json` | `TEXT` | Required | Animation metadata JSON: animation name, file, frame count, frame dimensions, FPS, and loop setting. PNG bytes stay in files. |
| `enabled` | `INTEGER` | Required, default `1` | Whether the character can be selected (`1`) or is hidden (`0`). |
| `updated_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Last catalog/manifest update. |

The selected character belongs in `app_settings`; this table is the catalog, not the user's selection.

### `workspace_state` — restorable tabs and layout

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key, required | Workspace identity, initially `default`; later can be a user/workspace id. |
| `state_json` | `TEXT` | Required | Versioned JSON containing tab IDs, internal routes, title, active/minimized/pinned flags, active tab, split layout, and layout mode. |
| `updated_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Last persisted workspace update. |

Do not persist iframe DOM/runtime state. Validate routes and schema version before restoring tabs.

### `memories` — visible notes and semantic memory

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `INTEGER` | Primary key | Internal row id returned by SQLite. |
| `content` | `TEXT` | Required | One memory statement, limited by embedding sanitizer to 350 characters / conservative token cap when embedded. Example: `The user prefers a dark interface.` |
| `category` | `TEXT` | Required | Current UI values: `preference`, `fact`, `task`; `MainAgent` also uses these categories. |
| `embedding` | `BLOB` | Nullable in startup schema | Raw `Float32Array` bytes for semantic search. A future UI-only note can have `NULL` until embedding succeeds. |
| `created_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Creation time. |
| `last_accessed` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Search/access time used for maintenance and recency. |

**Schema conflict to resolve before integration:** `VectorMemoryStore` independently creates `memories.embedding BLOB NOT NULL`, while startup SQL permits `NULL`. `CREATE IF NOT EXISTS` cannot reconcile existing tables. Add a migration and use one shared schema initializer before the UI and vector store share this database.

### `usage_events` — Usage page request-level facts

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key, required | UUID for one inference/request attempt. |
| `occurred_at` | `INTEGER` | Required | Unix milliseconds, e.g. `1794000000000`; supports 24h/7d/30d filters. |
| `model_id` | `TEXT` | Nullable, no FK intentionally | Selected managed profile id; no FK so history remains after profile deletion. |
| `provider` | `TEXT` | Nullable | Provider label such as `openai`, `openrouter`, `google`, `custom`, or a local runtime name. |
| `route` | `TEXT` | Required, check `local` / `cloud` | Which inference route handled the request. |
| `input_tokens` | `INTEGER` | Required, default `0` | Provider-reported prompt/input token count. |
| `output_tokens` | `INTEGER` | Required, default `0` | Provider-reported generated token count. |
| `latency_ms` | `INTEGER` | Required | End-to-end duration for the request, nonnegative in writer validation. |
| `outcome` | `TEXT` | Required, check `success` / `error` / `cancelled` | Final request result. Retries should be separate events linked by a future `request_group_id` if grouped UI is needed. |
| `error_code` | `TEXT` | Nullable | Stable error class such as `timeout`, `not_configured`, or `provider_error`; do not store credentials or full sensitive upstream bodies. |

Indexes: time and `(model_id, occurred_at)`. Aggregate this table to compute calls, token totals, average/median latency, success rate, and recent activity. Current Usage UI values are illustrative and are not written here yet.

### `model_profiles` — Models page provider configurations

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key, required | Stable profile id, e.g. `model-a1b2c3`. |
| `name` | `TEXT` | Required | Display name, e.g. `OpenRouter · Fast model`. |
| `provider` | `TEXT` | Required | Current UI enum: `openai`, `openrouter`, `google`, `custom`. |
| `model` | `TEXT` | Required | Provider model id, e.g. provider-specific model string. |
| `base_url` | `TEXT` | Required | OpenAI-compatible API base URL. Validate scheme/host before saving. |
| `role` | `TEXT` | Required | `local` or `cloud`; only one enabled active profile per role should be enforced transactionally. |
| `max_output_tokens` | `INTEGER` | Required | Output cap; current UI/server validation allows 64–32768. |
| `monthly_token_limit` | `INTEGER` | Required | Monthly cap; `0` means unlimited; current accepted maximum is 1,000,000,000. |
| `enabled` | `INTEGER` | Required | Boolean: `1` enabled, `0` disabled. |
| `active` | `INTEGER` | Required | Boolean selecting this profile for its role; enforce at most one active enabled profile per role. |
| `api_key` | `TEXT` | Nullable | **Sensitive credential. Current runtime holds keys in process memory only. Do not write this column until authenticated encryption and key rotation exist.** Never return it to the client. |
| `created_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Profile creation time. |
| `updated_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Profile update time. |

### `model_usage` — per-profile monthly token counter

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `model_id` | `TEXT` | Composite PK; FK to `model_profiles.id`, cascade delete | Profile whose usage is counted. |
| `month` | `TEXT` | Composite PK | UTC month bucket formatted `YYYY-MM`, e.g. `2026-11`. |
| `tokens` | `INTEGER` | Required, default `0` | Provider-reported total tokens accrued in that month. |

### `agent_tasks` — queued/running/completed work

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key | UUID task id. |
| `agent_type` | `TEXT` | Required | Current roles: `research`, `coding`, `organizer`, `memory`. |
| `task` | `TEXT` | Required | User-approved task description. |
| `status` | `TEXT` | Required, default `queued` | Lifecycle value from the shared agent status schema. |
| `progress` | `INTEGER` | Required, default `0` | Integer percentage 0–100. |
| `created_at` | `TEXT` | Required | ISO timestamp when queued. |
| `updated_at` | `TEXT` | Required | ISO timestamp of most recent status/progress update. |

Index: `status`. Task execution/checkpoint payloads should go in events or a future checkpoint table, not in arbitrary columns.

### `agent_task_events` — task progress and results

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `INTEGER` | Primary key | Monotonic event row id. |
| `task_id` | `TEXT` | Required FK to `agent_tasks.id`, cascade delete | Parent task. |
| `occurred_at` | `TEXT` | Required, default `CURRENT_TIMESTAMP` | Event creation time. |
| `event_type` | `TEXT` | Required | Stable event name such as `progress`, `result`, `failed`, or `cancelled`. |
| `payload_json` | `TEXT` | Required | Validated event-specific JSON; avoid storing secrets. |

### `agent_drafts` — Agents page requests not yet executed

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key | UUID generated by the browser today. |
| `agent_type` | `TEXT` | Required | One of the registered agent roles. |
| `task` | `TEXT` | Required | Draft task text. |
| `created_at` | `INTEGER` | Required | Unix milliseconds, matching the existing UI draft shape. |

Promote a draft into `agent_tasks` only when actual execution is requested; preserve or delete the draft by explicit policy.

### `chat_conversations` — saved conversation list

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key | UUID used to address a conversation over WebSocket. |
| `title` | `TEXT` | Required | User-facing title; initially `New chat`, then derived from the first user message (maximum 56 characters). |
| `created_at` | `TEXT` | Required | ISO timestamp when the conversation was created. |
| `updated_at` | `TEXT` | Required | ISO timestamp of the latest message. |

### `chat_messages` — durable user and assistant messages

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key | UUID for an individual message. |
| `conversation_id` | `TEXT` | Required FK to `chat_conversations.id`, cascade delete | Parent conversation. |
| `role` | `TEXT` | Required, check constrained | `user` or `assistant`. |
| `content` | `TEXT` | Required | Message text. Provider credentials and internal tool results are not stored as chat messages. |
| `created_at` | `TEXT` | Required | ISO timestamp when persisted. |

Index: `(conversation_id, created_at)`. Conversation CRUD, history, and send use central WebSocket RPC; assistant replies are streamed as request-correlated events.

### `skills` — Skills page instructions

| Column | SQLite type | Key / nullability | Meaning and example |
|---|---|---|---|
| `id` | `TEXT` | Primary key | Stable skill id. |
| `name` | `TEXT` | Required | Short display name; UI caps at 80 characters. |
| `description` | `TEXT` | Required | Summary; UI caps at 180 characters. |
| `category` | `TEXT` | Required | Current skill category enum from the UI. |
| `instructions` | `TEXT` | Required | Full agent playbook content; length cap should be set by validation before persistence. |
| `enabled` | `INTEGER` | Required | Boolean: `1` included for agent use, `0` disabled. |
| `source` | `TEXT` | Required | Origin label, e.g. `builtin`, `user`, or `import`. |
| `updated_at` | `INTEGER` | Required | Unix milliseconds, matching current local skill records. |

### Server log file — `assets/database/koodu.log.jsonl`

Logs are not stored in SQLite or browser storage. The server appends meaningful operation events to this file, keeps a 5,000-record in-memory cache, watches the file for changes, and streams new records over the WebSocket only to clients subscribed with `logs.watch`. `logs.unwatch` stops the stream when the Logs page unmounts. Generic RPC/list requests, route changes, RPC IDs, payloads, and user content are not recorded. Records use human-readable sentences for durable actions such as creating, updating, or deleting a memory, skill, or model profile.

## Page-to-table map

| Page / feature | Tables | Current state |
|---|---|---|
| Home / companion | `app_settings`, `companion_profiles` | Selection is localStorage; sprite files/manifest remain assets. |
| Usage | `usage_events`, `model_profiles` | Metrics are illustrative preview values. |
| Models | `model_profiles`, `model_usage` | Profiles/keys/usage counters currently live in server process memory; DB tables are not wired in. |
| Agents | `agent_tasks`, `agent_task_events` | Agent task execution and lifecycle events are server-side; visible result is transient page state. |
| Chats | `chat_conversations`, `chat_messages`, `agent_tasks`, `agent_task_events` | Conversations/messages and execution events persist in server SQLite; token deltas stream over WebSocket. |
| Memory | `memories` | UI records are localStorage; `MainAgent` uses its SQLite memory store. |
| Skills | `skills` | Skills are localStorage. |
| Logs | `assets/database/koodu.log.jsonl` | Server JSONL file with bounded in-memory cache and opt-in WebSocket stream; no SQL or browser persistence. |
| Settings | `app_settings` | Preferences and character selection are localStorage. |
| Workspace tabs/layout | `workspace_state` | Current app uses direct routes and has no persisted iframe tab model yet. |

## Migration and safety requirements

1. Add numbered migrations before changing existing schemas; `IF NOT EXISTS` only creates missing objects and does not alter old columns.
2. Reconcile the `memories.embedding` nullability mismatch between startup schema and `VectorMemoryStore` before using the shared DB file.
3. Add DB `CHECK` constraints for all enums, ranges, and booleans in a migration. Validate JSON and route values in TypeScript before writes and reads.
4. Persist model credentials only after encryption-at-rest, key rotation, and redacted reads are implemented. The current `api_key` column is a schema placeholder, not authorization to persist plaintext keys.
5. Keep provider/model base URLs and logged user text subject to validation and retention policy. Do not store auth tokens or secrets in settings/logs.
6. Bound growth for `usage_events` and `agent_task_events` with configurable retention/archival. Server logs are independently capped at 5,000 JSONL records.
