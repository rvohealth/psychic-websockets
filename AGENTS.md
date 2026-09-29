# Agent instructions for psychic-websockets

## Dependency updates

Two independent dependency graphs live in this repo: the root (`package.json` + `pnpm-lock.yaml`, the published library and its test-app) and `client/` (`client/package.json` + `client/pnpm-lock.yaml`, the browser client used by feature specs). Always consider both, and regenerate each manifest together with its own lockfile.

When a transitive package is stale or vulnerable:

1. Inspect the dependency paths (`pnpm why <pkg>` and `pnpm audit`, in the applicable root or `client/` directory).
2. **First update the direct/top-level packages that bring it in** to their latest supportable releases. Update the relevant `package.json`, regenerate the matching `pnpm-lock.yaml`, and inspect every resolved copy of the transitive package. Do not add a transitive package as an unrelated direct dependency and assume that fixes its other copies.
3. If the owning direct packages are already current or cannot resolve the issue, try a compatible lockfile refresh (`pnpm update`) and trace the remaining paths to other upgradable parents.
4. **Do not add or retain `overrides`/`resolutions` while any parent-package or normal resolution route works. If those routes are impossible, ask the user before even considering an override; never introduce one autonomously.**
5. Check advisories and the actual resolved graph after each attempt, for both root and client where affected.

Constraints:

- Respect `.npmrc` (`minimumReleaseAge`, registry policy). A release-age obstacle is handled only as an explicit, exact-version, user-approved exception, never as an override.
- Keep the pinned root `packageManager` version and integrity hash reproducible. Evaluate a pnpm/toolchain bump deliberately, especially across majors, rather than using one to mask a dependency or local-store problem.
- Keep `pnpm-workspace.yaml` `allowBuilds` minimal; it is a supply-chain allowlist.
- Align `@rvoh/dream`, `@rvoh/psychic`, the spec helpers, Socket.IO, Redis, Koa, TypeScript and their peers as one compatible set (check `npm view @rvoh/dream peerDependencies`; e.g. Dream pins the `kysely` and `commander` majors). Do not blindly take an incompatible major.
- Node 26 is the primary development/CI/release target; Node 24 is supported. Keep `@types/node` on major 26 (typings are not a runtime constraint), keep `node-version` "26" in `.github/workflows/release.yml` and as the first entry of the `pr-checks.yml` matrix, and keep Node 24 in that matrix for the unit, feature and build jobs. Do not add `engines.node` above `>=24`, and do not use Node 25/26-only runtime APIs in `src/`. Re-verify Node 24 (frozen installs, build, lint, unit and feature specs, ESM and CJS exports) after every dependency refresh.

Verify before claiming an update works (the feature spec needs Postgres and Redis running locally):

```sh
pnpm install --frozen-lockfile && (cd client && pnpm install --frozen-lockfile)
pnpm audit && (cd client && pnpm audit)
pnpm lint && pnpm build
pnpm psy db:migrate            # after a Dream bump, so the test-database pool exists
pnpm uspec --run
pnpm exec puppeteer browsers install firefox   # after a puppeteer bump (build scripts are denied)
pnpm fspec
(cd client && pnpm build && pnpm lint)
```

Confirm `pnpm why @rvoh/psychic` shows the version you intend to support. A green run against an old lockfile proves nothing.

Record intentionally held-back versions and compatibility limits in `CHANGELOG.md` (and TSDoc where relevant).

## Local request notes

Root-level `FEATURE_REQUEST_*.md` scratch notes stay untracked and visible: never commit them, never add them to `.gitignore` or `.git/info/exclude`. Archive them to `~/Documents/psychic-history/psychic-websockets/` only after the work is verified against current source.
