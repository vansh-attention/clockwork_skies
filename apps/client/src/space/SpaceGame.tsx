import { useEffect, useRef, useState } from "react";
import { initialHUD, SpaceRuntime } from "./SpaceRuntime";
import type { HUD } from "./types";
import "./SpaceGame.css";
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function SpaceGame() {
  const mount = useRef<HTMLDivElement>(null), runtime = useRef<SpaceRuntime | null>(null);
  const [hud, setHUD] = useState<HUD>(initialHUD), [error, setError] = useState("");
  const [ready, setReady] = useState(false), [reduced, setReduced] = useState(prefersReducedMotion);
  const [muted, setMuted] = useState(false), [quality, setQuality] = useState<"medium" | "low">("medium");
  const [sensitivity, setSensitivity] = useState(0.002);
  useEffect(() => {
    if (!mount.current) return;
    let owned: SpaceRuntime;
    try { owned = new SpaceRuntime(mount.current, setHUD, setError); runtime.current = owned; setReady(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "WebGL initialization failed"); return; }
    return () => { owned.dispose(); if (runtime.current === owned) runtime.current = null; };
  }, []);
  const disabled = !ready || !!error || hud.busy, playing = hud.phase === "playing";
  const training = hud.mode === "training";
  return <main className={`space-root ${reduced ? "reduce" : ""} ${hud.flash ? "flash" : ""}`}
    data-phase={hud.phase} data-mode={hud.mode} aria-label="Clockwork Skies space flight">
    <div className="space-view" ref={mount} />
    <header className="space-top">
      <div><h1>Clockwork Skies</h1><p>THE DRIFT YARD · LOCAL FPP</p><strong>{hud.objective}</strong></div>
      <div>{playing && <button onClick={() => runtime.current?.pause()}>Pause</button>}<span>Esc pauses</span></div>
    </header>
    {playing && <>
      <div className="space-crosshair" aria-hidden="true">+</div>
      {hud.markerDistance > 0 && <div className="space-marker" style={{ left: `${hud.markerX}%`, top: `${hud.markerY}%` }}>
        <span aria-hidden="true" style={{ transform: hud.markerOffscreen ? `rotate(${hud.markerBearing}deg)` : undefined }}>{hud.markerOffscreen ? "▲" : "◇"}</span>
        <small>{hud.markerKind === "gate" ? `Gate ${hud.gate + 1}` : "Target"} · {Math.round(hud.markerDistance)} m{hud.markerBehind ? " (behind)" : ""}
          {hud.markerHull > 0 ? ` · ${Math.ceil(hud.markerHull)} hull` : ""}</small>
      </div>}
      {hud.warning && <div className="space-warning" role="status">RETURN TO THE YARD — outside sector damages hull</div>}
    </>}
    <footer className="space-bottom" aria-label="Flight instruments">
      <div className="space-instruments">
        <label>Hull <output data-testid="hull">{Math.ceil(hud.hull)}</output></label>
        <label>Heat <output data-testid="heat">{Math.round(hud.heat)}</output>{hud.heat > 84 && <small>Cooling</small>}</label>
        <label>Energy <output data-testid="energy">{Math.round(hud.energy)}</output></label>
      </div>
      <div className="space-caption" role="status" aria-live="polite" aria-atomic="true">{hud.notice}</div>
      <div className="space-instruments">
        <label>Speed <output data-testid="speed">{Math.round(hud.speed)}</output><small>m/s</small></label>
        <label>Rockets <output data-testid="rockets">{hud.rockets}</output></label>
        <label>Lock <output data-testid="lock">{Math.round(hud.lock * 100)}%</output></label>
      </div>
    </footer>
    {!playing && <section className="space-panel" aria-label="Flight menu">
      <h2>{hud.phase === "menu" ? "Choose your flight" : hud.phase === "paused" ? "Paused" : hud.phase === "won" ? "Flight complete" : "Ship lost"}</h2>
      {error && <p role="alert">{error} Try a WebGL-capable desktop browser. Multiplayer is not required.</p>}
      {hud.phase === "menu" ? <>
        <p>Training has five gates followed by stationary targets. Skirmish starts immediately with three drones.</p>
        <div className="space-actions">
          <button disabled={disabled} onClick={() => { void runtime.current?.launch("training"); }}>Launch training</button>
          <button disabled={disabled} onClick={() => { void runtime.current?.launch("skirmish"); }}>Launch skirmish</button>
          <button disabled={disabled} onClick={() => { void runtime.current?.launch("training", true); }}>Keyboard flight</button>
        </div>
      </> : <div className="space-actions">
        {hud.phase === "paused" && <>
          <button disabled={disabled} onClick={() => { void runtime.current?.resume(); }}>Resume mouse flight</button>
          <button disabled={disabled} onClick={() => { void runtime.current?.resume(true); }}>Resume keyboard flight</button>
        </>}
        <button disabled={disabled} onClick={() => { const rt = runtime.current; if (rt) void rt.launch(hud.mode, rt.input.keyboard); }}>Restart mission</button>
        <button disabled={disabled} onClick={() => runtime.current?.menu()}>Main menu</button>
      </div>}
      <p className="space-help">Mouse / arrows: turn · W/S: forward/reverse · A/D: strafe · R/F: vertical · Q/E: roll · Shift: boost · Space: brake · LMB/J: cannon · Hold RMB/K: rockets</p>
      <fieldset><legend>Flight settings</legend>
        <label>Graphics <select aria-label="Graphics" value={quality} onChange={e => {
          const value = e.currentTarget.value === "low" ? "low" : "medium"; setQuality(value); runtime.current?.quality(value);
        }}><option value="medium">Medium — native resolution</option><option value="low">Low — maximum 1280 × 720</option></select></label>
        <label>Mouse sensitivity <input aria-label="Mouse sensitivity" type="range" min="0.0005" max="0.006" step="0.0005" value={sensitivity}
          onChange={e => { const value = Number(e.currentTarget.value); setSensitivity(value); if (runtime.current) runtime.current.input.sensitivity = value; }} /></label>
        <label><input type="checkbox" checked={muted} onChange={e => { setMuted(e.currentTarget.checked); runtime.current?.mute(e.currentTarget.checked); }} />Mute sound</label>
        <label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.currentTarget.checked)} />Reduced motion</label>
      </fieldset>
    </section>}
    <div className="space-announcement" aria-live="polite" aria-atomic="true">{hud.phase === "won" ? "Flight complete" : hud.phase === "lost" ? "Ship lost. Restart available." : hud.phase === "paused" ? "Flight paused" : ""}</div>
  </main>;
}

