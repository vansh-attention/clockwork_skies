import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PAINTS } from "@clockwork/content";
import type { GuestSession, InputCommand, MatchEvent, MatchState } from "@clockwork/shared";
import type { DebugView } from "@clockwork/render";
import { AudioDirector } from "./AudioDirector";
import { GameCanvas } from "./GameCanvas";
import { GameScene, type HudState } from "./GameScene";
import { InputController } from "./InputController";
import { LocalFlightConnection } from "./LocalFlightConnection";
import { GameConnection } from "./network";
import { LocalPredictor } from "./prediction";

type Profile = { callsign: string; paint: string; inviteCode: string };
const initialHud: HudState = { phase: "lobby", alive: 0, hull: 100, shield: 0, boost: 100, heat: 0, rockets: 2, speed: 0, altitude: 0, stormDistance: -1, status: "lobby", kills: 0, target: null };
function loadProfile(): Profile {
  const fallback = { callsign: "WINDUP", paint: PAINTS[0].id, inviteCode: "ALPHA-LOCAL" };
  try {
    const saved = JSON.parse(localStorage.getItem("clockwork-profile") ?? "{}");
    return { callsign: typeof saved.callsign === "string" ? saved.callsign.slice(0, 18) : fallback.callsign,
      paint: PAINTS.some((paint) => paint.id === saved.paint) ? saved.paint : fallback.paint,
      inviteCode: typeof saved.inviteCode === "string" ? saved.inviteCode : fallback.inviteCode };
  } catch { return fallback; }
}
function loadReducedMotion() {
  try { return localStorage.getItem("clockwork-reduced-motion") === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

export function LegacyOnlineGame({ offline = false }: { offline?: boolean } = {}) {
  const connection = useMemo(() => offline ? new LocalFlightConnection() : new GameConnection(), [offline]);
  const audio = useMemo(() => new AudioDirector(), []);
  const predictor = useMemo(() => new LocalPredictor(), []);
  const [profile, setProfile] = useState(loadProfile);
  const [session, setSession] = useState<GuestSession | null>(null);
  const [state, setState] = useState<MatchState | null>(null);
  const [event, setEvent] = useState<MatchEvent | null>(null);
  const [hud, setHud] = useState<HudState>(initialHud);
  const [status, setStatus] = useState("awaiting pilot");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [scene, setScene] = useState<GameScene | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(loadReducedMotion);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [debugView, setDebugView] = useState<DebugView>("final");
  const input = useRef<InputController | null>(null);
  const serverState = useRef<MatchState | null>(null);
  const eventTimer = useRef(0);
  const inputSequence = useRef(0);
  const settingsRef = useRef<HTMLElement>(null);
  const onHud = useCallback((next: HudState) => { setHud(next); audio.update(next); }, [audio]);
  const onSceneReady = useCallback((ready: GameScene) => setScene(ready), []);

  useEffect(() => connection.onStatus(setStatus), [connection]);
  useEffect(() => connection.onEvent((next) => {
    scene?.flash(next);
    if (next.type === "shot") { if (next.playerId === connection.sessionId) audio.event(next); return; }
    const relevant = !("playerId" in next) || next.playerId === connection.sessionId || next.type === "winner" || next.type === "destroyed";
    if (!relevant) return;
    setEvent(next); audio.event(next); window.clearTimeout(eventTimer.current);
    eventTimer.current = window.setTimeout(() => setEvent(null), 2400);
  }), [audio, connection, scene]);
  useEffect(() => connection.onState((next) => {
    serverState.current = next;
    const local = next.players[connection.sessionId];
    if (local?.status === "active") predictor.reconcile(local.aircraft);
    else predictor.reset();
    const predicted = predictor.value;
    const displayed = local && predicted ? { ...next, players: { ...next.players, [connection.sessionId]: { ...local, aircraft: structuredClone(predicted) } } } : next;
    scene?.setState(displayed);
    setState(next); // React follows snapshots, not every predicted input or rendered frame.
  }), [connection, predictor, scene]);

  useEffect(() => {
    if (!scene || !session || settingsOpen || state?.phase === "complete") return;
    const controller = new InputController(scene.canvas, {
      getRocketTarget: () => scene.rocketTargetId,
      initialSequence: inputSequence.current,
      onInput: (command: InputCommand) => {
        const current = serverState.current;
        if (!current || current.players[connection.sessionId]?.status !== "active") return;
        inputSequence.current = command.sequence;
        predictor.push(command); connection.sendInput(command);
        scene.setFlightInput(command);
        const predicted = predictor.value;
        const local = current.players[connection.sessionId];
        if (predicted && local) scene.setState({ ...current, players: { ...current.players, [connection.sessionId]: { ...local, aircraft: structuredClone(predicted) } } });
      },
    });
    controller.enable(); input.current = controller;
    return () => { controller.disable(); scene.setFlightInput(null); input.current = null; };
  }, [connection, predictor, scene, session, settingsOpen, state?.phase === "complete"]);

  useEffect(() => { scene?.setDebugView(debugView); }, [debugView, scene]);
  useEffect(() => { scene?.setReducedMotion(reducedMotion); }, [reducedMotion, scene]);
  useEffect(() => { scene?.setSoloPresentation(offline); }, [offline, scene]);
  useEffect(() => { if (offline && session && !settingsOpen) scene?.canvas.focus(); }, [offline, scene, session, settingsOpen]);
  useEffect(() => { audio.setMuted(muted); }, [audio, muted]);
  useEffect(() => {
    const changed = () => setLocked(document.pointerLockElement === scene?.canvas);
    document.addEventListener("pointerlockchange", changed);
    return () => document.removeEventListener("pointerlockchange", changed);
  }, [scene]);
  useEffect(() => {
    if (!settingsOpen) return;
    document.exitPointerLock?.(); settingsRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [settingsOpen]);
  useEffect(() => () => { input.current?.disable(); window.clearTimeout(eventTimer.current); audio.dispose(); void connection.leave(); }, [audio, connection]);

  const updateProfile = (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch }; setProfile(next);
    try { localStorage.setItem("clockwork-profile", JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
  };
  const launch = async () => {
    setJoining(true); setError(""); audio.unlock(); predictor.reset(); inputSequence.current = 0;
    try {
      const nextSession = await connection.createSession(profile.inviteCode, profile.callsign.trim());
      await connection.join(nextSession, profile.paint); setSession(nextSession);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The tower did not answer."); }
    finally { setJoining(false); }
  };
  const leave = async () => {
    input.current?.disable(); document.exitPointerLock?.();
    await connection.leave(); predictor.reset(); serverState.current = null; scene?.setState(null);
    setSession(null); setState(null); setHud(initialHud); setEvent(null); setSettingsOpen(false); audio.silence();
  };
  const playAgain = async () => { await leave(); await launch(); };
  const local = state?.players[connection.sessionId];
  const phaseSeconds = state ? Math.max(0, Math.ceil((state.phaseEndsAt - state.serverTime) / 1000)) : 0;
  const outsideStorm = local?.status === "active" && hud.stormDistance > 0;
  const winner = state?.winnerId ? state.players[state.winnerId] : null;
  const standings = Object.values(state?.players ?? {}).sort((a, b) => Number(b.id === state?.winnerId) - Number(a.id === state?.winnerId) || b.kills - a.kills);
  const openManual = () => { document.exitPointerLock?.(); setSettingsOpen(true); };

  return <main data-room-id={connection.roomId || undefined} data-player-id={connection.sessionId || undefined} data-phase={state?.phase ?? "title"} className={`app ${session ? "in-flight" : "at-title"} ${offline ? "solo-flight" : ""} ${outsideStorm ? "outside-storm" : ""} ${reducedMotion ? "reduced-motion" : ""}`}>
    <GameCanvas state={null} event={null} sessionId={connection.sessionId} onReady={onSceneReady} onHud={onHud} />
    {!session && <section className="title-screen" aria-labelledby="game-title">
      <div className="title-kicker"><span>{offline ? "SOLO FLIGHT / CLOCKWORK PRIME" : "LOCAL MULTIPLAYER / FLIGHT 01"}</span><i /></div>
      <h1 id="game-title"><span>CLOCKWORK</span><em>SKIES</em></h1>
      <p>{offline ? <>One tiny world. Your own flight.<br />Wind the engine and explore the skies.</> : <>Sixteen pilots. One tiny world.<br />Wind the engine. Outfly the storm.</>}</p>
      <form className="launch-card" onSubmit={(event) => { event.preventDefault(); void launch(); }}>
        <div className="form-heading"><span>PILOT MANIFEST</span><strong>01</strong></div>
        <label>CALLSIGN<input autoComplete="nickname" value={profile.callsign} maxLength={18} onChange={(event) => updateProfile({ callsign: event.target.value.toUpperCase() })} /></label>
        {!offline && <label>ROOM ACCESS CODE<input value={profile.inviteCode} onChange={(event) => updateProfile({ inviteCode: event.target.value.trim() })} /></label>}
        <fieldset><legend>AIRCRAFT PAINT</legend><div className="paint-row">{PAINTS.map((paint) => <button type="button" key={paint.id} className={profile.paint === paint.id ? "selected" : ""} onClick={() => updateProfile({ paint: paint.id })} aria-label={paint.name} aria-pressed={profile.paint === paint.id} title={paint.name} style={{ "--paint": paint.accent, "--paint-body": paint.body } as CSSProperties}><span /></button>)}</div></fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="launch" disabled={joining || profile.callsign.trim().length < 2 || (!offline && !profile.inviteCode)}>{joining ? (offline ? "STARTING ENGINE…" : "CONTACTING TOWER…") : "ENTER THE SKIES"}<span>↗</span></button>
        <small>{offline ? "Fly instantly in your browser. No room code or server needed." : "Open another browser or LAN device to join before takeoff. Empty seats become bots."}</small>
      </form>
      <button className="title-manual" onClick={openManual}>FLIGHT MANUAL <span>↗</span></button>
      <div className="title-footer"><span>ILLUSTRATED AERIAL ADVENTURE</span><span>{offline ? "SOLO EXPLORATION" : "16 PILOTS / ONE REDEPLOY"}</span></div>
    </section>}

    {session && <>
      <header className="flight-header">
        <div className="wordmark"><span className="mark">C</span><strong>CLOCKWORK SKIES</strong></div>
        <div className="phase"><span>{offline ? "FREE FLIGHT" : hud.phase.replaceAll("-", " ")}</span>{!offline && <b>{String(Math.floor(phaseSeconds / 60)).padStart(2, "0")}:{String(phaseSeconds % 60).padStart(2, "0")}</b>}</div>
        <button onClick={openManual} aria-expanded={settingsOpen}>FLIGHT MANUAL</button>
      </header>
      <aside className="left-instruments" aria-label="Aircraft instruments">
        <div className="instrument primary"><span>HULL</span><strong>{Math.round(hud.hull)}</strong><div className="meter"><i style={{ width: `${hud.hull}%` }} /></div></div>
        {!offline && <div className="instrument"><span>SHIELD</span><strong>{Math.round(hud.shield)}</strong></div>}
        <div className="instrument"><span>BOOST</span><strong>{Math.round(hud.boost)}</strong><div className="meter boost"><i style={{ width: `${hud.boost}%` }} /></div></div>
        {!offline && <div className="instrument"><span>CANNON HEAT</span><strong>{Math.round(hud.heat)}%</strong></div>}
      </aside>
      <aside className="right-instruments" aria-label={offline ? "Flight status" : "Match status"}>
        {!offline && <div className="counter"><strong>{hud.alive}</strong><span>PILOTS REMAIN</span></div>}
        {!offline && <><div><span>ROCKETS</span><strong>{hud.rockets}</strong></div><div><span>KILLS</span><strong>{hud.kills}</strong></div></>}
        <div><span>ALT</span><strong>{hud.altitude}<small>m</small></strong></div><div><span>SPEED</span><strong>{Math.round(hud.speed)}<small>m/s</small></strong></div>
        {!offline && <div><span>RESERVE</span><strong>{local?.redeploysRemaining ?? 1}</strong></div>}
      </aside>
      {local?.status === "active" && <>{!offline && <div className={`reticle ${hud.target ? "locked" : ""}`} style={{ left: `${hud.sightX ?? 50}%`, top: `${hud.sightY ?? 50}%` }} aria-hidden="true"><span /><i /><b>{hud.target ? "ROCKET LOCK" : "+"}</b></div>}
        <div className="storm-bearing" role="status">{offline ? "EXPLORE CLOCKWORK PRIME" : outsideStorm ? "⚠ RETURN TO THE SAFE SKY" : "SAFE AIRSPACE"}</div>
        {!locked && !settingsOpen && <button className="capture-hint" onClick={() => { scene?.canvas.focus(); void scene?.canvas.requestPointerLock?.()?.catch(() => {}); }}>CLICK TO FLY · ESC RELEASES MOUSE</button>}</>}
      <div className="connection-status"><i /> {status.toUpperCase()}</div>
      <div className="control-hint">{offline ? "MOUSE STEER · W/S THROTTLE · SPACE BOOST · ESC RELEASE" : "MOUSE AIM · LEFT FIRE · RIGHT ROCKET · W/S THROTTLE · SPACE BOOST · ESC RELEASE"}</div>
      {local?.status === "lobby" && <div className="center-message"><span>THE TOWER IS ASSEMBLING YOUR FLIGHT</span><strong>TAKEOFF IN {phaseSeconds}s</strong><p>{Object.values(state?.players ?? {}).filter((player) => !player.bot).length} human pilots aboard · bots fill the remaining seats</p></div>}
      {local?.status === "redeploying" && <div className="center-message" role="status"><span>EMERGENCY SPRING REWIND</span><strong>REDEPLOYING</strong><p>Your one reserve aircraft is winding up.</p></div>}
      {local?.status === "spectating" && state?.phase !== "complete" && <div className="center-message spectator"><span>FINAL AIRFRAME LOST</span><strong>SPECTATING</strong><p>Following the last pilots through the storm.</p><button onClick={() => scene?.cycleSpectator()}>NEXT PILOT →</button><button onClick={() => void playAgain()}>JOIN ANOTHER FLIGHT</button></div>}
      {state?.phase === "complete" && <section className="results" aria-labelledby="results-title">
        <span>FLIGHT COMPLETE</span><h2 id="results-title">{local?.status === "winner" ? "SKY CROWNED" : "UNTIL NEXT FLIGHT"}</h2>
        <p>{winner ? `${winner.callsign} is the last pilot aloft.` : "The clockwork sky has fallen silent."} Your kills: {local?.kills ?? 0}.</p>
        <ol>{standings.slice(0, 5).map((player) => <li key={player.id}><span>{player.id === state.winnerId ? "♛ " : ""}{player.callsign}{player.bot ? " · BOT" : ""}</span><b>{player.kills} kills</b></li>)}</ol>
        <button className="launch" disabled={joining} onClick={() => void playAgain()}>FLY AGAIN ↗</button><button onClick={() => void leave()}>BACK TO HANGAR</button>
      </section>}
      {event && event.type !== "shot" && <div className="event-toast" role="status">{event.type === "pickup" ? `${event.pickupType.toUpperCase()} COLLECTED` : event.type === "damage" ? "AIRFRAME HIT" : event.type.replaceAll("-", " ").toUpperCase()}</div>}
      <div className="sr-live" aria-live="polite">{offline ? `Solo flight, altitude ${hud.altitude} metres, speed ${Math.round(hud.speed)} metres per second.` : `${hud.phase}, ${hud.alive} pilots remain. ${local?.status}.`}</div>
    </>}
    {settingsOpen && <section className="settings" ref={settingsRef} tabIndex={-1} aria-label="Flight manual">
      <div><span>FLIGHT MANUAL / 01</span><button onClick={() => { setSettingsOpen(false); scene?.canvas.focus(); }} aria-label="Close flight manual">×</button></div>
      <h2>Keep your wings wound.</h2><p>{offline ? "Explore the illustrated globe at your own pace. Flying happens entirely in this browser." : "Stay inside the red storm boundary. Collect colored rings for repair (coral), rockets (gold), boost (green) and shield (violet). You have one automatic redeploy."}</p>
      <dl className="controls"><dt>Mouse</dt><dd>Steer the aircraft</dd>{!offline && <><dt>Left / right click</dt><dd>Cannon / locked rocket</dd></>}<dt>W / S</dt><dd>Throttle up / down</dd><dt>A / D</dt><dd>Fine bank</dd><dt>Space</dt><dd>Boost</dd>{!offline && <><dt>C</dt><dd>Rear view (hold)</dd><dt>Q / 1–4</dt><dd>Ping / emotes</dd></>}<dt>Esc</dt><dd>Release mouse / close manual</dd></dl>
      <label className="checkbox"><input type="checkbox" checked={reducedMotion} onChange={(event) => { setReducedMotion(event.target.checked); try { localStorage.setItem("clockwork-reduced-motion", String(event.target.checked)); } catch {} }} />REDUCED MOTION</label>
      <label className="checkbox"><input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />MUTE AUDIO</label>
      <details><summary>Illustration diagnostics</summary><label>RENDER CHANNEL<select value={debugView} onChange={(event) => setDebugView(event.target.value as DebugView)}><option value="final">Final illustrated view</option><option value="color">Color</option><option value="surface-id">Surface IDs</option><option value="depth">Depth</option><option value="normals">Normals</option><option value="mask">Contour mask</option></select></label></details>
      {session && <><p className="manual-note">{offline ? "Your solo flight is ready when you return." : "The match continues while this manual is open."}</p><button className="leave" onClick={() => void leave()}>BACK TO HANGAR</button></>}
    </section>}
  </main>;
}
