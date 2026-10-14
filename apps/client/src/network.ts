import { Client, type Room } from "@colyseus/sdk";
import type { GuestSession, InputCommand, MatchEvent, MatchState } from "@clockwork/shared";

const serverUrl = import.meta.env.VITE_SERVER_URL || `http://${typeof location === "undefined" ? "localhost" : location.hostname}:2567`;

type Listener<T> = (value: T) => void;

export class GameConnection {
  private readonly client = new Client(serverUrl);
  private room: Room | null = null;
  private stateListeners = new Set<Listener<MatchState>>();
  private eventListeners = new Set<Listener<MatchEvent>>();
  private statusListeners = new Set<Listener<string>>();
  sessionId = "";
  get roomId() { return this.room?.roomId ?? ""; }

  async createSession(inviteCode: string, callsign: string): Promise<GuestSession> {
    const response = await fetch(`${serverUrl}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteCode, callsign }),
    });
    if (!response.ok) throw new Error(response.status === 401 ? "That invite has expired or reached its use limit." : "Could not create an alpha session.");
    return response.json() as Promise<GuestSession>;
  }

  async join(session: GuestSession, paint: string) {
    this.emitStatus("contacting tower");
    this.room = await this.client.joinOrCreate("battle_royale", { sessionToken: session.token, callsign: session.callsign, paint });
    this.sessionId = this.room.sessionId;
    const room = this.room;
    try { localStorage.setItem("clockwork-reconnect-token", room.reconnectionToken); } catch {}
    const publish = (state: unknown) => {
      if (!state || this.room !== room) return;
      const schema = state as { toJSON?: () => MatchState };
      const plain = (typeof schema.toJSON === "function" ? schema.toJSON() : state) as MatchState;
      // joinOrCreate can resolve before the first schema packet: {} is not a match.
      if (!plain?.players || !plain.storm || !plain.pickups || !plain.projectiles || typeof plain.phase !== "string") return;
      const snapshot = { ...plain, winnerId: plain.winnerId || null,
        pickups: Object.fromEntries(Object.entries(plain.pickups).map(([id, pickup]) => [id, { ...pickup, type: pickup.type ?? (pickup as typeof pickup & { pickupType: typeof pickup.type }).pickupType }])),
        projectiles: Object.fromEntries(Object.entries(plain.projectiles).map(([id, projectile]) => [id, { ...projectile, targetId: projectile.targetId || null }])),
      };
      for (const listener of this.stateListeners) listener(snapshot);
    };
    this.room.onStateChange(publish);
    publish(this.room.state);
    this.room.onMessage("event", (event: MatchEvent) => { for (const listener of this.eventListeners) listener(event); });
    this.room.onDrop(() => this.emitStatus("signal lost — reconnecting"));
    this.room.onReconnect(() => this.emitStatus("signal restored"));
    this.room.onLeave(() => this.emitStatus("flight ended"));
    this.emitStatus("cleared for launch");
  }

  sendInput(input: InputCommand) { this.room?.send("input", input); }
  async leave() {
    const room = this.room; this.room = null; this.sessionId = "";
    await room?.leave(true);
    this.emitStatus("awaiting pilot");
  }
  onState(listener: Listener<MatchState>) { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); }; }
  onEvent(listener: Listener<MatchEvent>) { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; }
  onStatus(listener: Listener<string>) { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; }
  private emitStatus(status: string) { for (const listener of this.statusListeners) listener(status); }
}
