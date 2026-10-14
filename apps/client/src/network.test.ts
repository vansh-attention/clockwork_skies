import { describe, expect, it, vi } from "vitest";
const room = vi.hoisted(() => ({ sessionId: "pilot-1", reconnectionToken: "token", state: { toJSON: () => ({ version: 1, phase: "lobby", storm: {}, players: {}, pickups: {}, projectiles: {}, winnerId: "" }) }, onStateChange: vi.fn(), onMessage: vi.fn(), onDrop: vi.fn(), onReconnect: vi.fn(), onLeave: vi.fn(), leave: vi.fn(async () => {}), send: vi.fn() }));
vi.mock("@colyseus/sdk", () => ({ Client: class { joinOrCreate = async () => room; } }));
import { GameConnection } from "./network";

 describe("room lifecycle", () => {
  it("publishes already-decoded join state and tears down subscriptions with void cleanup", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
    const connection = new GameConnection();
    const states = vi.fn();
    const unsubscribe = connection.onState(states);
    await connection.join({ token: "abcdefghijklmnop", guestId: "guest", callsign: "TEST", expiresAt: 1 }, "cream-copper");
    expect(states).toHaveBeenCalledOnce();
    expect(states.mock.calls[0]?.[0].winnerId).toBeNull();
    expect(unsubscribe()).toBeUndefined();
    await connection.leave();
    expect(connection.sessionId).toBe("");
    vi.unstubAllGlobals();
  });
  it("waits for the first schema patch when the SDK initially exposes empty state", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const initial = room.state.toJSON;
    room.state.toJSON = () => ({}) as ReturnType<typeof initial>;
    const connection = new GameConnection(); const states = vi.fn();
    connection.onState(states);
    await connection.join({ token: "abcdefghijklmnop", guestId: "guest", callsign: "TEST", expiresAt: 1 }, "cream-copper");
    expect(states).not.toHaveBeenCalled();
    const publish = room.onStateChange.mock.calls.at(-1)?.[0];
    publish(initial());
    expect(states).toHaveBeenCalledOnce();
    room.state.toJSON = initial; await connection.leave(); vi.unstubAllGlobals();
  });
});
