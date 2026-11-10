import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { DebugView } from "@clockwork/render";
import { CityScene, type CityMode, type Nudge } from "./CityScene";
import { formatClock } from "./clockwork";
import { CourierHud, playAnnouncement, shouldOpenGuideOnEsc } from "../courier/CourierHud";
import type { CourierHud as CourierHudData } from "../courier/CourierController";
import { DISTRICTS, districtLocation } from "./districts";
import "./city.css";

const KEY_NUDGES: Record<string, Nudge> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "in", "=": "in", "-": "out", _: "out",
};

function loadReducedMotion(): boolean {
  try {
    return localStorage.getItem("clockwork-reduced-motion") === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function CityGame() {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<CityScene | null>(null);
  const guideRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<CityMode>("title");
  const [focused, setFocused] = useState<number | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(loadReducedMotion);
  const [debugView, setDebugView] = useState<DebugView>("final");
  const [time, setTime] = useState(() => formatClock(new Date()));
  const [error, setError] = useState("");
  const [hud, setHud] = useState<CourierHudData | null>(null);
  const modeRef = useRef<CityMode>("title");
  const hudDone = hud?.task.done ?? false;
  /** While flying with the mouse captured, Esc frees the mouse instead of opening the guide. */
  const escOpensGuide = shouldOpenGuideOnEsc(mode, hud, guideOpen);

  useEffect(() => {
    if (!mount.current) return;
    let owned: CityScene;
    try {
      owned = new CityScene(mount.current, { onPick: setFocused, onError: setError, onCourierHud: (next) => { if (modeRef.current === "play") setHud(next); } });
      scene.current = owned;
    } catch {
      setError("This town needs WebGL2. Open it in a current desktop browser such as Chrome, Edge, Firefox or Safari.");
      return;
    }
    return () => { owned.dispose(); if (scene.current === owned) scene.current = null; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(formatClock(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { scene.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);
  useEffect(() => { scene.current?.setDebugView(debugView); }, [debugView]);
  useEffect(() => { modeRef.current = mode; if (mode !== "play") setHud(null); }, [mode]);
  useEffect(() => { scene.current?.setMode(mode); }, [mode]);
  useEffect(() => { scene.current?.setCourierSuspended(mode === "play" && (guideOpen || hudDone)); }, [mode, guideOpen, hudDone]);
  useEffect(() => { if (guideOpen) guideRef.current?.focus(); }, [guideOpen]);

  const select = useCallback((index: number | null) => {
    setFocused(index);
    scene.current?.focusDistrict(index);
  }, []);
  const step = (delta: number) => select(((focused ?? 0) + delta + DISTRICTS.length) % DISTRICTS.length);
  const enter = () => {
    setGuideOpen(false);
    setFocused(null);
    setHud(null);
    setMode("explore");
    requestAnimationFrame(() => scene.current?.canvas.focus());
  };
  const startRound = () => {
    setGuideOpen(false);
    setFocused(null);
    setHud(null);
    setMode("play");
    requestAnimationFrame(() => scene.current?.canvas.focus());
  };
  const restartRound = () => {
    setHud(null);
    scene.current?.restartRound();
    // The START AGAIN button goes with the card: give the walk keys (and Space) back to the town at once.
    requestAnimationFrame(() => scene.current?.canvas.focus());
  };
  const backToTitle = () => { setGuideOpen(false); setFocused(null); setHud(null); setMode("title"); };
  const openGuide = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGuideOpen(true);
  }, []);
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    const target = returnFocus.current;
    // While playing, the canvas takes the walk and flight keys; handing focus back to the GUIDE button would leave
    // WASD and E dead until the player clicked the town.
    if (modeRef.current === "play") scene.current?.canvas.focus();
    else if (target?.isConnected) target.focus();
  }, []);
  /** Keeps Tab inside the open guide. */
  const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const panel = event.currentTarget;
    const items = [...panel.querySelectorAll<HTMLElement>("button, input, select, summary")]
      .filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const typing = event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
      if (event.key === "Escape") {
        if (event.repeat) return;
        if (guideOpen) closeGuide();
        else if (mode === "play") { if (escOpensGuide) { event.preventDefault(); openGuide(); } }
        else if (mode === "explore" && focused !== null) { event.preventDefault(); select(null); }
        return;
      }
      if (typing || guideOpen || mode !== "explore") return;
      const nudge = KEY_NUDGES[event.key];
      if (!nudge) return;
      event.preventDefault();
      scene.current?.nudge(nudge);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeGuide, escOpensGuide, focused, guideOpen, mode, openGuide, select]);

  const district = focused === null ? null : DISTRICTS[focused] ?? null;
  const announcement = mode === "title" ? "" : mode === "play"
    ? "Walking around Little Islands. WASD to move, drag to look, Escape for the guide."
    : district ? `Now viewing ${district.name}. ${districtLocation(district)}.` : "Viewing the whole town.";
  const setMotion = (value: boolean) => {
    setReducedMotion(value);
    try { localStorage.setItem("clockwork-reduced-motion", String(value)); } catch { /* Storage can be disabled. */ }
  };

  return <main className={`app city-app ${mode === "title" ? "at-title" : "exploring"} ${reducedMotion ? "reduced-motion" : ""}`}
    data-phase={mode} data-district={district?.id}>
    <div className="game-canvas" ref={mount} />

    {mode === "title" && <section className="title-screen" aria-labelledby="game-title">
      <div className="title-kicker"><span>A SMALL ISLAND. A LITTLE ESCAPE.</span><i /></div>
      <h1 id="game-title"><span>LITTLE</span><em>ISLANDS</em></h1>
      <p>Brick lanes, corner shops and a river by the sea.<br />A painted little island, yours to wander.</p>
      <div className="launch-card city-card">
        <div className="form-heading"><span>COME ON IN</span><strong className="city-time">↗</strong></div>
        <p className="city-card-note">A little city of familiar places.<br />No hurry. Just follow the next street.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="launch" onClick={startRound} disabled={!!error}>TAKE A WALK<span aria-hidden="true">↗</span></button>
        <button className="look-around" onClick={enter} disabled={!!error}>VIEW THE ISLAND</button>
        <small>WASD to walk · Drag to look · Scroll to zoom</small>
      </div>
      <button className="title-manual" onClick={openGuide} aria-expanded={guideOpen}>GUIDE <span aria-hidden="true">↗</span></button>
      <div className="title-footer"><span>POSTCARDS FROM A LITTLE ISLAND</span><span>A PAINTED LONDON BY THE SEA</span></div>
    </section>}

    {mode === "explore" && <>
      <header className="flight-header city-header">
        <div className="wordmark"><span className="mark" aria-hidden="true">L</span><strong>LITTLE ISLANDS</strong></div>
        <div className="phase"><span>{district ? district.name : "OVERVIEW"}</span><b>{time}</b></div>
        <button onClick={openGuide} aria-expanded={guideOpen}>GUIDE</button>
      </header>
      <nav className="district-panel" aria-label="Districts">
        <span className="district-panel-title">AROUND LONDON</span>
        <ul>{DISTRICTS.map((item, index) => <li key={item.id}>
          <button aria-pressed={focused === index} onClick={() => select(index)} style={{ "--accent": item.accent } as CSSProperties}>
            <abbr title="Neighbourhood">{String(index + 1).padStart(2, "0")}</abbr>{" "}<span>{item.name}</span>
          </button>
        </li>)}</ul>
      </nav>
      {district && <section className="district-card" aria-labelledby="district-title" style={{ "--accent": district.accent } as CSSProperties}>
        <span>{districtLocation(district)}</span>
        <h2 id="district-title">{district.name}</h2>
        <p>{district.description}</p>
        <div className="district-actions">
          <button onClick={() => step(-1)}>← PREVIOUS</button>
          <button onClick={() => step(1)}>NEXT →</button>
          <button className="district-back" onClick={() => select(null)}>BACK TO OVERVIEW</button>
        </div>
      </section>}
      {error && <p className="center-message city-error" role="alert">{error}</p>}
      <div className="control-hint">DRAG TO LOOK · SCROLL TO ZOOM · ← → CIRCLE · ESC OVERVIEW</div>
    </>}

    {mode === "play" && hud && <CourierHud roam hud={hud} time={time} guideOpen={guideOpen} onGuide={openGuide} onRestart={restartRound} onLookAround={enter} />}
    {mode === "play" && error && <p className="center-message city-error" role="alert">{error}</p>}

    <div className="sr-live" aria-live="polite">{announcement}</div>

    {guideOpen && <section className="settings city-guide" ref={guideRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Guide" onKeyDown={trapTab}>
      <div><span>A POCKET GUIDE TO LONDON</span><button onClick={closeGuide} aria-label="Close guide">×</button></div>
      <h2>{mode === "play" ? "Take a walk" : "How to look around"}</h2>
      <p>Follow the brick lanes, cross the river and find a quiet garden square. You can wander at your own pace or view the whole island from above.</p>
      {mode === "play" ? <dl className="controls">
        <dt>W A S D</dt><dd>Walk</dd>
        <dt>Shift</dt><dd>Run</dd>
        <dt>Space</dt><dd>Jump (onto kerbs, steps and low walls)</dd>
        <dt>Drag</dt><dd>Look around</dd>
        <dt>Scroll</dt><dd>Zoom</dd>
        <dt>Esc</dt><dd>Open or close this guide</dd>
      </dl> : <dl className="controls">
        <dt>Drag / one finger</dt><dd>Look around</dd>
        <dt>Scroll / pinch</dt><dd>Zoom in and out</dd>
        <dt>Right-drag / two fingers</dt><dd>Slide the view</dd>
        <dt>← → ↑ ↓</dt><dd>Circle and tilt the view</dd>
        <dt>+ / −</dt><dd>Zoom with the keyboard</dd>
        <dt>Click a district</dt><dd>Fly to it</dd>
        <dt>Esc</dt><dd>Back to the whole town</dd>
      </dl>}
      <label className="checkbox"><input type="checkbox" checked={reducedMotion} onChange={(event) => setMotion(event.target.checked)} />REDUCED MOTION</label>
      <details><summary>Illustration diagnostics</summary><label>RENDER CHANNEL<select value={debugView} onChange={(event) => setDebugView(event.target.value as DebugView)}>
        <option value="final">Final illustrated view</option><option value="color">Color</option><option value="surface-id">Surface IDs</option>
        <option value="depth">Depth</option><option value="normals">Normals</option><option value="mask">Contour mask</option>
      </select></label></details>
      {mode !== "title" && <button className="leave" onClick={backToTitle}>BACK TO TITLE</button>}
    </section>}
  </main>;
}
