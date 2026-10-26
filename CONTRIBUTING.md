# Contributing to psychic-websockets

`@rvoh/psychic-websockets` is the websocket plugin for [Psychic](https://psychic-docs.netlify.app/docs/plugins/websockets/overview) applications. This repo holds the published library (`src/`), a small Psychic reference app used by the specs (`test-app/`), the specs (`spec/`), and a separate browser client the feature specs drive (`client/`).

Agent-specific rules live in [AGENTS.md](AGENTS.md). Where this guide points there, that file is the source of truth.

## Prerequisites

- **Node 26** (the primary development, CI and release target) or **Node 24** (supported). CI runs the unit specs, feature specs and build on both. Linting and the sync check run on Node 26 only. `package.json` declares no `engines.node`. The `.node-version` file is gitignored, so choose your Node version locally.
- **pnpm 12.14.0.** It is pinned through `packageManager` in `package.json`. Get it one of these ways:
  - **Node 26** does not bundle corepack. Run `npm i -g corepack`, then `corepack enable`.
  - **Node 24.12.0 or later**: run `corepack enable`. The bundled corepack works.
  - **Node 24 before 24.12.0**: run `npm i -g corepack@0.34.7` first, then `corepack enable`. The corepack bundled with these releases (0.34.4 and older) cannot launch pnpm 12, so every `pnpm` command fails with `MODULE_NOT_FOUND …/bin/pnpm.cjs`. Using Node 26 or a standalone pnpm also avoids this.
  - **A standalone pnpm** (e.g. `npm i -g pnpm`) also works. It switches to the pinned 12.14.0 when you run it in this repo.
- **PostgreSQL** on `localhost:5432`, for both spec suites. CI uses Postgres 13.
- **Redis** on `localhost:6379`, for the unit specs (`RedisWebsocketsAdapter` connects with ioredis defaults). In the test environment the reference app uses the in-process adapter, so the websocket server started by the feature specs does not need Redis. CI still runs Redis 6.2 for both suites.
- **Firefox for Puppeteer**, for the feature specs (see Setup).
- **Free ports for feature specs**: 3000 (the `client/` Vite dev server), 7778 (the Psychic HTTP server) and 8889 (the websocket server).

## Setup

1. Install dependencies. `client/` is its own pnpm project with its own lockfile, so install it separately:

   ```sh
   pnpm install --frozen-lockfile
   (cd client && pnpm install --frozen-lockfile)
   ```

2. Create `.env.test` at the repo root. It is gitignored (`.env*`). The CLI and specs load it when `NODE_ENV=test`, and `pnpm psy` defaults to that environment:

   ```sh
   DB_USER=<your postgres user>
   DB_NAME=psychic_websockets_test
   DB_HOST=localhost
   DB_PASSWORD=
   DB_PORT=5432
   APP_ENCRYPTION_KEY=<a base64 aes-256-gcm key>
   ```

   `APP_ENCRYPTION_KEY` must be a valid aes-256-gcm key, because the reference app's socket authentication and the feature specs use it. Generate one with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Variables already set in your shell take precedence over `.env.test`. Optional settings: `DB_USE_SSL=1`, `HEADLESS=0` (watch the feature-spec browser) and `DEBUG=1` (print browser output).

3. Create and migrate the test database:

   ```sh
   pnpm psy db:create
   pnpm psy db:migrate
   ```

   `db:migrate` also creates the per-worker test-database pool (`<DB_NAME>_2`, `_3`, …) that Dream uses under vitest. Without `--skip-sync` it also regenerates the test-app's types and OpenAPI files. Re-run it after you pull new migrations or bump `@rvoh/dream`. `pnpm psy db:drop` removes the database and its pool.

4. Install the Puppeteer browser for the feature specs. Dependency build scripts are denied (see `allowBuilds` in `pnpm-workspace.yaml`), so Puppeteer cannot download it at install time:

   ```sh
   pnpm exec puppeteer browsers install firefox
   ```

   Re-run this after a Puppeteer bump.

No build step is needed before running specs. They run the TypeScript sources through vitest and tsx.

## Running checks

| Command                                      | What it does                                                                | CI job                         |
| -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| `pnpm lint`                                  | ESLint on `src/**/*.ts`, then `prettier --check` on the repo                | Linting (Node 26)              |
| `pnpm format`                                | Rewrites files with Prettier                                                | none                           |
| `pnpm build`                                 | Type-checks and builds CJS and ESM into `dist/`                             | Check build (Node 26, 24)      |
| `pnpm uspec`                                 | Unit specs (`spec/unit`; needs Postgres and Redis)                          | Unit tests (Node 26, 24)       |
| `pnpm fspec`                                 | Feature specs (`spec/features`; needs Postgres, Firefox and the free ports) | Feature tests (Node 26, 24)    |
| `(cd client && pnpm build && pnpm lint)`     | Type-checks, builds and lints the browser client                            | Check build (Node 26, 24)      |
| `pnpm psy sync`                              | Regenerates the test-app's database types, app types and OpenAPI files      | Ensure no sync diffs (Node 26) |
| `pnpm audit` and `(cd client && pnpm audit)` | Advisory check for each dependency graph                                    | none                           |

`pnpm uspec` runs once and exits. Pass a path to run one file, e.g. `pnpm uspec spec/unit/cable/ws.spec.ts`. `pnpm fspec` starts the client dev server (`pnpm client:fspec`) and the websocket server (`pnpm ws:fspec`) itself and stops them afterwards. Use `pnpm fspec:hanging` to find a feature spec that keeps the process alive.

The Check build job also loads the built package through its ESM and CJS exports on each Node version. The Ensure no sync diffs job fails if `pnpm psy sync` changes any tracked file, so commit what `sync` generates.

pnpm enforces the release-age cooldown described in the next section on every install, including CI's `--frozen-lockfile` installs.

## Dependency updates and supply-chain policy

Follow the dependency-update procedure in [AGENTS.md](AGENTS.md#dependency-updates). It covers both dependency graphs (root and `client/`), updating parent packages before transitive ones, keeping the Dream, Psychic, Socket.IO, Redis, Koa and TypeScript set compatible, the Node 24 and Node 26 support policy, and the commands to run before you claim an update works. [SECURITY.md](SECURITY.md#supply-chain-hardening) explains why these defenses exist.

- **Release-age cooldown.** `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (3 days), so pnpm will not install a version published more recently. `minimumReleaseAgeExclude` exempts only `@rvoh/*`, our own packages. `client/pnpm-workspace.yaml` repeats the cooldown, because `client/` does not inherit the root file. pnpm enforces this on every install, CI's `--frozen-lockfile` install included; the `@rvoh/*` exclusion is the only bypass. Changes to `pnpm-workspace.yaml`, `.npmrc`, any pnpmfile, or the workflow files are reviewed like any other code change. If a release you need is too new, wait or ask a maintainer. Do not add an exclude.
- **`.npmrc` is registry-only.** pnpm 11+ reads only registry and auth settings from it and ignores install policy there; release-age settings belong in `pnpm-workspace.yaml`.
- **Build scripts.** `allowBuilds` in `pnpm-workspace.yaml` is a supply-chain allowlist. Keep it minimal.
- **No overrides or resolutions** without a maintainer's approval, and only after updating parent packages and refreshing the lockfile have failed.
- **Toolchain.** Keep the pinned `packageManager` version and its integrity hash. Treat a pnpm bump as a separate, deliberate change.
- Regenerate each `pnpm-lock.yaml` together with its own `package.json`. CI installs with `--frozen-lockfile`.

## Changes and pull requests

- Branch from `main` and open a pull request against it. All PR checks above must pass. [CODEOWNERS](CODEOWNERS) requests review from the maintainers.
- Add or update specs for behavior changes. Unit specs live in `spec/unit`. End-to-end websocket behavior, driven through Puppeteer and `client/`, lives in `spec/features`.
- **Versioning and changelog.** A change that affects applications using this package needs a semantic version bump in `package.json` and a matching numbered entry in `CHANGELOG.md`, in the same PR. This includes fixes to published TypeScript declarations and to dependency or runtime compatibility. Write only consumer-facing changes, under the version that releases them, and never add an `Unreleased` section. Internal-only changes (tests, test-app, CI, tooling, development dependencies, agent instructions) get no changelog entry and need no release. Record internal development-dependency constraints in the PR description.
- **Public exports.** Export an error class only when an application developer needs to throw it or should reasonably catch it as part of normal application flow (see [AGENTS.md](AGENTS.md#public-error-exports)). The package's public entry points are `src/index.ts` and `src/testing/index.ts`.
- Do not use Node 25 or 26-only runtime APIs in `src/`, because Node 24 is supported.

## Releases

Maintainers publish releases from GitHub Releases. The `release.yml` workflow builds the package and publishes it to npm with OIDC trusted publishing and provenance. The release tag must match the `package.json` version. See [RELEASING.md](RELEASING.md) for the steps.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not open a public issue.
