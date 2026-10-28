import { createAircraft, MATCH_RULES, PROTOCOL_VERSION, stepAircraft,
  type GuestSession, type InputCommand, type MatchEvent, type MatchState } from "@clockwork/shared";

type Listener<T> = (value: T) => void;
const PLAYER_ID = "local-pilot";

/** A small local flight session for the illustrated globe. It never contacts the game server. */
export class LocalFlightConnection {
  private state: MatchState | null = null;
  private readonly stateListeners = new Set<Listener<MatchState>>();
  private readonly eventListeners = new Set<Listener<MatchEvent>>();
  private readonly statusListeners = new Set<Listener<string>>();
  sessionId = "";
  get roomId() { return this.state?.id ?? ""; }

  async createSession(_inviteCode: string, callsign: string): Promise<GuestSession> {
    return { token: "local-illustrated-flight", guestId: PLAYER_ID, callsign, expiresAt: Date.now() + 86_400_000 };
  }

  async join(session: GuestSession, paint: string): Promise<void> {
    this.sessionId = PLAYER_ID;
    const now = Date.now();
    const center = { x: 0, y: 1, z: 0 };
    this.state = {
      version: PROTOCOL_VERSION, id: "solo-flight", seed: 1, serverTime: now,
      phase: "open", phaseStartedAt: now, phaseEndsAt: now + 86_400_000, winnerId: null,
      players: { [PLAYER_ID]: {
        id: PLAYER_ID, callsign: session.callsign, paint, bot: false, connected: true,
        status: "active", redeploysRemaining: 0, kills: 0,
        aircraft: createAircraft({ x: 0, y: MATCH_RULES.planetRadius + 100, z: 0 }, { x: 0, y: 0, z: -1 }),
      } },
      projectiles: {}, pickups: {},
      storm: { center, startCenter: center, nextCenter: center, angularRadius: Math.PI,
        startRadius: Math.PI, targetRadius: Math.PI, phaseStartedAt: now, phaseEndsAt: now + 86_400_000 },
    };
    this.publish();
    this.emitStatus("solo flight");
  }

  sendInput(input: InputCommand): void {
    const state = this.state;
    const player = state?.players[PLAYER_ID];
    if (!state || !player) return;
    stepAircraft(player.aircraft, input, 1 / 30);
    state.serverTime = Date.now();
    this.publish();
  }

  async leave(): Promise<void> {
    this.state = null;
    this.sessionId = "";
    this.emitStatus("awaiting pilot");
  }

  onState(listener: Listener<MatchState>) { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); }; }
  onEvent(listener: Listener<MatchEvent>) { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; }
  onStatus(listener: Listener<string>) { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; }
  private publish() {
    if (!this.state) return;
    const snapshot = { ...this.state, players: { ...this.state.players } };
    for (const listener of this.stateListeners) listener(snapshot);
  }
  private emitStatus(value: string) { for (const listener of this.statusListeners) listener(value); }
}
