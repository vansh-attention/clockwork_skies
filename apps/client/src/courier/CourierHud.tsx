import { useEffect, useRef } from "react";
import { MATCH_RULES } from "@clockwork/shared";
import type { CityMode } from "../city/CityScene";
import type { CourierHud as CourierHudData } from "./CourierController";
import { TASKS, TICK_HITS_NEEDED } from "./tasks";
import "./courier.css";

export type CourierHudProps = {
  hud: CourierHudData;
  /** Town clock text shown in the header pill. */
  time: string;
  guideOpen?: boolean;
  onGuide: () => void;
  onRestart: () => void;
  onLookAround: () => void;
};

/** Milliseconds as m:ss (minutes are not capped). Bad input reads as 0:00. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Keeps a marker coordinate (a percentage) inside the screen; a non-finite value falls back to the middle. */
export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(96, Math.max(4, value)) : 50;
}

/** A readout number rounded to a whole value; anything non-finite reads as 0. */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/** The speed readout turns to a warning when the plane is too fast and the gate is this close (metres). */
const WARN_GATE_DISTANCE = 400;

/**
 * Whether Esc should open the guide. While flying with the mouse captured, Esc frees the mouse instead; a second Esc
 * (mouse already free) opens the guide. Never behind the round complete card or an already open guide.
 */
export function shouldOpenGuideOnEsc(mode: CityMode, hud: CourierHudData | null, guideOpen: boolean): boolean {
  if (mode !== "play" || guideOpen) return false;
  if (hud?.task.done) return false;
  return !(hud?.mode === "fly" && hud.flight?.pointerLocked);
}

/** The sr-live text for play mode. */
export function playAnnouncement(hud: CourierHudData | null): string {
  if (!hud) return "Round started.";
  return hud.task.done ? "Round complete." : `${hud.task.title}. ${hud.task.stepLabel}`;
}

/** Splits "E · Pick up parcel" into a key cap and its action. */
export function splitPrompt(prompt: string): { key: string | null; action: string } {
  const [key, ...rest] = prompt.split(" · ");
  return rest.length > 0 && key ? { key, action: rest.join(" · ") } : { key: null, action: prompt };
}

/**
 * A mouse press on a play-HUD button must not take keyboard focus from the town, or Space (jump) and the walk keys
 * would go to the button instead of the courier. The click still fires; Tab still reaches the buttons.
 */
export const keepTownFocus = (event: { preventDefault(): void }): void => event.preventDefault();

export function CourierHud({ hud, time, guideOpen = false, onGuide, onRestart, onLookAround }: CourierHudProps) {
  const { task, marker, feedback } = hud;
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (task.done) againRef.current?.focus(); }, [task.done]);
  const currentKind = TASKS[task.taskIndex]?.steps[task.stepIndex]?.kind;
  const markerX = clampPercent(marker.x);
  const markerY = clampPercent(marker.y);
  const bearing = Number.isFinite(marker.bearing) ? marker.bearing : 0;
  const flight = hud.mode === "fly" && !task.done ? hud.flight : null;
  const capacity = MATCH_RULES.aircraft.boostCapacity;
  const boostPercent = flight && capacity > 0 && Number.isFinite(flight.boost) ? Math.min(100, Math.max(0, flight.boost / capacity * 100)) : 0;
  const shownSpeed = flight ? (flight.tooFast && Number.isFinite(flight.speed) ? Math.ceil(flight.speed) : whole(flight.speed)) : 0;
  const easeOff = !!flight && flight.tooFast && flight.gateDistance <= WARN_GATE_DISTANCE;
  const prompt = hud.prompt ? splitPrompt(hud.prompt) : null;
  const distance = Number.isFinite(marker.distance) ? Math.round(marker.distance) : 0;

  return <>
    <header className="flight-header city-header courier-header">
      <div className="wordmark"><span className="mark" aria-hidden="true">C</span><strong>CLOCKWORK SKIES</strong></div>
      <div className="phase"><span>{task.title}</span><b>{time}</b></div>
      <button onMouseDown={keepTownFocus} onClick={onGuide} aria-expanded={guideOpen}>GUIDE</button>
    </header>

    <div className="courier-stack">
    {!task.done && <section className="courier-panel" aria-label="Current task">
      <span className="courier-eyebrow">TASK {Math.min(task.taskIndex + 1, TASKS.length)} OF {TASKS.length}</span>
      <h2>{task.title}</h2>
      <ol>
        {task.checklist.map((item, index) => {
          const state = item.done ? "done" : item.current ? "current" : "todo";
          const counting = item.current && currentKind === "tick";
          return <li key={`${index}-${item.label}`} className={state} aria-current={item.current ? "step" : undefined}>
            {item.label}
            {counting && <b className="courier-ticks"> {task.tickHits}/{TICK_HITS_NEEDED}</b>}
          </li>;
        })}
      </ol>
    </section>}

    {flight && <>
      <aside className="left-instruments courier-instruments" aria-label="Flight instruments">
        <div className={`instrument primary${easeOff ? " too-fast" : ""}`}>
          <span>SPEED</span><strong>{shownSpeed}</strong>
          <small className="courier-unit">m/s</small>
          <small className="courier-landing">{easeOff ? "EASE THE THROTTLE (S)" : `LAND ≤ ${whole(flight.landingSpeed)}`}</small>
        </div>
        <div className="instrument">
          <span>BOOST</span><strong>{whole(flight.boost)}</strong>
          {flight.boostLocked && <small className="courier-landing">RECHARGING</small>}
          <div className="meter boost"><i style={{ width: `${boostPercent}%` }} /></div>
        </div>
        {/* Phone width only: the right panel is hidden there, so these cells carry altitude and gate. */}
        <div className="instrument courier-extra"><span>ALTITUDE</span><strong>{whole(flight.altitude)}</strong></div>
        <div className="instrument courier-extra"><span>GATE</span><strong>{whole(flight.gateDistance)}</strong></div>
      </aside>
    </>}
    </div>
    {flight && <aside className="right-instruments courier-instruments" aria-label="Flight position">
      <div><span>ALTITUDE</span><strong>{whole(flight.altitude)}<small>m</small></strong></div>
      <div><span>GATE</span><strong>{whole(flight.gateDistance)}<small>m</small></strong></div>
    </aside>}

    {marker.visible && !task.done && <div className={`courier-marker${marker.offscreen ? " offscreen" : ""}${markerY > 90 ? " flip" : ""}`} aria-hidden="true"
      style={{ left: `${markerX}%`, top: `${markerY}%` }}>
      <i style={marker.offscreen ? { transform: `rotate(${bearing}deg)` } : undefined} />
      <span>{distance} m</span>
    </div>}

    <p className={`courier-toast${feedback ? ` tone-${feedback.tone}` : ""}`} role="status">{feedback?.text}</p>

    {prompt && !task.done && <div className="courier-prompt">
      {prompt.key && <kbd>{prompt.key}</kbd>}<span>{prompt.action}</span>
    </div>}

    {flight?.turningBack && <p className="courier-toast tone-info courier-turnback">TURNING BACK TOWARD THE ISLANDS</p>}
    {flight && !flight.pointerLocked && <div className="capture-hint courier-steer">CLICK TO STEER · ESC RELEASES MOUSE</div>}

    <div className="control-hint courier-hint">{hud.mode === "fly"
      ? "MOUSE STEER · W/S THROTTLE · SPACE BOOST · A/D BANK · ESC FREES MOUSE"
      : "WASD MOVE · SHIFT RUN · SPACE JUMP · E ACT · DRAG LOOK · ESC GUIDE"}</div>

    {task.done && <section className="district-card courier-complete" aria-labelledby="round-title">
      <h2 id="round-title">ROUND COMPLETE</h2>
      <span className="courier-time">{formatElapsed(task.elapsedMs)}</span>
      <ul>{TASKS.map((item) => <li key={item.id} className="done">{item.title}</li>)}</ul>
      <div className="district-actions">
        <button className="courier-again" ref={againRef} onMouseDown={keepTownFocus} onClick={onRestart}>START AGAIN</button>
        <button onMouseDown={keepTownFocus} onClick={onLookAround}>LOOK AROUND</button>
      </div>
    </section>}
  </>;
}
