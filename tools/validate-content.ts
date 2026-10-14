import { pathToFileURL } from "node:url";
import { z } from "zod";
import { CLOCKWORK_WORLD, BOT_PROFILES, PAINTS } from "@clockwork/content";

const vector = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
const worldSchema = z.object({
  id: z.string().min(1),
  planetRadius: z.number().positive(),
  minAltitude: z.number().positive(),
  maxAltitude: z.number().positive(),
  landmarks: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), direction: vector, radius: z.number().positive(), accent: z.string().regex(/^#[0-9a-f]{6}$/i) })).min(1),
  pickupNodes: z.array(z.object({ id: z.string().min(1), direction: vector, altitude: z.number().finite(), type: z.enum(["repair", "rockets", "boost", "shield"]) })).min(1),
});

export function validateWorld(value: unknown) {
  const world = worldSchema.parse(value);
  if (world.minAltitude >= world.maxAltitude) throw new Error("min altitude must be below max altitude");
  const nodes = [...world.landmarks, ...world.pickupNodes];
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new Error("world identifiers must be unique");
  for (const node of nodes) {
    const d = node.direction;
    if (Math.abs(Math.hypot(d.x, d.y, d.z) - 1) > 0.001) throw new Error(`${node.id}: direction must be normalised`);
  }
  for (const node of world.pickupNodes) {
    if (node.altitude < world.minAltitude || node.altitude > world.maxAltitude) throw new Error(`${node.id}: pickup altitude outside flight shell`);
  }
  return world;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const world = validateWorld(CLOCKWORK_WORLD);
  console.log(JSON.stringify({ ok: true, world: world.id, landmarks: world.landmarks.length, pickupNodes: world.pickupNodes.length, paints: PAINTS.length, botProfiles: BOT_PROFILES.length }));
}
