# Clockwork Skies

A playable **local multiplayer MVP** of an illustrated, first-person aerial battle royale. Original procedural aircraft and mechanical landmarks surround a miniature spherical planet. One authoritative Colyseus room handles each match; bots fill empty seats to sixteen pilots.

This is not the complete private-alpha release. The agreed boundary is in [docs/MVP-SCOPE.md](docs/MVP-SCOPE.md), with observed verification results in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Play locally

Requires **Node.js 24+**, npm, and a desktop browser with WebGL2.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Choose a callsign and aircraft paint, leave the room access code as **`ALPHA-LOCAL`**, and enter the skies. Open a second browser/tab before the lobby countdown expires to share the match. Empty seats become server-controlled bots.

The development server listens on `127.0.0.1:2567` by default. No external accounts, API keys, paid services, or Google Fonts are needed. Root `.env` is optional and is loaded by `npm run dev` if present; `.env.example` shows the supported local settings. The example secret is a placeholder, not a production secret.

**Click or focus the flight canvas to fly.** Escape releases the mouse; opening the flight manual stops your local controls but does not pause the shared match. Your aircraft remains vulnerable. Use the results screen to return to the manifest and join another flight.

### Controls

| Input | Action |
| --- | --- |
| Mouse | Assisted aim/steering |
| Left mouse | Cannon; heat-limited, no ammunition |
| Hold right mouse | Acquire a valid target, lock and fire a rocket |
| W / S | Throttle |
| A / D | Fine steering/bank assistance |
| Space | Boost |
| C | Rear glance |
| Q | Enemy ping |
| 1–4 | Plane emotes |
| Escape | Release captured mouse |

The flight manual includes reduced motion, audio controls, render debug channels and leaving the match. Basic gamepad input exists, but hardware controller testing and full remapping are not certified in this MVP.

### Match rules

- Equal aircraft: 100 hull, two starting rockets, finite boost, heat-limited cannon.
- Repair, rocket, boost and shield pickup rings are collected by proximity on the server.
- A geodesic safe zone shrinks over the planet; altitude does not avoid storm damage.
- One emergency redeploy during early phases; reserve aircraft returns without rockets. Final combat phases disable new redeploys.
- Final destruction switches to spectating. The last contender wins; simultaneous final deaths have a deterministic tie-break rather than leaving a deadlocked room.
- Disconnected controls go neutral. Reconnection is bounded; no database or restart recovery exists.

## Verify

```sh
npm run verify
npx playwright install chromium
npm run test:e2e
```

`verify` runs dependency-ordered type checks, package/tool tests, production builds, content validation and ten fixed-seed bot matches, each executed twice and checked for identical event sequences and final state. Headless simulations use **normal match rules** by default and execute the authoritative room logic, not a separate approximation.

```sh
npm run simulate -- --matches=10 --seed=42
npm run simulate -- --matches=100 --fast
npm run validate:content
```

`--fast` explicitly shortens the phase schedule and increases storm damage for accelerated lifecycle testing. It does not change live room defaults. A successful bot simulation does not establish real-device FPS, multiplayer balance or network impairment tolerance.

The Playwright suite checks HTTP validation and two independent browser contexts joining the same room, bot filling, cockpit controls and the flight manual. Screenshots and reports are written under `test-results/`. Browser tests can launch `npm run dev` themselves or reuse an already-running local instance. **Do not rebuild packages or edit server code during a browser test:** development watchers restart the server and discard in-memory rooms.

## Optional LAN play

This is opt-in, not the default. Set root `.env` to the host computer's LAN address:

```dotenv
HOST=0.0.0.0
CLIENT_ORIGIN=http://YOUR_LAN_IP:5173
VITE_SERVER_URL=http://YOUR_LAN_IP:2567
```

Restart `npm run dev`, allow the required ports in your firewall if you choose, and have all pilots (including the host) use `http://YOUR_LAN_IP:5173`. Do not expose the development service to the public Internet. LAN/firewall configuration has not been validated on a second physical device.

## Workspace

- `apps/client`: React application shell, direct Three.js scene, inputs, HUD, audio and prediction.
- `apps/server`: Colyseus room, bots, HTTP sessions, invites and metrics.
- `packages/shared`: flight simulation, protocol, schemas and rules.
- `packages/render`: illustrated materials, MRT contour composition and debug views.
- `packages/content`: original procedural world, pickup, bot and paint manifests.
- `tools`: content validation, invite generation and deterministic match runner.
- `tests/browser`: isolated-browser/HTTP smoke checks.

Health: `http://localhost:2567/healthz`. Metrics: `http://localhost:2567/metrics`.

## Invites and deployment boundary

`ALPHA-LOCAL` is a **development-only** bypass. For signed codes, set a real `INVITE_SECRET` of at least 32 random characters, then run:

```sh
npm run invite -- --uses=20 --hours=72
```

Invite-use counters and rooms are in memory and reset on server restart. Cloudflare/Fly.io config files are starting points, **not evidence of deployment**. Docker and LAN configurations are provided but are not part of the verified release path. Before public hosting, address operational rate limiting, TLS/origin policy, persistence, load testing and the full alpha acceptance campaign.

## Known MVP limits

Procedural geometry replaces a Blender/glTF/KTX2 production asset pipeline. Terrain collision is simplified; detailed landmark/plane collision, lag-compensated cannon rewind, final LUT/SMAA polish, robust controller remapping, full accessibility certification, packet-loss/performance benchmarks and long soaks remain outside this MVP. Rendering uses system fonts, original geometry/shaders and synthesized sounds; no Messenger captures are loaded into the game.
