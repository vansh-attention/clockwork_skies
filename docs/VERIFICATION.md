# Local MVP verification

## Verdict

**Playable local multiplayer MVP verified. Not a private-alpha release certification.**

The verification path ran on Windows with Node 24.20.0/npm 11.19.0. The real local server and Vite client were used. Browser tests ran isolated Playwright Chromium contexts with software WebGL; they did not require access to the user's personal Chrome profile.

## Actual command results

| Check | Result |
| --- | --- |
| `npm run verify` | Exit 0: typechecks, full package/tool test run, production builds, content validation and fixed-seed simulation |
| Client Vitest | 14 passed |
| Server Vitest | 19 passed, including real SDK/WebSocket clients and lifecycle/combat/auth regressions |
| Render Vitest | 2 passed |
| Shared Vitest | 13 passed |
| Tool Node tests | 7 passed |
| Total package/tool tests | **55 passed, 0 failed** |
| Content package's own test command | No test files; content is checked by the tool suite and validator, not claimed as a separate passing test suite |
| `npm run test:e2e` | **4 passed**, 0 skipped/unexpected/flaky; 3 HTTP checks and 1 two-browser multiplayer journey |
| `npm run simulate -- --matches=10` | **10 normal-rules seeds, 20 executions, 16 pilots per match**; each seed replay compared for identical events, final state and tick count |
| `npm run validate:content` | 8 landmarks, 40 pickup nodes, 4 paints and 3 bot profiles accepted; malformed/duplicate/out-of-shell content rejection tested |
| `npm audit` | 0 known vulnerabilities in the resolved dependency tree |
| Live readiness | Client HTTP 200; `/healthz` HTTP 200 with `ok: true` |

### Browser journey

Two independent browser contexts submitted different callsigns through the actual launch form and joined room `TQw8yvLQ5` with distinct player/session IDs. Both saw sixteen contenders after vacancy filling. The active pilot clicked the canvas to capture flight controls, fired the cannon (heat increased), boosted (meter decreased), issued ping/emote inputs and opened/closed the flight manual. The journey collected **zero browser page/console errors and zero MRT draw-buffer warnings**. The test does not assert a target hit or rocket kill from the browser; authoritative weapon damage and locking have server tests.

The first attempt failed on the absent stylesheet; later attempts caught the empty initial SDK snapshot, invalid sky-point MRT shader, hidden planet horizon and a background-tab automation focus issue. These were not treated as passing runs. The final browser run used the actual click-to-fly journey, without live edits/rebuilds resetting its room.

## Review findings resolved

- Initial SDK `{}` state is withheld until required match fields exist; state subscriptions have void cleanup callbacks.
- Colyseus/schema5 serialization uses `schema()/t.*` rather than toolchain-dependent class fields.
- Pending inputs replay once from the authoritative baseline; acknowledgement stays monotonic across redeploy/reconnect.
- Common 60 Hz integration substeps remove the 20 Hz/30 Hz held-input discrepancy. Pitch is preserved/transported with spherical frames and assisted toward the input target; fine-roll input affects authoritative steering.
- Cannon requires enough heat headroom for another shot; rocket lock time/range and projectile damage are server-owned.
- Disconnect controls expire/neutralize; reconnect grace expiry eliminates the pilot. Zero-survivor endings are resolved deterministically.
- Every world draw, including sky points, writes both MRT attachments. The cockpit now exposes the planet horizon and projects its cannon sight along the true weapon direction.
- Moving storm boundary is not culled using initial zero-size bounds.
- JWT claims/algorithm/expiry, invite shape/numeric bounds, malformed HTTP/input payloads and WebSocket rate limits are tested. Production cannot silently use the development secret.
- Removed remote font requests. Bumped concurrently to the patched 9.2.5 release and synchronized the npm lockfile.

## Evidence

Persistent copies are under `artifacts/verification/`:

- `verification-log.txt`: complete successful verification/audit command output.
- `simulation-results.json`: actual seed/winner/tick/event-hash summaries.
- `browser-results.json`: Playwright machine-readable results, including the matched room identifier.
- `title.png`, `cockpit.png`, `manual.png`: actual browser captures.

Fresh browser runs also write `test-results/`; Playwright clears that directory on subsequent runs, so the persistent evidence copy is separate. Screenshots establish observed output, **not visual-regression approval against an existing baseline**.

## Not verified / deferred

Cloudflare/Fly.io/Singapore deployment; Docker execution; a second physical LAN device; Firefox/Edge/Safari; target-device 1080p FPS and server tick p95; packet loss/latency scenarios; 100-match memory/soak certification; two-hour real-time soak; production restart recovery; complete keyboard/gamepad remapping, screen-reader/contrast/accessibility certification; lag-compensated cannon rewind; detailed landmark/plane collision; final assets/LUT/SMAA production pipeline. In-memory rooms and invite usage disappear on restart. These remain explicit MVP limitations, not passed acceptance criteria.

No Git repository was present and no commits or external publication were performed.
