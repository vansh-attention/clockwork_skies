import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CourierHud as CourierHudData, FlightHud } from "./CourierController";
import { CourierHud, clampPercent, formatElapsed, keepTownFocus, playAnnouncement, shouldOpenGuideOnEsc, splitPrompt } from "./CourierHud";

const noop = () => {};

function makeHud(patch: Partial<CourierHudData> = {}, task: Partial<CourierHudData["task"]> = {}): CourierHudData {
  return {
    mode: "walk",
    task: {
      taskIndex: 0, stepIndex: 1, taskId: "market-parcel", title: "Market parcel",
      stepLabel: "Deliver it to St Paul's", prompt: "E · Deliver parcel",
      target: "observatory-door", targetPosition: { x: 0, y: 0, z: 0 }, tickHits: 0, done: false, elapsedMs: 0,
      checklist: [
        { label: "Pick up the parcel at Covent Garden", done: true, current: false },
        { label: "Deliver it to St Paul's", done: false, current: true },
        { label: "Walk home", done: false, current: false },
      ],
      ...task,
    },
    marker: { visible: false, x: 50, y: 50, offscreen: false, bearing: 0, distance: 0 },
    feedback: null,
    prompt: "E · Deliver parcel",
    flight: null,
    ...patch,
  };
}

const flight = (patch: Partial<FlightHud> = {}): FlightHud => ({
  speed: 62.4, altitude: 187.6, boost: 40, boostLocked: false, gateDistance: 812.3, landingSpeed: 45,
  tooFast: false, pointerLocked: true, turningBack: false, ...patch,
});
const flying = (patch: Partial<FlightHud> = {}, rest: Partial<CourierHudData> = {}) => makeHud({ mode: "fly", flight: flight(patch), ...rest });

const render = (hud: CourierHudData) =>
  renderToStaticMarkup(<CourierHud hud={hud} time="10:42:07" onGuide={noop} onRestart={noop} onLookAround={noop} />);

describe("CourierHud", () => {
  it("shows the task title, task count, clock, checklist states and prompt", () => {
    const html = render(makeHud());
    expect(html).toContain("Market parcel");
    expect(html).toContain("TASK 1 OF 3");
    expect(html).toContain("10:42:07");
    expect(html).toContain("GUIDE");
    expect(html).not.toContain('aria-live');
    expect(html).toMatch(/class="[^"]*\bdone\b[^"]*"[^>]*>(?:<[^>]+>)*Pick up the parcel/);
    expect(html).toMatch(/aria-current="step"[^>]*>(?:<[^>]+>)*Deliver it to St Paul&#x27;s/);
    expect(html).toContain("Walk home");
    expect(html).toContain("<kbd>E</kbd>");
    expect(html).toContain("Deliver parcel");
  });

  it("renders no prompt when the task has none", () => {
    expect(render(makeHud({ prompt: null }))).not.toContain("courier-prompt");
  });

  it("takes the prompt from hud.prompt, not the task", () => {
    const html = render(makeHud({ prompt: "E · Fly to Lanternfall" }, { prompt: "E · Deliver parcel" }));
    expect(html).toContain("Fly to Lanternfall");
    expect(html).not.toContain("Deliver parcel");
    expect(render(makeHud({ prompt: null }, { prompt: "E · Deliver parcel" }))).not.toContain("courier-prompt");
  });

  it("numbers the task from taskIndex", () => {
    expect(render(makeHud({}, { taskIndex: 2 }))).toContain("TASK 3 OF 3");
  });

  it("renders the marker only when visible, with its distance", () => {
    expect(render(makeHud())).not.toContain("courier-marker");
    const on = render(makeHud({ marker: { visible: true, x: 30, y: 40, offscreen: false, bearing: 0, distance: 128.4 } }));
    expect(on).toContain("courier-marker");
    expect(on).toContain("left:30%");
    expect(on).toContain("top:40%");
    expect(on).toContain("128 m");
    expect(on).toContain('aria-hidden="true"');
    expect(on).not.toContain("offscreen");
  });

  it("turns an offscreen marker into an arrow rotated by its bearing", () => {
    const html = render(makeHud({ marker: { visible: true, x: 95, y: 50, offscreen: true, bearing: 90, distance: 40 } }));
    expect(html).toContain("offscreen");
    expect(html).toContain("rotate(90deg)");
  });

  it("renders feedback with its tone class and a status role", () => {
    const html = render(makeHud({ feedback: { text: "Too fast", tone: "warn" } }));
    expect(html).toContain('role="status"');
    expect(html).toContain("tone-warn");
    expect(html).toContain("Too fast");
    const quiet = render(makeHud());
    expect(quiet).toContain('role="status"');
    expect(quiet).not.toContain("tone-");
  });

  it("keeps the toast clear of other tones when empty and marks the card dialog parts", () => {
    const html = render(makeHud({ feedback: { text: "Nice", tone: "good" } }));
    expect(html).toContain("tone-good");
    expect(html).not.toContain("tone-warn");
  });

  it("shows the tick count on the current tick step only", () => {
    const tick = makeHud({}, {
      taskIndex: 1, stepIndex: 0, taskId: "oil-escapement", tickHits: 2,
      checklist: [{ label: "Oil the Westminster clock", done: false, current: true }],
    });
    expect(render(tick)).toContain("2/3");
    expect(render(makeHud())).not.toContain("0/3");
    const notTick = makeHud({}, { taskIndex: 0, stepIndex: 1, tickHits: 2 });
    expect(render(notTick)).not.toContain("2/3");
  });

  it("hides the panel, marker and prompt once the round is done", () => {
    const html = render(makeHud({ marker: { visible: true, x: 30, y: 40, offscreen: false, bearing: 0, distance: 9 } },
      { done: true, elapsedMs: 1000, checklist: [] }));
    expect(html).not.toContain("courier-panel");
    expect(html).not.toContain("courier-marker");
    expect(html).not.toContain("courier-prompt");
  });

  it("labels the complete card by its heading", () => {
    const html = render(makeHud({}, { done: true, elapsedMs: 61_000, checklist: [] }));
    expect(html).toMatch(/aria-labelledby="round-title"/);
    expect(html).toMatch(/id="round-title"[^>]*>ROUND COMPLETE/);
  });

  it("reflects the guide state on the GUIDE button", () => {
    const html = renderToStaticMarkup(<CourierHud hud={makeHud()} time="1" guideOpen onGuide={noop} onRestart={noop} onLookAround={noop} />);
    expect(html).toContain('aria-expanded="true"');
  });

  it("clamps the marker inside the screen and flips its label near the bottom", () => {
    const low = render(makeHud({ marker: { visible: true, x: 150, y: 97, offscreen: false, bearing: 0, distance: 5 } }));
    expect(low).toContain("left:96%");
    expect(low).toContain("top:96%");
    expect(low).toContain("flip");
    const nan = render(makeHud({ marker: { visible: true, x: Number.NaN, y: -20, offscreen: true, bearing: Number.NaN, distance: Number.NaN } }));
    expect(nan).toContain("left:50%");
    expect(nan).toContain("top:4%");
    expect(nan).toContain("rotate(0deg)");
    expect(nan).toContain("0 m");
  });

  it("lists the controls for the current mode", () => {
    expect(render(makeHud())).toContain("WASD MOVE · SHIFT RUN · SPACE JUMP · E ACT · DRAG LOOK · ESC GUIDE");
    expect(render(makeHud())).not.toContain("MOUSE STEER");
    const air = render(flying());
    expect(air).toContain("MOUSE STEER · W/S THROTTLE · SPACE BOOST · A/D BANK · ESC FREES MOUSE");
    expect(air).not.toContain("WASD MOVE");
  });

  it("shows no flight instruments while walking, even if flight data is present", () => {
    for (const html of [render(makeHud()), render(makeHud({ flight: flight() }))]) {
      expect(html).not.toContain("left-instruments");
      expect(html).not.toContain("right-instruments");
      expect(html).not.toContain("CLICK TO STEER");
    }
  });

  it("shows no flight instruments in fly mode without flight data", () => {
    expect(render(makeHud({ mode: "fly" }))).not.toContain("left-instruments");
  });

  it("shows speed, boost, altitude and gate distance in the air, with the task panel still visible", () => {
    const html = render(flying());
    expect(html).toContain("left-instruments");
    expect(html).toContain("right-instruments");
    expect(html).toContain("SPEED");
    expect(html).toContain("<strong>62</strong>");
    expect(html).toContain("LAND ≤ 45");
    expect(html).toContain("BOOST");
    expect(html).toContain("width:40%");
    expect(html).toContain("ALTITUDE");
    expect(html).toContain("188");
    expect(html).toContain("GATE");
    expect(html).toContain("812");
    expect(html).toContain("courier-panel");
    expect(html).not.toContain("RECHARGING");
    expect(html).not.toContain("EASE THE THROTTLE");
  });

  it("warns to ease the throttle only when too fast and the gate is near", () => {
    const near = render(flying({ tooFast: true, gateDistance: 380 }));
    expect(near).toContain("EASE THE THROTTLE (S)");
    expect(near).toContain("too-fast");
    expect(near).not.toContain("LAND ≤");
    const far = render(flying({ tooFast: true, gateDistance: 900 }));
    expect(far).not.toContain("EASE THE THROTTLE");
    expect(far).not.toContain("too-fast");
    expect(render(flying({ tooFast: false, gateDistance: 100 }))).not.toContain("EASE THE THROTTLE");
  });

  it("labels a locked boost as recharging and keeps the meter in range", () => {
    expect(render(flying({ boostLocked: true, boost: 3 }))).toContain("RECHARGING");
    expect(render(flying({ boost: 250 }))).toContain("width:100%");
    expect(render(flying({ boost: Number.NaN }))).toContain("width:0%");
  });

  it("asks for a click to steer only while the pointer is free", () => {
    expect(render(flying({ pointerLocked: false }))).toContain("CLICK TO STEER · ESC RELEASES MOUSE");
    expect(render(flying({ pointerLocked: true }))).not.toContain("CLICK TO STEER");
  });

  it("uses the 400 m gate distance as the inclusive warning boundary", () => {
    expect(render(flying({ tooFast: true, gateDistance: 400 }))).toContain("EASE THE THROTTLE");
    expect(render(flying({ tooFast: true, gateDistance: 401 }))).not.toContain("EASE THE THROTTLE");
  });

  it("rounds a too-fast speed up so 45.4 does not read as the landing limit", () => {
    expect(render(flying({ tooFast: true, speed: 45.4, gateDistance: 10 }))).toContain("<strong>46</strong>");
    expect(render(flying({ tooFast: false, speed: 44.6 }))).toContain("<strong>45</strong>");
  });

  it("reads non-finite flight numbers as 0", () => {
    const html = render(flying({ speed: Number.NaN, altitude: Infinity, gateDistance: -Infinity, boost: Number.NaN, landingSpeed: Number.NaN }));
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("<strong>0</strong>");
    expect(html).toContain("LAND ≤ 0");
  });

  it("labels both instrument panels", () => {
    const html = render(flying());
    expect(html).toContain('aria-label="Flight instruments"');
    expect(html).toContain('aria-label="Flight position"');
  });

  it("renders the right panel as a sibling after the task stack closes", () => {
    expect(render(flying())).toMatch(/<\/div><aside class="right-instruments courier-instruments"/);
  });

  it("scales the boost meter by capacity", () => {
    expect(render(flying({ boost: 50 }))).toContain("width:50%");
    expect(render(flying({ boost: 25 }))).toContain("width:25%");
  });

  it("gives the turn-back strip no status role, leaving the one toast region", () => {
    const html = render(flying({ turningBack: true }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/<p class="courier-toast tone-info courier-turnback">/);
  });

  it("announces turning back as an info strip", () => {
    const html = render(flying({ turningBack: true }));
    expect(html).toContain("TURNING BACK TOWARD THE ISLANDS");
    expect(html).toContain("tone-info");
    expect(render(flying())).not.toContain("TURNING BACK");
  });

  it("drops the flight instruments once the round is done", () => {
    const html = render(flying({}, { task: { ...makeHud().task, done: true, checklist: [] } }));
    expect(html).toContain("ROUND COMPLETE");
    expect(html).not.toContain("left-instruments");
  });

  it("shows the round complete card with the time and both buttons", () => {
    const html = render(makeHud({}, { done: true, title: "Round complete", elapsedMs: 125_400, checklist: [] }));
    expect(html).toContain("ROUND COMPLETE");
    expect(html).toContain("2:05");
    expect(html).toContain("Market parcel");
    expect(html).toContain("Westminster clock");
    expect(html).toContain("Letter for Lanternfall");
    expect(html).toContain("START AGAIN");
    expect(html).toContain("LOOK AROUND");
    expect(render(makeHud())).not.toContain("ROUND COMPLETE");
  });
});

describe("splitPrompt", () => {
  it("splits a key from its action", () => expect(splitPrompt("E · Pick up parcel")).toEqual({ key: "E", action: "Pick up parcel" }));
  it("keeps a prompt without a separator whole", () => expect(splitPrompt("Walk closer")).toEqual({ key: null, action: "Walk closer" }));
  it("keeps later separators in the action", () => expect(splitPrompt("E · Oil · now")).toEqual({ key: "E", action: "Oil · now" }));
});

describe("clampPercent", () => {
  it.each([[50, 50], [0, 4], [100, 96], [Number.NaN, 50], [Infinity, 50]])("%d becomes %d", (v, out) => expect(clampPercent(v)).toBe(out));
});

describe("playAnnouncement", () => {
  it("is a start message before the first hud", () => expect(playAnnouncement(null)).toBe("Round started."));
  it("reads the title and step", () => expect(playAnnouncement(makeHud())).toBe("Market parcel. Deliver it to St Paul's"));
  it("says the round is complete", () => expect(playAnnouncement(makeHud({}, { done: true }))).toBe("Round complete."));
});

describe("formatElapsed", () => {
  it.each([[0, "0:00"], [59_999, "0:59"], [60_000, "1:00"], [3_725_000, "62:05"], [-5, "0:00"], [Number.NaN, "0:00"]])(
    "%d ms is %s", (ms, text) => expect(formatElapsed(ms)).toBe(text));
});

describe("shouldOpenGuideOnEsc", () => {
  const walk = makeHud();
  it("opens the guide from walking play", () => expect(shouldOpenGuideOnEsc("play", walk, false)).toBe(true));
  it("opens it before the first hud arrives", () => expect(shouldOpenGuideOnEsc("play", null, false)).toBe(true));
  it("lets Esc free the mouse first while flying with the pointer locked", () => {
    expect(shouldOpenGuideOnEsc("play", flying({ pointerLocked: true }), false)).toBe(false);
  });
  it("opens it on the next Esc once the mouse is free", () => {
    expect(shouldOpenGuideOnEsc("play", flying({ pointerLocked: false }), false)).toBe(true);
  });
  it("opens it when flying without flight data", () => expect(shouldOpenGuideOnEsc("play", makeHud({ mode: "fly" }), false)).toBe(true));
  it("does not open a guide that is already open", () => expect(shouldOpenGuideOnEsc("play", walk, true)).toBe(false));
  it("does not open it behind the round complete card", () => {
    expect(shouldOpenGuideOnEsc("play", makeHud({}, { done: true }), false)).toBe(false);
  });
  it.each(["title", "explore"] as const)("never opens it in %s mode", (mode) => expect(shouldOpenGuideOnEsc(mode, walk, false)).toBe(false));
});

describe("keepTownFocus", () => {
  it("stops a mouse press on a HUD button from taking focus (the click itself still happens)", () => {
    let prevented = 0;
    keepTownFocus({ preventDefault: () => { prevented += 1; } });
    expect(prevented).toBe(1);
  });
});
