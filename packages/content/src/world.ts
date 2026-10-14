import { SeededRandom, V, type PickupType, type WorldManifest } from "@clockwork/shared";

const landmarkDirections = [
  [0.18, 0.92, 0.34], [-0.62, 0.72, 0.31], [0.76, 0.35, -0.54], [-0.31, 0.18, -0.93],
  [0.23, -0.73, -0.64], [-0.81, -0.44, 0.38], [0.66, -0.61, 0.42], [-0.12, -0.24, 0.96],
] as const;

const names = [
  "Copperwind Works", "The Bell Observatory", "Sundial Port", "Mender's Vale",
  "The Great Escapement", "Cloudloom Farm", "Rivet Market", "The Brass Orchard",
];
const accents = ["#c45f45", "#e1a74f", "#4f9184", "#8a6f9e", "#c07d4d", "#678d55", "#c35552", "#5a82a7"];

const pickupTypes: PickupType[] = ["repair", "rockets", "boost", "shield"];
const rng = new SeededRandom(0x51c0c7);
const pickupNodes = Array.from({ length: 40 }, (_, index) => {
  const y = 1 - (index + 0.5) / 40 * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * Math.PI * (3 - Math.sqrt(5)) + rng.range(-0.08, 0.08);
  return {
    id: `pickup-${String(index + 1).padStart(2, "0")}`,
    direction: V.normalize({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius }),
    altitude: 48 + (index % 5) * 12,
    type: pickupTypes[index % pickupTypes.length]!,
  };
});

export const CLOCKWORK_WORLD: WorldManifest = {
  id: "clockwork-prime",
  planetRadius: 350,
  minAltitude: 25,
  maxAltitude: 160,
  landmarks: landmarkDirections.map((direction, index) => ({
    id: `landmark-${index + 1}`,
    name: names[index]!,
    direction: V.normalize({ x: direction[0], y: direction[1], z: direction[2] }),
    radius: index === 4 ? 42 : 26 + (index % 3) * 5,
    accent: accents[index]!,
  })),
  pickupNodes,
};
