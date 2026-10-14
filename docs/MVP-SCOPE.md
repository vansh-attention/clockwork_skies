# Clockwork Skies — approved local multiplayer MVP

This is the playable vertical slice of the original Clockwork Skies private-alpha plan supplied by the user. It reuses the existing sibling project; `D:/Projects/Game-3JA/analysis/messenger` is reference material only. No captured Messenger code or assets may be imported.

## Slice order

1. Restore clean builds/tests and a functioning client/server join path.
2. Connect cockpit flight and server-authoritative combat, pickups, bot filling, geodesic storm, emergency redeploy, elimination, spectating and results.
3. Exercise two independent browser clients in the same room; verify match lifecycle and provide reproducible local run instructions.

## MVP acceptance

- Node 24, npm lockfile, dependency-ordered builds and a documented `npm run dev` entry point.
- A semantic launch form, original procedural planet/aircraft, readable cockpit HUD and flight manual.
- Two human browser clients share one authoritative Colyseus room; bots fill vacancies to 16 seats.
- Server owns flight integration, damage, ammunition, cooldowns, pickups, storm and victory; malformed/stale client commands cannot change those directly.
- Matches cannot deadlock when the last contenders are destroyed together.
- Results and another-flight navigation work without restarting the server.
- Shared regression tests, server transport/lifecycle tests, content validation and an isolated-browser multiplayer smoke test are runnable.
- Headless fixed-seed bot runs exercise the same authoritative mechanics and repeat identical results.

## Deliberately deferred

Cloudflare/Fly.io publication, Singapore hosting verification, Sentry, a production invite rollout, permanent persistence, production load/rate-limit guarantees, 100-match/two-hour release certification, lag-compensated rewind, full gamepad/remapping and accessibility certification, Blender/GLB/KTX2 asset production, authored LOD pipelines, final LUT/SMAA polish and balance/performance tuning on target hardware.

Original procedural geometry and synthesized audio are sufficient for this MVP. A passing smoke test is not proof of the full private-alpha acceptance campaign. Do not present deployment config files as deployed infrastructure.

## Review and history

The input folder and sibling project were not Git repositories when inspected. No commits or external publishing are authorised by this scope. Verification results belong in `docs/VERIFICATION.md` and must be based on actual command output, with partial/unrun checks labelled.
