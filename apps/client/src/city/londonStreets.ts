import * as THREE from "three";
import { illustratedEnvironment } from "@clockwork/render";
import { Batch, at, frame, houseFrame, local, merge, type MaterialKey } from "./kit";
import { ROAD_LIFT, STAIR_BEARINGS, STREET, TERRACES, VEHICLE_SCALE, type CityLayout, type Furniture } from "./layout";
import { DISTRICTS } from "./districts";
import { hasLondonShopAwning, isLondonShopfront } from "./londonDetails";
import { buildLondonStreetNetwork } from "./londonTerrain";

/** London transport is parked, leaving a generous walking lane through the carriageway. */
export function addLondonTransport(batch: Batch, item: Furniture): boolean {
  if (item.kind !== "bus" && item.kind !== "taxi" && item.kind !== "bus-stop" && item.kind !== "beacon") return false;
  const base = at(item.x, item.y, item.z, (item.rotation ?? Math.PI - item.bearing) + (item.turn ?? 0));
  const box = (key: MaterialKey, w: number, h: number, d: number, x: number, y: number, z: number) =>
    batch.add(key, new THREE.BoxGeometry(w, h, d), local(base, x, y, z));
  if (item.kind === "beacon") {
    batch.add("iron", new THREE.CylinderGeometry(0.09, 0.12, 4.1, 6), local(base, 0, 2.05, 0));
    batch.add("brass", new THREE.SphereGeometry(0.38, 8, 6), local(base, 0, 4.2, 0));
    return true;
  }
  if (item.kind === "bus-stop") {
    batch.add("iron", new THREE.CylinderGeometry(0.1, 0.12, 4.8, 6), local(base, 0, 2.4, 0));
    batch.add("copper", new THREE.TorusGeometry(0.6, 0.15, 5, 20), local(base, 0, 4.8, 0));
    box("copper", 1.5, 0.3, 0.12, 0, 4.8, 0);
    box("face", 0.65, 1.2, 0.15, 0, 3.4, 0);
    box("ink", 0.43, 0.06, 0.17, 0, 3.6, 0);
    box("ink", 0.43, 0.06, 0.17, 0, 3.3, 0);
    return true;
  }
  const bus = item.kind === "bus";
  if (!bus) {
    addBlackCab(batch, base);
    return true;
  }
  // Real size (VEHICLE_SCALE): the body is authored compactly and scaled per axis; wheels and hubs stay round.
  const scale = VEHICLE_SCALE.bus;
  const ground = base.clone();
  base.multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z));
  const length = 12;
  const width = 3.1;
  // A rounded double-deck body: soft roof edges and gently rounded ends, rather than a plain box.
  batch.add("copper", roundedBody([
    [-6, 1.05, 6.05, 1.45], [-5.8, 0.95, 6.25, 1.55], [5.8, 0.95, 6.25, 1.55], [6, 1.05, 6.05, 1.45],
  ], 0.55), base);
  for (const side of [-1, 1]) {
    const z = side * (width / 2 + 0.035);
    for (let bay = 0; bay < 6; bay += 1) {
      box("ink", 1.45, 1.35, 0.08, -4.6 + bay * 1.83, 5.15, z);
      box("ink", 1.45, 1.3, 0.08, -4.6 + bay * 1.83, 2.9, z);
    }
    box("face", 11.3, 0.32, 0.09, 0, 3.96, z);
    box("brass", 4, 0.38, 0.1, 0, 1.62, z);
    for (const x of [-(length / 2 - 1.3), length / 2 - 1.3]) {
      // Round tyres just touching the road, placed with the scaled body.
      const r = 0.9 * scale.round;
      const at = local(ground, x * scale.x, r + 0.02, side * (width / 2) * scale.z);
      batch.add("ink", new THREE.CylinderGeometry(r, r, 0.26 * scale.round, 16).rotateX(Math.PI / 2), at);
      batch.add("stone", new THREE.CylinderGeometry(0.38 * scale.round, 0.38 * scale.round, 0.3 * scale.round, 10).rotateX(Math.PI / 2), at);
    }
  }
  // Windscreen, destination panel, headlights and bumper on the leading end.
  box("ink", 0.08, 1.3, width - 0.45, length / 2 + 0.04, 2.9, 0);
  box("face", 0.09, 0.45, width - 0.6, length / 2 + 0.05, 3.95, 0);
  for (const side of [-1, 1]) box("face", 0.12, 0.36, 0.4, length / 2 + 0.08, 1.4, side * (width / 2 - 0.4));
  box("stone", 0.18, 0.24, width, length / 2 + 0.1, 0.94, 0);
  return true;
}

/**
 * A smooth body lofted along local X through rounded-rectangle sections: each station is [x, bottom, top, half width].
 * `round` (0..1) sets how soft the section's corners are. Smooth normals let the light turn across it in a soft band.
 */
function roundedBody(stations: readonly (readonly [x: number, bottom: number, top: number, halfWidth: number])[], round: number, segments = 20): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const exponent = 2 / (2 + (1 - round) * 8);
  for (const [x, bottom, top, halfWidth] of stations) {
    const cy = (bottom + top) / 2, hy = (top - bottom) / 2;
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * Math.PI * 2;
      const c = Math.cos(theta), s = Math.sin(theta);
      positions.push(x, cy + Math.sign(s) * Math.abs(s) ** exponent * hy, Math.sign(c) * Math.abs(c) ** exponent * halfWidth);
    }
  }
  for (let r = 0; r < stations.length - 1; r += 1) for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    const a = r * segments + i, b = (r + 1) * segments + i, c = (r + 1) * segments + j, d = r * segments + j;
    // Wound so each face points outward (ring r to r + 1 runs along +X, the angle turns from +Z toward +Y).
    indices.push(a, b, c, a, c, d);
  }
  // Close both ends with a fan round each end section's centre (outward: -X at the first, +X at the last).
  for (const [ring, flip] of [[0, true], [stations.length - 1, false]] as const) {
    const [x, bottom, top] = stations[ring]!;
    const centre = positions.length / 3;
    positions.push(x, (bottom + top) / 2, 0);
    for (let i = 0; i < segments; i += 1) {
      const a = ring * segments + i, b = ring * segments + (i + 1) % segments;
      if (flip) indices.push(centre, a, b); else indices.push(centre, b, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * An original London black cab, within the taxi's footprint (FURNITURE_SIZE.taxi): a rounded body with a short bonnet,
 * a tall glasshouse and a sloping boot, dark glazing, pale bumpers and grille, round headlamps, the roof sign and
 * four wheels with pale hubs. Local +X is the leading end.
 */
function addBlackCab(batch: Batch, ground: THREE.Matrix4): void {
  // Real size (VEHICLE_SCALE): the body is authored compactly and scaled per axis; wheels, hubs and lamps stay round.
  const scale = VEHICLE_SCALE.taxi;
  const base = ground.clone().multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z));
  const add = (key: MaterialKey, geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0) => batch.add(key, geometry, local(base, x, y, z));
  const addRound = (key: MaterialKey, geometry: THREE.BufferGeometry, x: number, y: number, z: number) =>
    batch.add(key, geometry, local(ground, x * scale.x, y, z * scale.z));
  // The body, rear bumper to front grille: [x, bottom, top, half width].
  add("ink", roundedBody([
    [-2.78, 0.5, 1.2, 1.1], [-2.62, 0.4, 1.5, 1.2], [-2.0, 0.36, 1.62, 1.24], [-1.62, 0.36, 2.34, 1.24],
    [-1.2, 0.36, 2.5, 1.24], [0.15, 0.36, 2.5, 1.24], [0.62, 0.36, 2.3, 1.24], [0.95, 0.36, 1.66, 1.24],
    [1.6, 0.38, 1.56, 1.22], [2.45, 0.42, 1.44, 1.18], [2.78, 0.52, 1.3, 1.08],
  ], 0.62));
  // Glazing: side windows, windscreen and rear screen, just proud of the body.
  for (const side of [-1, 1]) {
    for (const [x, w] of [[-1.15, 0.85], [-0.2, 0.85]] as const) add("water", new THREE.BoxGeometry(w, 0.62, 0.04), x, 2.0, side * 1.235);
  }
  add("water", new THREE.BoxGeometry(0.05, 0.6, 2.0).rotateZ(0.62), 0.78, 1.98, 0);
  add("water", new THREE.BoxGeometry(0.05, 0.55, 1.9).rotateZ(-0.35), -1.68, 2.0, 0);
  // Pale bumpers, grille and headlamps; the roof sign.
  add("stone", new THREE.BoxGeometry(0.16, 0.22, 2.3), 2.83, 0.62, 0);
  add("stone", new THREE.BoxGeometry(0.16, 0.22, 2.3), -2.83, 0.62, 0);
  add("stone", new THREE.BoxGeometry(0.06, 0.5, 0.9), 2.8, 1.02, 0);
  for (const side of [-1, 1]) addRound("face", new THREE.SphereGeometry(0.2 * scale.round, 10, 8), 2.72, 1.08 * scale.y, side * 0.78);
  add("brass", new THREE.BoxGeometry(0.62, 0.22, 0.38), -0.4, 2.62, 0);
  // Wheels, half hidden under the body, with pale hubs.
  const r = 0.56 * scale.round;
  for (const x of [-1.72, 1.72]) for (const side of [-1, 1]) {
    addRound("ink", new THREE.CylinderGeometry(r, r, 0.32 * scale.round, 14).rotateX(Math.PI / 2), x, r, side * 1.08);
    addRound("stone", new THREE.CylinderGeometry(0.24 * scale.round, 0.24 * scale.round, 0.34 * scale.round, 10).rotateX(Math.PI / 2), x, r, side * 1.09);
  }
}

/** Pavement edges, broken white centre lines and zebra crossings at each stair route. */
export function addLondonRoads(batch: Batch, layout: CityLayout) {
  if (layout.plan) { buildLondonStreetNetwork(batch, layout.plan); return; }
  for (const landmark of layout.landmarks) {
    const kind = DISTRICTS[landmark.district]?.kind;
    if (kind === "port" || kind === "windpumps" || kind === "orchard") continue;
    // Paved forecourts connect the cathedral door and covered market to their streets.
    batch.add("paving", new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2),
      local(frame(landmark.bearing, landmark.radius, landmark.y), 0, 0.045, 0));
  }
  for (const terrace of TERRACES.slice(0, 3)) {
    const inner = terrace.radius - STREET.inset;
    const road = inner + STREET.width / 2;
    batch.add("ink", new THREE.RingGeometry(road - 3.8, road + 3.8, 192).rotateX(-Math.PI / 2).translate(0, terrace.top + ROAD_LIFT, 0));
    for (const r of [road - 4.1, road + 4.1]) {
      batch.add("stone", new THREE.TorusGeometry(r, 0.22, 4, 192).rotateX(Math.PI / 2).translate(0, terrace.top + ROAD_LIFT + 0.07, 0));
    }
    const dashes = Math.floor(Math.PI * 2 * road / 10);
    for (let i = 0; i < dashes; i += 1) {
      const bearing = i / dashes * Math.PI * 2;
      batch.add("face", new THREE.BoxGeometry(3.8, 0.025, 0.14), frame(bearing, road, terrace.top + ROAD_LIFT + 0.03));
    }
    for (const bearing of STAIR_BEARINGS) {
      const base = frame(bearing, road, terrace.top + ROAD_LIFT + 0.04);
      // Stripes run across the road, with clear black gaps along the direction of traffic.
      for (let stripe = -2; stripe <= 2; stripe += 1) batch.add("face", new THREE.BoxGeometry(0.8, 0.035, 7.5), local(base, stripe * 1.5, 0, 0));
    }
  }
}

const SHOPS = ["BAKERY", "BOOKSELLER", "THE CROWN", "FLORIST", "TEA & COFFEE", "GROCER"];

/** Original shopfront geometry. All detail remains on the existing house footprint. */
export function addLondonShopfronts(batch: Batch, layout: CityLayout) {
  for (const [index, house] of layout.houses.entries()) {
    if (!isLondonShopfront(house, index)) continue;
    const base = houseFrame(house);
    const z = house.depth / 2 + 0.35;
    const w = house.width;
    const color: MaterialKey = Math.floor(index / 3) % 3 === 0 ? "copper" : index % 3 === 1 ? "leaf0" : "ink";
    batch.add(color, new THREE.BoxGeometry(w - 0.2, 4.7, 0.35), local(base, 0, 2.35, z));
    // Deep shop windows, pane divisions and a narrow timber door.
    for (const x of [-w * 0.28, w * 0.28]) {
      batch.add("water", new THREE.BoxGeometry(w * 0.31, 2.55, 0.1), local(base, x, 2.2, z + 0.23));
      batch.add("brass", new THREE.BoxGeometry(w * 0.31, 0.09, 0.14), local(base, x, 2.6, z + 0.3));
    }
    batch.add("ink", new THREE.BoxGeometry(1.7, 3.4, 0.12), local(base, 0, 1.7, z + 0.25));
    batch.add("brass", new THREE.SphereGeometry(0.1, 6, 4), local(base, 0.55, 1.55, z + 0.35));
    batch.add(color, new THREE.BoxGeometry(w + 0.2, 1.2, 0.65), local(base, 0, 4.5, z + 0.25));
    if (hasLondonShopAwning(house, index)) {
      for (let stripe = 0; stripe < 10; stripe += 1) {
        batch.add(stripe % 2 === 0 ? "face" : color, new THREE.BoxGeometry((w + 0.6) / 10, 0.09, 1.9).rotateX(0.18), local(base, -(w + 0.6) * 0.45 + stripe * (w + 0.6) / 10, 3.95, z + 0.95));
      }
    }
  }
}

/** One atlas and one draw call for the town's enamel street plates and painted shop fascias. */
export function buildLondonSigns(layout: CityLayout): THREE.Group {
  const group = new THREE.Group();
  group.name = "London street names and shop signs";
  // Geometry generation also runs in the Node content/test pipeline, which has no canvas.
  if (typeof document === "undefined") return group;
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return group;
  const labels = [...SHOPS, ...DISTRICTS.map((district) => district.name.toUpperCase())];
  const parts: THREE.BufferGeometry[] = [];
  const rowHeight = 64;
  for (const [index, label] of labels.entries()) {
    const y = index * rowHeight;
    ctx.fillStyle = index < SHOPS.length ? "#243d37" : "#f4eddb";
    ctx.fillRect(0, y, 1024, rowHeight);
    ctx.fillStyle = index < SHOPS.length ? "#f4eddb" : "#243d37";
    ctx.font = "bold 38px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 512, y + 32, 980);
    ctx.strokeStyle = index < SHOPS.length ? "#d5bd78" : "#b04432";
    ctx.lineWidth = 3; ctx.strokeRect(5, y + 4, 1014, rowHeight - 8);
  }
  const plate = (index: number, w: number, h: number, matrix: THREE.Matrix4) => {
    const geometry = new THREE.PlaneGeometry(w, h);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i += 1) uv.setY(i, 1 - (index * rowHeight + (1 - uv.getY(i)) * rowHeight) / 1024);
    geometry.applyMatrix4(matrix);
    parts.push(geometry);
  };
  for (const [index, house] of layout.houses.entries()) {
    if (!isLondonShopfront(house, index)) continue;
    plate(index % SHOPS.length, house.width - 0.5, 0.95, local(houseFrame(house), 0, 4.5, house.depth / 2 + 0.94));
  }
  for (const landmark of layout.landmarks) {
    // Wall-mounted plate, immediately outside each landmark forecourt; no invisible free-standing obstacle.
    const nearest = layout.houses.reduce<typeof layout.houses[number] | undefined>((best, h) =>
      !best || Math.hypot(h.x - landmark.x, h.z - landmark.z) < Math.hypot(best.x - landmark.x, best.z - landmark.z) ? h : best, undefined);
    if (nearest) plate(SHOPS.length + landmark.district, 6, 1.1,
      local(houseFrame(nearest), 0, 7, nearest.depth / 2 + 0.4));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The city's render target has TWO attachments. A stock MeshBasicMaterial writes only one,
  // so the plates use the same colour/info contract as the illustrated scene.
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    uniforms: { tAtlas: { value: texture }, uFogDensity: illustratedEnvironment.uFogDensity, uSurfaceId: { value: 0.97 } },
    vertexShader: `
      out vec2 vUv;
      out vec3 vNormal;
      out float vDistance;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vDistance = length(view.xyz);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tAtlas;
      uniform float uFogDensity;
      uniform float uSurfaceId;
      in vec2 vUv;
      in vec3 vNormal;
      in float vDistance;
      layout(location = 0) out vec4 outColor;
      layout(location = 1) out vec4 outInfo;
      void main() {
        vec3 color = texture(tAtlas, vUv).rgb;
        float fog = 1.0 - exp(-pow(vDistance * uFogDensity, 2.0));
        outColor = vec4(mix(color, vec3(0.55, 0.69, 0.69), fog), uSurfaceId);
        outInfo = vec4(0.0, normalize(vNormal).xy * 0.5 + 0.5, 0.6);
      }`,
  });
  material.addEventListener("dispose", () => texture.dispose());
  const mesh = new THREE.Mesh(merge(parts), material);
  mesh.name = "Enamel plates and fascias";
  group.add(mesh);
  return group;
}
