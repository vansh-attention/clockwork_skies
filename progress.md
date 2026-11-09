Original prompt: in the gh repo clockwork_london, use reverse-engineer-anything and .claude/abeto-messenger as inspiration to rebuild the entire Clockwork city as London, iterating until the city feels as realistic and inhabited as Abeto Messenger.

## Current direction — reference look and human movement (2026-11-08)

User steering: the London build was too cartoonish. The character's walking did not match the reference, and the assets' shades and aura fell short. Graphics and movement come first; purpose, play and multiplayer are later.

- 2026-11-09, fourteenth pass. User reports characters submerged and asks to get the NPC and character movement right first (faces left for later).
  - **Sinking:** people now stand on the drawn London surfaces (roads 0.28, kerbs 0.34, squares, aprons, paving).
  - **Residents:** they no longer walk backwards (a mirrored heading). They ease in and out, step at a natural cadence, and make way for the courier.
  - **Courier:** she can no longer walk through people.
  - **Guards:** all mutation-checked; see look-analysis.md, fourteenth pass. Nothing committed.
- 2026-11-09, thirteenth pass. User asks: "change the faces of the characters inside the city / game … too cartoonish … the main character should look like a typical anime face as seen in the inspired game".
  - **Residents:** faces are now drawn flush the reference's way: small eyes under a lid stroke, thin brows, a thin mouth, no nose bump. Hair now covers their crowns.
  - **The courier:** she has the reference's calm, half-lidded anime face.
  - **Guards:** three new tests, each failing on the old faces. See look-analysis.md, thirteenth pass. Nothing committed.
- 2026-11-09, twelfth pass. User asks: "make her slim and chill like abeto messenger and make her look like a typical kawai anime girl". She is now a slim kawaii anime girl of her own design, and stays short.
  - **Look:** long chestnut hair with bangs, face-framing locks and a red ribbon bow; big glossy anime eyes and a pointed chin; a cream jumper with a neck bow; a pleated navy skirt that follows each thigh; knee socks and loafers.
  - **Carriage:** a relaxed standing carriage (`relaxPose`). Rhythm, pace and framing are unchanged. See look-analysis.md, twelfth pass. Nothing committed.
- 2026-11-09, eleventh pass. The courier is now a short, cute girl of her own design: a chestnut bob with a fringe and red clip, big eyes, a cream jumper, navy culottes, knee socks, chunky shoes and the satchel. User asks: "make the running character a cute female kawaii girl", then "keep her short and cute just like abeto messenger".
  - **Proportions:** `FigureLook.stature` shortens her legs (0.74) and trunk (0.9) while the head, shoes and satchel keep their size. She is 1.5 m and 4.2 heads tall.
  - **Scaling:** camera framing, pace and gait thresholds scale with her height (`courier/size.ts`). The gait is baked for her own leg, and her jog and sprint hips swing further to keep the reference's rhythm.
  - **Measured:** rhythm within 1% and pace within 1% in her heights; all start and stop timings inside the reference's ranges. See look-analysis.md, eleventh pass. Nothing committed.

- REA static analysis of the captured shipped bundle established the reference's techniques; see `.claude/abeto-messenger/look-analysis.md` for evidence IDs and line ranges. They are:
  - shading: HSV shade rule, soft and hard cuts, hemisphere fill, glancing highlight
  - ink: noise-broken lines, inked painted patches, a nearest-sample line pass with a dark slate ink
  - finish: exp² haze, LUT grade, and a character dissolve for a pinned camera
- Implemented independently with original art:
  - the shading model and drawn lines
  - a London LUT grade, teal-grey haze and a brushier sky
  - London plane trees carried high, which the camera passes under
  - one smoothly skinned courier (flat cap, mustard jacket, satchel) and 32 skinned residents
  - a keyframed human walk, jog and run gait without foot sliding, replacing squash and waddle
  - a two-stage walker response fitted to the live trace
- Verified: `npm run verify` exits 0 (652 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. Captures and sheets are in `artifacts/messenger-look/`.
- Second pass (density and assets):
  - added: road paint (double yellows, centre lines, give-way), manholes and gullies, tarmac wear; blinds, curtains, window boxes, downpipes, string courses and wheelie bins; litter bins and bollards with colliders; a rounded black cab and a rounded double-decker
  - fixed: the camera collapsing beside parked cabs (unpadded vehicle tops, with a mutation-checked regression), and a complete pinned-courier dissolve
  - re-verified: verify exits 0 (653 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors
- Third pass (measured in the running game against the reference; method and full tables in `.claude/abeto-messenger/look-analysis.md`):
  - movement: the reference probe's key sequence was replayed in the game on the native GPU. Starts retuned (the old fit followed the reference's AFK start), and the pose now blends with speed. Every start, stop and blend timing falls inside the reference's measured range.
  - camera: trails like the reference's, 3.1 heights back, over the shoulder. It slides behind the courier beside house fronts and rises over low obstacles to keep the courier in view.
  - streets: front areas paved from house to house, terraces three to four storeys, and the walk starts in a narrow terraced street. Vehicles are real size: the cab 4.58 × 1.76 × 1.83 m, the double-decker 11.1 × 2.53 × 4.39 m.
  - colour: road, flags, haze, sky, clouds and grade calibrated to the reference's measured tones. Road and pavement within a few RGB levels, sky within 3–10.
  - verified: `npm run verify` exits 0 (658 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. Each retune has a mutation-checked regression test.
  - evidence: `artifacts/messenger-look/` (`movement-curves.png`, `compare-motion-stages.png`, `compare-shading.png`, `real-size-vehicles.png`, plus `measurements.json`).
  - still different after the third pass: sprint rhythm, warmer lit greys, slightly lighter road shade, greener ink (all closed in the fourth pass below).
- Fourth pass (review follow-up, 2026-11-09):
  - rhythm: the courier walks at the reference's pace (2.11 heights/s). Steady jog 0.875 s cycle (137 steps/min) and sprint 0.876 s (137/min), against the reference's 0.871 s (138/min) for both; strides 1.85 and 2.58 heights against 1.84 and 2.60. Sprint foot slip fell from 0.18 to 0.02.
  - colour: green-leaning whites, deeper shade, blue-slate ink. Lit greys at hue 113–126° (reference 95–132°); ink at 199–203° (201–206°); road, pavement, window glass and sky within 2–12 RGB levels. Guarded by `city/atmosphere.test.ts`.
  - how stylised: measured on whole frames against the reference, with near-black share, vivid colour, saturation and flat fill now in or beside its range. Changes: glazing as dark slate glass, painted doors, charcoal iron, slate downpipes, softer detail outlines, red brick and jacket a step less saturated. Character proportions about 5.4 heads against the reference's 5.1.
  - verified: `npm run verify` exits 0 (662 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. Sheets and data are in `artifacts/messenger-look/`; tables are in `look-analysis.md`.
  - still different after the fourth pass: near-black up to 9.2%, more colours in the low street view, lit pavement darker (all closed in the fifth pass below).
- Fifth pass (REA, 2026-11-09):
  - reverse-engineer-anything: the reference's main bundle was re-analysed with REA (Evidence `ev_bb2641d4…`, the shipped file's SHA-256 `3b146c7d…`), and its sky shader read from it. The sky is one flat colour, with clouds by a hard step of noise; literal traces returned no match, which REA states is not absence.
  - sky rebuilt on that technique; street metal in the reference's own pole tone (new `iron` swatch); gentler painted value patches; lighter, green-tinted whites and flags.
  - REA `compare_web_screenshots` on uniform matched patches (sky, cloud, road and pavement, lit and shade): all identical within 8 levels, max channel difference 0–5. Evidence IDs are in `look-analysis.md`; patches are in `artifacts/messenger-look/rea-patches/`.
  - how stylised, as means of default-camera frames (reference / ours): saturation 0.22 / 0.20, vivid 1.9% / 2.4%, near-black 4.9% / 4.9%, flat fill 77.2% / 75.3%, colours 31.5 / 29.5.
  - verified: `npm run verify` exits 0 (662 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors.
  - still different: the fastest release is 4 ms quicker than the reference's quickest (within one frame); Little London is flat where the reference town is hilly (setting). Changes remain local and uncommitted.
- Sixth pass (REA and the reference's frames, 2026-11-09):
  - stops: brake 12.5 and pose against 0.6 of top speed. All 11 start, stop and blend timings now sit inside the reference's ranges.
  - statistics: Welch's t-test of our frames against the reference's own spread finds no detectable difference in saturation, vivid, near-black, flat fill or colour count (p 0.45–0.95).
  - framing: the reference world is a small planet (radial up). The earlier camera reading took world Y as up and is withdrawn. The REA-captured bundle gives a 45° lens and a follow offset of (0, 1, 5) aimed at the capsule top. Matched to five reference frames, our courier now stands 320 px tall with the head at the centre, feet near the bottom, x ≈ 500 (reference: 314–323 px, head 345–358, feet 662–678, x 485–505). The view looks at the head (`lookLift`); collisions are still judged about the chest.
  - façades: pattern marks fade out by 7 px per unit, so mid-distance terraces read as flat colour like the reference's walls.
  - dust: matched to the reference's `trails` particles. None at take-off, a pair on landing, about one a second while moving briskly, at most two, mid grey, a ninth of the courier's height across.
  - verified: `npm run verify` exits 0 (664 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. New and changed tests are mutation-checked. Sheets, captures and data are in `artifacts/messenger-look/`; tables are in `look-analysis.md`.
  - still different: jogging framing 24 px higher than the one reference jog frame; standing and jog frames slightly less flat than the reference's least flat; dust without noise-broken edges; flat setting. Noticed but left for review: chimney smoke as outlined white spheres and worn-stucco blobs on near white walls. Changes remain local and uncommitted.
- Seventh pass (the leftovers, from the reference's own code, 2026-11-09):
  - smoke: rebuilt on the reference's `smokevfx` technique (`city/chimneySmoke.ts`). View-facing plumes widen as they rise, with flat translucent fill at 0.35 broken by noise flowing upward. An alpha-keeping blend leaves ids, depth, normals and the ink mask untouched, so there is no ink. Original geometry and procedural noise; one draw call, as before.
  - walls: white stucco weathers in its own tones, in downward streaks with ragged inked edges, as the reference's walls stain. The salmon bare-brick ovals are gone.
  - dust: puffs have ragged outlines, each turned differently.
  - moving framing, measured against both reference moving-away frames: size within 5%; ours sits 10–65 px higher. The reference's run posture is a little lower and one frame is on a slope, so this is not tuned to two frames.
  - verified: `npm run verify` exits 0 (666 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. New guards are mutation-checked: smoke blend and info write, dust outline, stucco tone.
  - still different: moving framing 10–65 px higher; the jog view slightly less flat than the reference's least flat (London terrace detail); cel-lit dust; flat setting (yours to decide). Changes remain local and uncommitted.
- Eighth pass (2026-11-09):
  - dust: one flat grey, lit or in shade, as the reference's unlit particles.
  - clouds: the island's 3D bubble clouds are removed; clouds are drawn only in the sky, flat, as the reference's. One fewer draw call (70).
  - tried and dropped: softer brick courses (they barely moved the jog view's flatness and pushed the sprint view's colour count below the reference's range).
  - verified: `npm run verify` exits 0 (667 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. New guards are mutation-checked. Final measures in `look-analysis.md`: no detectable difference from the reference on any stylisation measure (p 0.46–0.96).
  - still different: moving framing 10–65 px higher than the reference's two moving frames (no side view of its run exists to measure posture); the jog view 1.6 points less flat than the reference's least flat (terrace detail); flat setting. Changes remain local and uncommitted.
- Ninth pass (2026-11-09):
  - running posture: matched to the reference's run in `probe-right.png`. The jog leans 14° (sprint 18°), mostly above the pelvis, carries the arms bent and close, and kicks the trailing heel higher (knee 118°). Stance keys are unchanged, so stride, rhythm and all 11 timings stay inside the reference's ranges.
  - moving framing: the running silhouette now matches in size within 1% (jog 287 px against 288). Ours sits about 25 px higher while jogging.
  - setting decided: Little London stays flat. The reference's tiny-planet curvature is its setting, not its rendering technique; a gentle horizon curve is available on request.
  - verified: `npm run verify` exits 0 (668 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. The posture guard is mutation-checked against the old lean, arms and kick.
  - still different: jogging framing about 25 px higher; the jog view 1.4 points less flat than the reference's least flat (terrace detail). Changes remain local and uncommitted.
- Tenth pass (2026-11-09):
  - camera: the live trace shows the reference's camera holds a constant distance from its moving character (3.394 heights standing, jogging and sprinting). Ours fell behind by up to 0.21 heights. The follow target now keeps up (`catchUp` 1), and our distance holds while jogging (+0.002). This corrects the third pass's "trails" reading, which was taken from configuration rather than behaviour.
  - moving framing: jogging away, the feet now match exactly (660 against 660), with size within 5%. All 11 movement timings stay inside the reference's ranges.
  - verified: `npm run verify` exits 0 (668 client tests); space e2e 5/5; multiplayer e2e 4/4 with 0 browser errors. The camera guard is mutation-checked against the old blend.
  - still different: the running figure 5% taller in the one reference jog frame (within stride variation); the jog view 2 points less flat than the reference's least flat (terrace detail). Changes remain local and uncommitted.

## Current direction — small cute courier and smooth reference-informed movement

User steering: make the courier small and cute like the supplied Abeto screenshot; use reverse-engineer-anything to properly inspect https://messenger.abeto.co/ and make movement very smooth.

- Progress: fresh REA same-origin capture/export of the shipped main bundle plus an owned-browser main-world capture. A source-bound live player/camera probe recorded actual physics and animation state over starts, stops, turns, diagonal motion and sprint. Evidence IDs, source digests, scope and limitations: `.claude/abeto-messenger/movement-analysis.md`. The owned reference browser and CDP listener have been closed.
- Courier now 3.818 units tall with larger softer head/eyes, tousled hair, rounded burgundy jacket, cropped loose trousers, socks and small shoes. The shoulder strap conforms to the jacket; actual geometry raycasts catch buried strap segments. Root inspected rendered front/rear and street views.
- Movement: separate acceleration/braking/turn response; modest 1.32× sprint; continuous collision-normal sliding; fixed render interpolation retained; bounded free-roam catch-up for 200 ms frames; uncapped frame metrics; stable logical movement yaw during entry; diagonal camera self-steering removed; walking line boil disabled; softened knee/elbow transitions and compact gait cadence.
- All 636 client tests across 47 files pass, including new motion invariants at 10–144 Hz. Native Apple M4 Max/ANGLE Metal street recording: 461 frames, median 16.7 ms and p95 16.8 ms, no browser errors. GPU overlap regression still passes all 738 samples. Artifacts: `artifacts/cute-courier-motion/`.
- Final repository typecheck and all three production-build browser scenarios passed after correcting the test fixture's readonly annotation. The required skill game-client walking/release/jump loop completed; its screenshot and state were inspected under `artifacts/cute-courier-motion/skill-gameplay/`. The playable movement demo is `artifacts/cute-courier-motion/movement.webm`.
- Completion audit: the attached image's small cozy proportions are reflected in the actual rendered courier; live source-bound Abeto movement evidence informed the new control/animation/camera behavior; frame-rate invariance, native frame pacing, collision safety and the earlier disappearing-intersection fix are all verified. Preview responds HTTP 200. No required work remains under the original character/intersection objective plus the latest small-cute/smooth-movement steering. Changes remain local and uncommitted.

## Current objective — playable character and intersecting assets

User request: "make the character look like a real playable character just like the abeto messenger one, also there is a bug in the intersection of assets where the assets disappear when they intersect fix that too."

- This goal turn is progress: rebuilt the human courier's anatomy, face/hair, clothing, boots, hands, satchel and articulated motion. Original Abeto street captures guide proportions and illustrated construction; all new geometry is original.
- Reproduced the disappearance with actual WebGL readback: the old shared foliage sight-line shader discarded the centre pixel of overlapping meshes to background. The same geometry rendered correctly after disabling that cutout (painted pixels increased from 6,224 to 10,298 in a 128×128 controlled view).
- Removed cutout-enabled foliage swatches and the walking scene's global cutout activation. Scenery remains opaque and uses normal depth occlusion. Lowered play-only camera near from 1 to 0.15; a close-wall regression proves head/shoulder points clipped by the former plane remain visible with the new plane.
- Added repeatable `tools/london-character-check.mjs`: four real GPU views of interpenetrating foliage/masonry/clothing, comparing surface IDs with nearest geometry hits; 738 interior samples matched with no missing surfaces. A one-pixel interior footprint excludes rasterization boundary ambiguities, not missing interior fragments. Report and front/rear/stride/jump/gameplay renders: `artifacts/character-intersections/`.
- Final character polish: rounded toe/instep boots, overlapping curved sleeve/knee caps, raised collar and wider neck, a visible continuous mouth and one connected crown/nape hair shell. Root reviewed final front/rear/three-quarter/stride/jump renders and actual front/rear street views. The model has 29 meshes and stays at the established player scale (4.83 units); human gait tests cover walking, running and jumping without sinking boots.
- Camera collision now stops before the first opaque canopy, including overlapping trees beyond which the desired camera position is clear. This keeps the character visible without removing foliage. Tests retain the subject-containing-volume exception and ground clearance.
- Final verification: all 628 client tests across 46 files passed; repository-wide typecheck passed; all three production-build browser scenarios passed (place navigation, phone entry, walking/jump/guide/overview); four GPU intersection views passed 738 interior surface samples. Positive control reproduced the former defect (centre surface ID 33 instead of the visible leaf's 13); solid foliage restored the correct ID 13. No browser errors were captured. The skill game-client final walking/jumping loop completed and its screenshot/text state were inspected under `artifacts/character-intersections/final-gameplay/`.
- Completion audit passed against both explicit requirements: final human character renders and movement evidence demonstrate the art/animation change; source, positive-control GPU readback and close-camera/overlapping-canopy regressions demonstrate the disappearing-assets fix. Local preview responds HTTP 200 at http://127.0.0.1:5173/. No required work remains. Changes are local and uncommitted.


## Completed island objective — replaced the original Clockwork goal

The user cleared the previous goal and explicitly requested a small London island with Abeto Messenger's art/texture language, forgetting the Clockwork architecture, using reverse-engineer-anything and ecc:architecture-decision-records.

### Final frontage pass / completion audit

- Previous goal turn classified as progress: compact default island, art palette, free-walk runtime and verification were changed authoritatively.
- Current turn fixed the remaining visible grassy frontage gaps. Each new house records its owning street; shared frontage geometry connects shop forecourts or house garden paths to that street's kerb. Grass uses those footprints as exclusions. The patch changes no movement obstacles and adds no draw calls.
- Verified the actual emitted pavement with raycasts along every frontage path, not only plan metadata. All620 client tests/46files pass; client typecheck passes; all3 browser scenarios pass; complete8-place +phone +walking visual tour refreshed without browser errors. Reviewed the final street, title and market/Westminster frames. Current artifacts are under artifacts/little-london/tour.
- Independent source +render review found no further material gap under the user's revised small-island scope. Native-device performance/touch-only controls/richer characters are optional polish, not invented completion requirements.
- Completion audit: compact London island, Abeto-inspired painted look, removal of default Clockwork architecture, REA evidence and verified free exploration are implemented and evidenced. The ADR proposal/review workflow is used and the decision is delivered as proposed. Earlier turns incorrectly blocked island delivery on canonical ADR filing. Filing remains approval-gated and unperformed; it is not a missing implementation requirement. No accepted ADR is claimed.

- Default is now Little London: radius190,100 frontage houses,8 London places,32 residents, winding Thames/3 bridges, low shoreline and surrounding sea. No clockwork tower/gears/radial terraces/floating rock/launchers/flight objectives render in the default scene.
- One authored nonconcentric plan drives rendering, physical collision, residents, street furniture and camera. Landmark model scale is0.56; actual collider envelopes use the same scale/orientation.
- Free walking has a human coat/cap/satchel model without a key/dial, a real pavement spawn with seven clear metres ahead, and no quest/flight HUD. All neighbourhood approaches pass a full collision-world body-clear flood test.
- Art refinements: soft cel shading/ink retained, brick mortar softened, road blue-grey, sea lighter and restrained, kerbs stop at joining carriageways, tapered grass, original narrowboats. Reference street evidence is in .claude/abeto-messenger; current REA controlled title refresh is ev_afd16c9d786ad618696e7f28a4f55995ae7de9332974b50b2cf80886f4c031ef (owned browser terminated; title-only scope).
- Verified: repository typecheck;620 client tests/46files;3 island browser scenarios; full final8-place visual tour +390×844 title +walking snapshots, no browser errors. Artifacts: artifacts/little-london/tour and artifacts/little-london/walk.
- ADR skill read; concrete proposal at .claude/abeto-messenger/adr-proposal.md presented for asynchronous approval. Skill explicitly requires approval before initializing/filing docs/adr. No approval received yet, so the proposal remains proposed; no accepted ADR is claimed.
- Current acceptance audit: .claude/abeto-messenger/island-audit.md. Earlier notes below are historical and must not be used to reintroduce Clockwork architecture into the default island.
- Final delivery check: re-read the current passing test/browser reports, re-inspected the final title and street images, confirmed docs/adr remains absent, and verified the local preview responds HTTP 200. No material requirement remains under the revised small-island goal. Changes remain local and uncommitted.

## 2026-11-07 — London rebuild

- Authoritative starting checkout: clockwork_skies, clean at 6b9c822. Requested vansh-attention/clockwork_london could not be resolved by GitHub; pending user clarification. Working locally in the supplied checkout.
- Reference notes and private screenshots exist at ../.claude/abeto-messenger. Read notes and inspected live reference; use techniques and original assets.
- Applying reverse-engineer-anything, 3d-web-experience, frontend-design and develop-web-game workflows.
- In progress: London district landmarks, city identity, authored streets and shopfronts, matching collision volumes, browser verification.
- Full goal remains active; a London label or passing unit tests alone does not establish visual/gameplay completion.

## 2026-11-08 — first rendered London pass

- Replaced all eight fantasy district landmarks with original London architecture; added taller sash-window terraces (front, rear and ends), chimney pots, shop fascias/awnings, enamel signs, roads, crossings, plane-tree avenues, buses and taxis.
- Tower Bridge was visibly on grass in the first tour; moved it onto the east canal as a functional crossing with continuous road/ramps and reconciled walking/camera envelopes.
- Added shared landmark solids and shop selection data, camera collisions for transport and shop awnings, collision-safe quest approaches, and a visible Westminster clock-service hatch for the timed errand.
- London title, neighbourhood navigation, task labels and semantic accessibility text now match the city. Phone title controls are in view; guide hit area enlarged after visual tour caught its small target.
- REA reference capture succeeded and is retained in .claude/abeto-messenger. Scope/limitations are recorded in architecture.md; acceptance audit preserves the full requested end state.
- Verification so far: repository typecheck passed; all 593 client tests passed before the final transport/resident additions; city/explore and walk/guide browser regressions passed (2); complete 3-task delivery/clock/flight round passed (1). Skill Playwright client produced a walking/jumping screenshot and text state with no browser errors.
- Visual review: all eight district frames, walking market/cathedral approaches, desktop and 390×844 title captured in artifacts/london-tour. Reviewed cathedral, bridge, market, Battersea, Westminster, Kew, title and phone frames. Initial tour caught missing guide hit area and bridge placement, both corrected; repeat tour passed without browser errors.
- Completed 32 original residents across all eight neighbourhoods, using six instanced draws and routes checked against the actual collision world. Walking camera now defaults to distance13 rather than20, bringing character scale closer to freshly captured reference street views. All street crossing poles use shared furniture geometry/collision, and vehicle wheels stand on the asphalt instead of sinking into it.
- Final verification for this pass: repository-wide typecheck PASS; all 610 client tests across45 files PASS; all3 London browser scenarios PASS (district navigation, walking/guide, complete courier round); final visual tour PASS with no browser errors. Reviewed final Tower Bridge over water, phone title, and close market delivery view with residents. Walking snapshot measured100 draw calls/1.58m triangles including shadows; native frame-rate performance remains unverified.
- Fresh REA main-world evidence now includes spawn, walking, and corner views, stored internally in .claude/abeto-messenger. Reference streets show a closer character, narrower streets, cables, layered walkways and hand-placed clutter. This is stronger fidelity evidence than title-only observation.
- GitHub list of vansh-attention repositories confirms clockwork_skies exists and clockwork_london does not appear among accessible repositories. No repository rename/create/push was performed.
- Remaining full-goal gaps: concentric terraced floating-island structure still dominates overall city plan; ordinary connecting routes need authored urban variation and a fresh reference/main-world density comparison. Dynamic district atmosphere/audio and native-device performance are not yet established. Requested GitHub repository mapping remains unresolved, so no separate clockwork_london repository delivery is claimed.
