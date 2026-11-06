# ADR 0002: Cactus Needle 3 adapter, explicit provisioning

## Status

Accepted

## Context

Needle 3 was chosen as the preferred initial local intent model. The repo has
an OpenAI-compatible adapter behind `POST /api/intelligence/local`, but Needle
itself is a tool-calling WASM engine, not an OpenAI chat endpoint.

The `cactus-needle` JS package is an independent wrapper around the official
Cactus model and runtime. The weights are pinned, Apache-2.0, and about 35MB.
Neither weights nor keys are committed to this repository.

## Decision

- Add a Needle-backed `InferenceRuntime` behind the existing local endpoint.
  `LOCAL_LLM_PROVIDER=needle` selects it; `openai` selects the OpenAI-compatible
  adapter; unset disables local inference and returns `501 not_configured`.
- Local inference is opt-in and explicit. Weights are approved-downloaded by
  `pnpm models:download`:
  - Pinned revision and SHA-256 are enforced by `downloadModel()`.
  - A failed or cancelled download does not leave a partial file.
  - The default cache is outside the repository; re-running when the cache is
    complete is a no-op network-wise.
- Only local-safe actions are exposed as tools. `spawn_subagent` and
  `cancel_task` remain cloud-plus-approval only.
- Weights are never written to the repo; `models/` and `*.cact` are ignored.
- The cloud adapter is unchanged and simply selected by `CLOUD_LLM_*`
  environment variables.

## Consequence

Local inference adds a build-time install in `apps/server` and an opt-in 35MB
download on first use, but no browser bundle, API key, or middleware rule is
changed.
