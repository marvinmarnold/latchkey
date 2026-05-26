# Claude Instructions — Payprompt

## Adding a new environment variable

All four steps are required. Missing any one of them silently breaks something.

1. **`packages/proxy/src/db.ts`** — read it via `process.env.VAR ?? null` in `seedProviders()`
2. **`docker-compose.yml`** — add `VAR: ${VAR:-}` to the `environment` block
3. **`packages/proxy/.env.example`** — document it with an empty value (under the right section heading)
4. **Root `.env` symlink** — must exist: `ln -sf packages/proxy/.env .env` so docker-compose can expand `${VAR}` substitutions

**Why the symlink matters:** docker-compose reads `.env` from the repo root, not from `packages/proxy/`. Without it, all `${VAR:-}` expansions silently become empty strings.
