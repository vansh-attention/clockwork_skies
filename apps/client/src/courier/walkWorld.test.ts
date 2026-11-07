import { describe, expect, it } from "vitest";
import { DISTRICTS } from "../city/districts";
import {
  CANAL, ISLAND_RADIUS, STAIR_BEARINGS, SUMMIT, TERRACES,
  createCityLayout, groundHeight, polarToXZ,
} from "../city/layout";
import { createHillTownWalkWorld } from "./walkWorld";

const layout = createCityLayout();
const world = createHillTownWalkWorld(layout);

describe("hill town walk world", () => {
  it("matches groundHeight on open terrace ground", () => {
    for (const r of [60, 130, 200, 270, 400]) {
      const { x, z } = polarToXZ(0, r);
      const surface = world.surfaceAt(x, z);
      expect(surface.walkable).toBe(true);
      expect(surface.height).toBe(groundHeight(r));
    }
  });

  it("blends stair height between terrace levels along a stair bearing", () => {
    const bearing = STAIR_BEARINGS[0]!;
    const heightAt = (r: number) => {
      const { x, z } = polarToXZ(bearing, r);
      return world.surfaceAt(x, z);
    };
    const wall = TERRACES[0].radius;
    expect(heightAt(wall).height).toBeCloseTo(TERRACES[0].top, 5);
    const mid = heightAt(wall + 8);
    expect(mid.walkable).toBe(true);
    expect(mid.height).toBeGreaterThan(0);
    expect(mid.height).toBeLessThan(TERRACES[0].top);
    // Strictly descending outward through the flight.
    expect(heightAt(wall + 4).height).toBeGreaterThan(heightAt(wall + 12).height);
    // A flight on an upper terrace blends between its own levels.
    const upper = heightAt(TERRACES[1].radius + 10).height;
    expect(upper).toBeGreaterThan(TERRACES[0].top);
    expect(upper).toBeLessThan(TERRACES[1].top);
  });

  it("does not blend stairs away from the stair corridor", () => {
    const { x, z } = polarToXZ(STAIR_BEARINGS[0]! + 0.2, 300);
    expect(world.surfaceAt(x, z).height).toBe(groundHeight(300));
  });

  it("blocks the canal except on bridges", () => {
    const water = polarToXZ(0, (CANAL.inner + CANAL.outer) / 2);
    expect(world.surfaceAt(water.x, water.z).walkable).toBe(false);

    for (const bearing of STAIR_BEARINGS) {
      const deck = polarToXZ(bearing, (CANAL.inner + CANAL.outer) / 2);
      const surface = world.surfaceAt(deck.x, deck.z);
      expect(surface.walkable).toBe(true);
      expect(surface.height).toBe(2);
    }
    // Just past the bridge edge (5 units of arc) is water again.
    const r = 332;
    const off = polarToXZ(STAIR_BEARINGS[0]! + 6 / r, r);
    expect(world.surfaceAt(off.x, off.z).walkable).toBe(false);
  });

  it("makes the island rim unwalkable", () => {
    const rim = polarToXZ(0, ISLAND_RADIUS - 2);
    expect(world.surfaceAt(rim.x, rim.z).walkable).toBe(false);
    const edge = polarToXZ(0, ISLAND_RADIUS - 6 + 0.5);
    expect(world.surfaceAt(edge.x, edge.z).walkable).toBe(false);
    const inside = polarToXZ(0, ISLAND_RADIUS - 8);
    expect(world.surfaceAt(inside.x, inside.z).walkable).toBe(true);
    expect(world.blocked(rim.x, rim.z, 0.5)).toBe(true);
  });

  it("blocks the inside of a house but not the street gap between neighbours", () => {
    const house = layout.houses[0]!;
    expect(world.blocked(house.x, house.z, 0.5)).toBe(true);

    let checked = 0;
    const rows = new Map<number, typeof layout.houses>();
    for (const h of layout.houses) rows.set(h.r, [...(rows.get(h.r) ?? []), h]);
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.theta - b.theta);
      for (let i = 0; i + 1 < sorted.length; i += 1) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        const gapArc = (b.theta - a.theta) * a.r - a.width / 2 - b.width / 2;
        if (gapArc < 2 || gapArc > 6) continue;
        const mid = (a.theta + a.width / 2 / a.r + b.theta - b.width / 2 / a.r) / 2;
        const { x, z } = polarToXZ(mid, a.r);
        expect(world.blocked(x, z, 0)).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("blocks the clock tower footprint", () => {
    expect(world.blocked(0, 0, 0)).toBe(true);
    expect(world.blocked(17, -17, 0)).toBe(true);
    expect(world.blocked(18.5, 0, 0)).toBe(false);
    expect(world.blocked(18.5, 0, 1)).toBe(true);
  });

  it("blocks tree trunks", () => {
    const tree = layout.trees[0]!;
    expect(world.blocked(tree.x, tree.z, 0.2)).toBe(true);
    expect(world.blocked(tree.x + 1.4, tree.z, 0)).toBe(true);
    expect(world.blocked(tree.x + 1.6, tree.z, 0)).toBe(false);
  });

  it("blocks the escapement pier and the port gnomon, but not the port plaza", () => {
    const escapement = layout.landmarks[DISTRICTS.findIndex((d) => d.kind === "escapement")]!;
    const outward = polarToXZ(escapement.bearing, 1);
    expect(world.blocked(escapement.x - outward.x * 10, escapement.z - outward.z * 10, 0.5)).toBe(true);

    const port = layout.landmarks[DISTRICTS.findIndex((d) => d.kind === "port")]!;
    expect(world.blocked(port.x, port.z + 7, 0.5)).toBe(true);
    expect(world.blocked(port.x, port.z - 6, 0.5)).toBe(false);
  });

  it("places landmark blockers in the local frame (+Z away from the tower)", () => {
    const farm = layout.landmarks[DISTRICTS.findIndex((d) => d.kind === "farm")]!;
    const a = Math.PI - farm.bearing;
    const rot = (lx: number, lz: number) => ({
      x: farm.x + lx * Math.cos(a) + lz * Math.sin(a),
      z: farm.z - lx * Math.sin(a) + lz * Math.cos(a),
    });
    const hit = rot(15, -2);
    expect(world.blocked(hit.x, hit.z, 0.5)).toBe(true);
    const mirrored = rot(-15, -2);
    expect(world.blocked(mirrored.x, mirrored.z, 0.5)).toBe(false);
  });

  it("leaves the summit plaza between the tower and the wall open", () => {
    const { x, z } = polarToXZ(Math.PI / 4, 60);
    const surface = world.surfaceAt(x, z);
    expect(surface.walkable).toBe(true);
    expect(surface.height).toBe(SUMMIT.top);
    expect(world.blocked(x, z, 1)).toBe(false);
  });

  it("answers blocked quickly over the whole town", () => {
    const start = performance.now();
    let hits = 0;
    for (let i = 0; i < 20000; i += 1) {
      const p = polarToXZ(i * 0.37, 20 + (i % 440));
      if (world.blocked(p.x, p.z, 1)) hits += 1;
    }
    expect(hits).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("never needs a step taller than the walker's 1.2 limit along any stair-and-bridge route", () => {
    const tooTall: string[] = [];
    for (const bearing of STAIR_BEARINGS) {
      for (const lateral of [0, -2.5, 2.5]) {
        let previous: number | null = null;
        for (let r = SUMMIT.radius - 10; r <= ISLAND_RADIUS - 8; r += 0.05) {
          const base = polarToXZ(bearing, r);
          const across = polarToXZ(bearing + Math.PI / 2, lateral);
          const surface = world.surfaceAt(base.x + across.x, base.z + across.z);
          if (!surface.walkable) { previous = null; continue; }
          if (previous !== null && Math.abs(surface.height - previous) > 1.2) tooTall.push(`bearing ${bearing.toFixed(2)} r ${r.toFixed(2)} lateral ${lateral}`);
          previous = surface.height;
        }
      }
    }
    expect(tooTall).toEqual([]);
  });

  it("ramps each bridge down to the promenade and fences its deck with rails", () => {
    const bearing = STAIR_BEARINGS[0]!;
    const deck = polarToXZ(bearing, (CANAL.inner + CANAL.outer) / 2);
    expect(world.surfaceAt(deck.x, deck.z)).toEqual({ height: 2, walkable: true });
    const end = polarToXZ(bearing, (CANAL.inner + CANAL.outer) / 2 + 26);
    expect(world.surfaceAt(end.x, end.z).height).toBeCloseTo(0);
    expect(world.blocked(deck.x, deck.z, 1.5)).toBe(false);
    const sideways = polarToXZ(bearing + Math.PI / 2, 4.5);
    expect(world.blocked(deck.x + sideways.x, deck.z + sideways.z, 1.5)).toBe(true);
  });

  it("keeps the body off the canal except on bridges", () => {
    const bank = polarToXZ(STAIR_BEARINGS[0]! + 0.2, CANAL.inner - 1);
    expect(world.blocked(bank.x, bank.z, 1.5)).toBe(true);
  });

  it("fails closed on non-finite input", () => {
    expect(world.surfaceAt(Number.NaN, 0).walkable).toBe(false);
    expect(world.surfaceAt(0, Number.POSITIVE_INFINITY).walkable).toBe(false);
    expect(world.blocked(Number.NaN, 0, 1)).toBe(true);
    expect(world.blocked(0, 0, Number.NaN)).toBe(true);
  });
});
