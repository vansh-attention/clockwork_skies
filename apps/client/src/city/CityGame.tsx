import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { DebugView } from "@clockwork/render";
import { CityScene, type CityMode, type Nudge } from "./CityScene";
import { formatClock } from "./clockwork";
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

  useEffect(() => {
    if (!mount.current) return;
    let owned: CityScene;
    try {
      owned = new CityScene(mount.current, { onPick: setFocused, onError: setError });
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
  useEffect(() => { scene.current?.setMode(mode); }, [mode]);
  useEffect(() => { if (guideOpen) guideRef.current?.focus(); }, [guideOpen]);

  const select = useCallback((index: number | null) => {
    setFocused(index);
    scene.current?.focusDistrict(index);
  }, []);
  const step = (delta: number) => select(((focused ?? 0) + delta + DISTRICTS.length) % DISTRICTS.length);
  const enter = () => {
    setGuideOpen(false);
    setFocused(null);
    setMode("explore");
    requestAnimationFrame(() => scene.current?.canvas.focus());
  };
  const backToTitle = () => { setGuideOpen(false); setFocused(null); setMode("title"); };
  const openGuide = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGuideOpen(true);
  };
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const typing = event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
      if (event.key === "Escape") {
        if (guideOpen) closeGuide();
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
  }, [closeGuide, focused, guideOpen, mode, select]);

  const district = focused === null ? null : DISTRICTS[focused] ?? null;
  const announcement = mode === "title" ? "" : district ? `Now viewing ${district.name}. ${districtLocation(district)}.` : "Viewing the whole town.";
  const setMotion = (value: boolean) => {
    setReducedMotion(value);
    try { localStorage.setItem("clockwork-reduced-motion", String(value)); } catch { /* Storage can be disabled. */ }
  };

  return <main className={`app city-app ${mode === "title" ? "at-title" : "exploring"} ${reducedMotion ? "reduced-motion" : ""}`}
    data-phase={mode} data-district={district?.id}>
    <div className="game-canvas" ref={mount} />

    {mode === "title" && <section className="title-screen" aria-labelledby="game-title">
      <div className="title-kicker"><span>HILL TOWN / CLOCKWORK PRIME</span><i /></div>
      <h1 id="game-title"><span>CLOCKWORK</span><em>SKIES</em></h1>
      <p>A hill town where every gear keeps the same time.<br />Look around its eight districts at your own pace.</p>
      <div className="launch-card city-card">
        <div className="form-heading"><span>TOWN CLOCK</span><strong className="city-time">{time}</strong></div>
        <p className="city-card-note">The tower shows your local time. Once a second, every gear in town moves one tick.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="launch" onClick={enter} disabled={!!error}>ENTER THE CITY<span aria-hidden="true">↗</span></button>
        <small>Drag to look around. Scroll to zoom.</small>
      </div>
      <button className="title-manual" onClick={openGuide} aria-expanded={guideOpen}>GUIDE <span aria-hidden="true">↗</span></button>
      <div className="title-footer"><span>ILLUSTRATED HILL TOWN</span><span>EIGHT DISTRICTS · ONE CLOCK</span></div>
    </section>}

    {mode === "explore" && <>
      <header className="flight-header city-header">
        <div className="wordmark"><span className="mark" aria-hidden="true">C</span><strong>CLOCKWORK SKIES</strong></div>
        <div className="phase"><span>{district ? district.name : "OVERVIEW"}</span><b>{time}</b></div>
        <button onClick={openGuide} aria-expanded={guideOpen}>GUIDE</button>
      </header>
      <nav className="district-panel" aria-label="Districts">
        <span className="district-panel-title">DISTRICTS</span>
        <ul>{DISTRICTS.map((item, index) => <li key={item.id}>
          <button aria-pressed={focused === index} onClick={() => select(index)} style={{ "--accent": item.accent } as CSSProperties}>
            <abbr title={item.compassWords}>{item.compass}</abbr>{" "}<span>{item.name}</span>
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

    <div className="sr-live" aria-live="polite">{announcement}</div>

    {guideOpen && <section className="settings city-guide" ref={guideRef} tabIndex={-1} aria-label="Guide">
      <div><span>GUIDE / HILL TOWN</span><button onClick={closeGuide} aria-label="Close guide">×</button></div>
      <h2>How to look around</h2>
      <p>The tower clock shows your local time. Once a second, every gear, windmill and wheel in town moves one tick together.</p>
      <dl className="controls">
        <dt>Drag / one finger</dt><dd>Look around</dd>
        <dt>Scroll / pinch</dt><dd>Zoom in and out</dd>
        <dt>Right-drag / two fingers</dt><dd>Slide the view</dd>
        <dt>← → ↑ ↓</dt><dd>Circle and tilt the view</dd>
        <dt>+ / −</dt><dd>Zoom with the keyboard</dd>
        <dt>Click a district</dt><dd>Fly to it</dd>
        <dt>Esc</dt><dd>Back to the whole town</dd>
      </dl>
      <label className="checkbox"><input type="checkbox" checked={reducedMotion} onChange={(event) => setMotion(event.target.checked)} />REDUCED MOTION</label>
      <details><summary>Illustration diagnostics</summary><label>RENDER CHANNEL<select value={debugView} onChange={(event) => setDebugView(event.target.value as DebugView)}>
        <option value="final">Final illustrated view</option><option value="color">Color</option><option value="surface-id">Surface IDs</option>
        <option value="depth">Depth</option><option value="normals">Normals</option><option value="mask">Contour mask</option>
      </select></label></details>
      {mode === "explore" && <button className="leave" onClick={backToTitle}>BACK TO TITLE</button>}
    </section>}
  </main>;
}
