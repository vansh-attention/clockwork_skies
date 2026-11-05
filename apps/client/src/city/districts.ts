import { CLOCKWORK_WORLD } from "@clockwork/content";

export type DistrictKind = "windpumps" | "observatory" | "port" | "workshops" | "escapement" | "farm" | "market" | "orchard";
/** 0 is the canal side below the hill; 1–3 are the terraces climbing toward the clock tower. */
export type DistrictTerrace = 0 | 1 | 2 | 3;

export type District = {
  id: string;
  name: string;
  accent: string;
  kind: DistrictKind;
  terrace: DistrictTerrace;
  /** Degrees clockwise from north (−Z), measured from the clock tower. */
  bearing: number;
  compass: string;
  compassWords: string;
  description: string;
};

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const COMPASS_WORDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

// One entry per landmark in CLOCKWORK_WORLD, in the same order.
const SPECS: ReadonlyArray<{ kind: DistrictKind; terrace: DistrictTerrace; description: string }> = [
  { kind: "windpumps", terrace: 2, description: "Wind-pumps on copper masts lift canal water up to every terrace." },
  { kind: "observatory", terrace: 3, description: "The telescope here sets the town clock each night by the stars." },
  { kind: "port", terrace: 0, description: "Canal boats tie up beside a sundial the size of a plaza." },
  { kind: "workshops", terrace: 1, description: "Repair sheds and tall chimneys. Anything broken in town ends up here." },
  { kind: "escapement", terrace: 3, description: "The giant escapement wheel that lets every gear in town move one tick at a time." },
  { kind: "farm", terrace: 1, description: "Striped fields and a wind-driven loom that weaves sailcloth." },
  { kind: "market", terrace: 2, description: "Striped stalls selling springs, rivets and fresh bread." },
  { kind: "orchard", terrace: 2, description: "Trees with brass leaves on the sunniest slope of the hill." },
];

export const DISTRICTS: readonly District[] = CLOCKWORK_WORLD.landmarks.map((landmark, index) => {
  const spec = SPECS[index];
  if (!spec) throw new Error(`No city district is defined for landmark ${landmark.id}`);
  return {
    id: landmark.id,
    name: landmark.name,
    accent: landmark.accent,
    ...spec,
    bearing: index * 45,
    compass: COMPASS[index % COMPASS.length]!,
    compassWords: COMPASS_WORDS[index % COMPASS_WORDS.length]!,
  };
});

export function terraceLabel(terrace: DistrictTerrace): string {
  return terrace === 0 ? "Canal side" : `Terrace ${terrace}`;
}

export function districtLocation(district: District): string {
  return `${terraceLabel(district.terrace)} · ${district.compassWords} of the tower`;
}
