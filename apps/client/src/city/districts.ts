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
const SPECS: ReadonlyArray<{ name: string; accent: string; kind: DistrictKind; terrace: DistrictTerrace; description: string }> = [
  { name: "Regent's Park", accent: "#50775d", kind: "windpumps", terrace: 2,
    description: "Plane trees, clipped lawns and an iron bandstand. A quiet garden tucked among the busy streets." },
  { name: "St Paul's", accent: "#8b8c7b", kind: "observatory", terrace: 3,
    description: "A great lead-grey dome above a Portland-stone colonnade. The cathedral watches over a tangle of brick lanes." },
  { name: "Tower Wharf", accent: "#4d858a", kind: "port", terrace: 0,
    description: "Twin stone towers and blue suspension chains frame the water. Boats wait beside the embankment steps." },
  { name: "Battersea", accent: "#ad6549", kind: "workshops", terrace: 1,
    description: "Four pale chimneys rise from the red-brick power station. Workshop doors and loading yards line the river road." },
  { name: "Westminster", accent: "#ad8b4e", kind: "escapement", terrace: 3,
    description: "Gothic windows, pale stone and slender pinnacles. A little Parliament Square where the island's streets meet." },
  { name: "Kew Gardens", accent: "#708a5f", kind: "farm", terrace: 1,
    description: "An iron-and-glass palm house sits among green borders. Follow the garden path past the potting beds." },
  { name: "Covent Garden", accent: "#b7543f", kind: "market", terrace: 2,
    description: "A covered market of striped awnings, flower stalls and little shopfronts. Wander the arcade and watch the city go by." },
  { name: "Bloomsbury", accent: "#71846a", kind: "orchard", terrace: 2,
    description: "A leafy Georgian square enclosed by black iron railings. Sash windows and chimney pots peek through the trees." },
];

export const DISTRICTS: readonly District[] = CLOCKWORK_WORLD.landmarks.map((landmark, index) => {
  const spec = SPECS[index];
  if (!spec) throw new Error(`No city district is defined for landmark ${landmark.id}`);
  return {
    id: landmark.id,
    ...spec,
    bearing: index * 45,
    compass: COMPASS[index % COMPASS.length]!,
    compassWords: COMPASS_WORDS[index % COMPASS_WORDS.length]!,
  };
});

export function terraceLabel(terrace: DistrictTerrace): string {
  return terrace === 0 ? "Thames side" : ["", "Riverside streets", "Garden streets", "Upper streets"][terrace]!;
}

export function districtLocation(district: District): string {
  const places: Record<DistrictKind, string> = { windpumps: "PARK GARDENS", observatory: "THE CATHEDRAL QUARTER", port: "THE RIVER CROSSING", workshops: "THE SOUTH BANK", escapement: "PARLIAMENT SQUARE", farm: "THE GLASSHOUSE GARDENS", market: "THE MARKET LANES", orchard: "THE GARDEN SQUARE" };
  return places[district.kind];
}
