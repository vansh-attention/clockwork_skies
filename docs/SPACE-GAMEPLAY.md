# Offline Space Gameplay

## Current direction

The first-person spacecraft slice lives at `?mode=local-space` in **The Drift Yard**, a bounded Cartesian station-and-asteroid arena. The illustrated globe now opens as a solo browser flight at `/`; the older multiplayer version lives at `?mode=legacy-online`. Neither offline slice requires the game server.

## Local start

```sh
npm ci
npm run dev:space
```

Open `http://127.0.0.1:5173/?mode=local-space`. Training starts with five ordered gates and three stationary targets. Skirmish starts with three local drones. Keyboard flight is available when pointer lock is unavailable.

## Verification run

```sh
npm run test:space
npm run typecheck
npm run build:space
npm run test:e2e:space
```

The functional browser suite uses SwiftShader for deterministic correctness checks. It is not a performance certification.

## Native benchmark

Run the preview separately, then use an idle foreground Chrome window on the native GPU:

```sh
npm run build:space
npm run preview:space -- --port 4175
npm run bench:space -- --quality=medium --drones=6 --seconds=60 --port=4175
npm run bench:space -- --quality=low --drones=3 --seconds=60 --port=4175
```

The benchmark records raw frame timing, CPU timing, drawing-buffer dimensions, render calls, triangles, resource counts, pause/visibility state, the renderer identifier, console errors, and `failedResourceRequests` when available. That last field includes HTTP 4xx/5xx responses, network failures, and URL-bearing browser resource warnings that do not reach Playwright's page network events. Each entry identifies its URL, status or network error, and source. Any failed resource request fails the benchmark gate. A software-rendered run, paused run, hidden run, wrong-resolution run, or short run is a failure/inconclusive result—not evidence that the target passed.

### Recorded run

On the October 19 run, Chrome reported `ANGLE (AMD, AMD Radeon 740M Graphics ... D3D11)`. Medium, 1920×1080, six benchmark entities, 60 seconds: **PASS**; median frame interval `6.9 ms`, p95 `7.5 ms`, CPU mean `0.33 ms`, 9 render calls, 7,616 triangles, 9,256 frames, 0 pauses, and 0.1 seconds of dropped simulation time. The two non-game 404 warnings were both Chrome requests for `/favicon.ico`: the page had no declared icon, and Chrome fetched its implicit fallback twice. The page network listener did not see these browser-level requests, so the earlier gate missed them. The client now declares and serves `/favicon.svg`, and the benchmark reports browser resource warnings with their URLs.

On October 25, the medium/1920×1080/six-entity/60-second native Chrome run at `?mode=local-space` **PASS**ed with zero console errors and zero failed resource requests. Median frame interval was `7.0 ms`, p95 `14 ms`, and CPU mean `0.38 ms`. A controlled run against a temporarily missing favicon produced two URL-labeled 404 entries in `failedResourceRequests` and a **FAIL** result; the built file was then restored.

## Playtest checklist

- The start view shows at least two recognizable landmarks before launch.
- Forward motion is obvious without staring at the speed number.
- Mouse or keyboard turning does not drift after input stops.
- Gates, target brackets, hit feedback, overheat, lock and sector warnings are distinct.
- The cockpit sill does not cover the central aiming area.
- A pilot can clear three gates and hit a target without fighting the camera.
- Escape, blur and pointer-lock loss pause the complete local simulation.

## Known limits

The local slice intentionally uses simple faceted materials, authored AABB/sphere collision proxies, pooled effects and synthesized audio. The old illustrated MRT compositor remains for the legacy route; it is not allocated by the local route. Native performance numbers must be recorded on the actual hardware and browser rather than inferred from unit tests or SwiftShader.
