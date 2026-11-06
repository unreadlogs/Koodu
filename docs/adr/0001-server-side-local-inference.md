# ADR 0001: Local inference runs server-side

## Status

Accepted

## Context

The app uses Cactus Needle 3 for simple command intent detection. Inference
needs a local model in the process that serves the command, and both the
browser and future clients cannot be trusted to download, verify, or keep model
weights private.

## Decision

- Local inference runs **only on the server** at `POST /api/intelligence/local`.
- The browser holds no model weights, no Hugging Face credentials, and no
  provider API keys.
- The browser uses the rules provider for canonical command text. Local model
  proposals from the server are validated by the middleware before execution.
- Cloud inference remains a separate endpoint at `POST /api/intelligence/cloud`.
- `spawn_subagent` and `cancel_task` are not local-safe actions. They are
  never sent to the local model and require cloud routing plus explicit
  approval.

## Consequences

- A server process per deployment, with its own cache for Needle weights.
- Local inference can be disabled or swapped out without changing the web app.
- The middleware remains the authority: models propose, middleware validates
  and executes.
