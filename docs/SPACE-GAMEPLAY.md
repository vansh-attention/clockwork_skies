# Offline Space Gameplay

## Current direction

The default client is now a local first-person spacecraft game in **The Drift Yard**, a bounded Cartesian station-and-asteroid arena. The old globe-based multiplayer game remains available at `?mode=legacy-online` and is not required for local play.

## Local start

```sh
npm ci
npm run dev:space
```

Open `http://127.0.0.1:5173`. Training starts with five ordered gates and three stationary targets. Skirmish starts with three local drones. Keyboard flight is available when pointer lock is unavailable.

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

The benchmark records raw frame timing, CPU timing, drawing-buffer dimensions, render calls, triangles, resource counts, pause/visibility state, and the renderer identifier when available. A software-rendered run, paused run, hidden run, wrong-resolution run, or short run is a failure/inconclusive result—not evidence that the target passed.

### Recorded run

On the current Windows machine, Chrome reported `ANGLE (AMD, AMD Radeon 740M Graphics ... D3D11)`. Medium, 1920×1080, six benchmark entities, 60 seconds: **PASS**; median frame interval `6.9 ms`, p95 `7.5 ms`, CPU mean `0.33 ms`, 9 render calls, 7,616 triangles, 9,256 frames, 0 pauses, and 0.1 seconds of dropped simulation time. Two non-game 404 resource warnings were emitted and remain a follow-up cleanup item; they did not affect the benchmark gate.

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
