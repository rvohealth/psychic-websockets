# Configurable max connections per user + registry TTL — 2026-06-15

## Status

- [x] 1. Add config surface on `PsychicAppWebsockets` (set/get/types) — done (commit 23cc4b0)
- [x] 2. `RedisWebsocketsAdapter` reads max-connections + TTL from config — done (commit 3a0b45a)
- 🚫 3. In-process adapter parity for the cap — dropped (keep in-process unbounded)
- [x] 4. Specs + test-app conf + README docs — done (commit 16c8774)

Status legend: ⬜ pending · 🟦 in progress · ✅ done · ⏸ deferred · 🚫 dropped

## Pre-flight findings

- Mandated rules: none. No `CLAUDE.md` / `AGENTS.md` in repo. This is the framework package itself, not an app, so `psychic-skill` is not auto-invoked (no mandate).
- Both magic numbers live in `src/cable/adapter/RedisWebsocketsAdapter.ts#register`:
  - cap of 3 = `lrange(redisKey, -2, -1)` (keep last 2) then `rpush(..., socket.id)`.
  - TTL = `expireat(..., DateTime.now().plus(isTest ? { seconds: 15 } : { day: 1 }))`, carrying a `// TODO: make this configurable in non-test environments`.
- Config is set through `PsychicAppWebsockets#set(option, value)` (options: `connection`, `socketio`, `healthCheck`, `adapter`). Adapter reads global config fresh on each call.
- In-process adapter (`InProcessWebsocketsAdapter`) uses an unbounded `Set`, no TTL (test/dev default).
- Ecosystem precedent for durations: `psychic-workers` `DelayedJobDuration` = `{ seconds?, minutes?, hours?, days? }`, folded to seconds via `durationToSeconds`. This is how app devs already express job delays/TTLs.
- Verification commands: `pnpm lint`, `pnpm uspec` (unit), `pnpm fspec` (feature). Redis adapter unit specs hit a real local redis.

## Resolved framing (Q1)

The registry TTL is an independent garbage-collection backstop on the `user:<id>:socket_ids` list — it cleans up registry entries when a socket dies ungracefully and the `disconnect` handler never fires. It is not the live socket's lifetime (socket.io owns that via `pingTimeout`/`pingInterval` in `socketioOptions`). The two stay independent; this change adds one TTL knob (the registry key), not two.

## Open questions

- (none — interview complete)

## Verification

- `pnpm lint` — pass.
- `pnpm uspec` — pass (42 tests; 11 in `RedisWebsocketsAdapter.spec.ts`).
- `pnpm fspec` — pre-existing failure, unrelated to this change. The browser feature spec fails identically on `main` (global setup needs a client dev server + ws server + puppeteer that the sandbox can't fully start). Not introduced here.

## Spinoffs

- (none yet)

---

## Item details

### 1. Config surface on `PsychicAppWebsockets`

**Status:** pending

**Intent:** app devs configure both limits through the existing `wsApp.set(...)` surface, with the same ergonomics as `connection` / `socketio`. Two new options: a max-connections integer and a registry TTL expressed as a duration object.

**Acceptance criteria:**

- `wsApp.set('maxConnectionsPerUser', 5)` and `wsApp.set('maxConnectionTtl', { days: 1 })` typecheck and round-trip through getters.
- A local duration type (`{ seconds?, minutes?, hours?, days? }`) mirrors workers' `DelayedJobDuration`; a local `durationToSeconds` folds it to seconds. No import from `psychic-workers`.
- Getters return configured value or default (cap default 3; TTL default env-branched, see Item 2).
- Invalid input throws from `set()`.

**Decisions:**

- (1) Option names `maxConnectionsPerUser` and `maxConnectionTtl`. Authority: existing descriptive-noun option naming. Low-confidence — naming taste is yours.
- (2) TTL public type = local `WebsocketConnectionDuration` mirroring workers' `DelayedJobDuration`, plus a local `durationToSeconds`. Authority: locked in interview (Q3); ecosystem consistency.
- (3) Validation in `set()`: `maxConnectionsPerUser` an integer ≥ 1; TTL must resolve to > 0 seconds; throw otherwise. Authority: guardrail; reversible.

### 2. `RedisWebsocketsAdapter` reads config

**Status:** pending

**Intent:** replace the two hardcoded values in `register` with config reads, defaults preserving today's behavior.

**Acceptance criteria:**

- Cap driven by `maxConnectionsPerUser`: keep the last `(max − 1)` ids, then push the new one.
- TTL driven by `maxConnectionTtl`, converted to seconds.
- Default cap = 3. Default TTL = single constant `{ days: 1 }`, no env-branch.

**Decisions:**

- (4) Cap default = 3. TTL default = `{ days: 1 }` always; the `isTest ? {seconds:15}` env-branch is removed from library code. `RedisWebsocketsAdapter.spec.ts` sets its own short `maxConnectionTtl: { seconds: 15 }` via the new knob to keep real redis keys short-lived. Authority: now that TTL is configurable, the spec owns its own short TTL and library code keeps one honest default.
- (5) Cap eviction keeps newest, drops oldest (current redis behavior). Authority: preserve behavior.
- (6) `max === 1` handled explicitly (keep zero prior ids), avoiding the `lrange(key, 0, -1)` off-by-one that would otherwise return all ids. Authority: correctness.
- (7) Reversible mechanic, implementer's call: relative `expire(key, seconds)` is simpler than recomputing `expireat`; either is fine.

### 3. In-process adapter parity for the cap — DROPPED

**Status:** 🚫 dropped

In-process adapter stays unbounded. Rationale: enforcing the cap only in specs/dev would risk a hard-to-debug divergence that affects specs but not prod. The cap is a prod (redis) concern; the in-memory test tool stays simple.

### 4. Specs + test-app conf + README docs

**Status:** pending

**Intent:** cover the new config and document it.

**Acceptance criteria:**

- `RedisWebsocketsAdapter.spec.ts`: sets its own `maxConnectionTtl: { seconds: 15 }`; the "restricts to 3" test becomes config-driven; add a custom-cap case, a custom-TTL assertion, and the `max === 1` edge.
- test-app `conf/websockets.ts`: show the two new `set(...)` calls.
- README: document `maxConnectionsPerUser` and `maxConnectionTtl`, including the registry-TTL-is-a-backstop framing.
