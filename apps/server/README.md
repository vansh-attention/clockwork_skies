# Authoritative server verification

Requires Node 24. The server binds `127.0.0.1` by default; opt in to other interfaces with `HOST` (e.g. `HOST=0.0.0.0` inside Docker). Production startup requires an explicit `INVITE_SECRET` of at least 32 characters, never the development secret.

Installed versions are Colyseus core 0.18.18, SDK 0.18.5, schema 5.0.39 (not 0.17).

```sh
npm run build -w @clockwork/shared
npm run build -w @clockwork/content
npm run test -w @clockwork/shared
npm run test -w @clockwork/server
```

## Real bot simulation CLI interface

Import `runBotMatch` and `fastMatchRules` from `apps/server/src/runBotMatch.ts` when using tsx (or `apps/server/dist/runBotMatch.js` after build).

```ts
const { state, events, ticks, simulatedSeconds } = runBotMatch({ seed: 42 });
// Optional: { seed, rules: MATCH_RULES, maxSeconds: 1200 } for production timing.
```

This invokes exactly MatchRoom's authoritative flight/combat/pickup/storm/redeploy/winner methods, not a parallel simulation. Default harness uses explicit fast rules, fixed 20 Hz and a deterministic initial time/room ID; production room defaults are unchanged. Seed 42 verified with 16 bots: 191 ticks, 9.55 simulated seconds, winner bot_07_simulation (553 events).

Production-rules seed 42 also verified: all six non-complete phases, 13,595 ticks / 679.75 simulated seconds, winner bot_05_simulation, 2,598 cannon shots, 9 rockets and 14 redeploy schedules.

Low-level trusted harness: `room.initializeSimulation({ manual:true, rules, seed, startTime })`, then `room.advanceSimulationForTest(dtSeconds, nowMilliseconds?)`. With omitted time it increments serverTime by dt*1000. Never pass matchmaking/client options to initializeSimulation. Call `room.clock.clear()` and `room.onDispose()` when finished. Network tests subclass MatchRoom and supply trusted fast rules from onCreate; clients cannot change room rules.

## Contract and safety

Protocol v1 fields and events unchanged. Schema uses schema5's toolchain-independent `schema()/t.*`; class-field initialization previously bypassed tracked MapSchema setters and crashed real join patches under the Vite test transform.

Controls expire after 500ms without fresh accepted inputs, become neutral on drop, and retain monotonic uint32 acknowledgements across reconnect and redeploy. Non-finite/out-of-range payloads and spectator controls are rejected. Disconnected pilots retain their aircraft during reconnection grace; grace expiry or consenting leave final-eliminates them. Lobby leavers are removed before bot fill.

Rocket lock duration is enforced on the server. Bot pursuit yaw sign corrected; outside-storm steering prioritizes the safe cap. Simultaneous zero-survivor elimination deterministically awards latest eliminated, then highest kills, then lexicographic ID; matches cannot deadlock without a winner.

Guests require validated HS256 claims, issuer and expiry. Invites require exactly two segments and validated integer expiry/use limits. Production refuses the built-in development secret or secrets shorter than 32 characters. ALPHA-LOCAL is development-only. Invite-use storage is in-memory (single-process MVP limitation, not distributed persistence).
