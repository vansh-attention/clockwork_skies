import * as THREE from "three";
import { illustratedEnvironment } from "@clockwork/render";

/**
 * Chimney smoke, drawn the way the reference draws its smoke (`smokevfx` in its shipped bundle): each plume is a
 * ribbon that faces the view, widening as it rises and drifting downwind, filled with flat translucent white and broken
 * into wisps by noise flowing up it. It leaves the illustration's id, depth, normal and ink buffers as they were, so no
 * ink is drawn round it, and it is hidden behind anything nearer. Original geometry and shader: procedural noise stands
 * in for the reference's noise textures. One draw call for every chimney.
 */
export type ChimneySmoke = {
  readonly mesh: THREE.Mesh;
  /** `time` in seconds; reduced motion holds a still frame. */
  update(time: number, reduced: boolean): void;
  dispose(): void;
};

/** Segments up each plume. */
const SEGMENTS = 10;
/**
 * How a plume rises (world units): `rise` high, `base` wide at the pot and `top` wide at the top (the reference's
 * ribbons widen about twelvefold), drifting `drift` downwind by the top; flat fill at `opacity`, as the reference's 0.35.
 */
export const SMOKE = { rise: 9, base: 0.25, top: 3, drift: 5, opacity: 0.35, color: "#dcdfd4" } as const;

const vertexShader = /* glsl */ `
  in float aAlong;
  in float aSide;
  in float aSeed;
  uniform float uTime;
  uniform vec3 uWind;
  uniform float uRise;
  uniform float uBase;
  uniform float uTop;
  uniform float uDrift;
  out vec2 vUv;
  out float vSeed;
  out vec3 vWorld;
  void main() {
    float t = aAlong;
    // Up, then away downwind, with a slow sway that grows with height.
    vec3 sway = vec3(sin(uTime * 0.7 + aSeed * 6.283 + t * 2.0), 0.0, cos(uTime * 0.6 + aSeed * 4.1 + t * 1.7)) * 0.35 * t;
    vec3 centre = position + vec3(0.0, uRise * t, 0.0) + uWind * (uDrift * t * t) + sway;
    vec4 view = modelViewMatrix * vec4(centre, 1.0);
    // Face the view: spread across the view's own right.
    view.x += aSide * 0.5 * mix(uBase, uTop, t) * (0.8 + 0.4 * aSeed);
    gl_Position = projectionMatrix * view;
    vUv = vec2(aSide * 0.5 + 0.5, t);
    vSeed = aSeed;
    vWorld = (modelMatrix * vec4(centre, 1.0)).xyz;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uFogNear;
  uniform vec3 uFogFar;
  uniform float uFogDensity;
  in vec2 vUv;
  in float vSeed;
  in vec3 vWorld;
  layout(location = 0) out vec4 outColor;
  layout(location = 1) out vec4 outInfo;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float valueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  void main() {
    // Two noises flowing up the plume, the second eaten into by the first and squared: wisps that break apart.
    float n1 = valueNoise(vec3(vUv.x * 1.6 + vSeed * 9.0, vUv.y * 2.2 - uTime * 0.3, vSeed * 5.0));
    float n2 = 1.0 - valueNoise(vec3(vUv.x * 3.2 - vSeed * 7.0, vUv.y * 4.5 - uTime * 0.8, 3.7 + vSeed * 2.0));
    n2 = max(0.0, n2 - n1 * 0.4);
    n2 *= n2;
    float mask = (1.0 - abs(vUv.x - 0.5) * 2.0) * n2;
    mask -= (sin(vUv.y * 2.0 - uTime + vSeed * 10.0) * 0.5 + 0.5) * 0.15;
    mask *= smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
    if (mask < 0.05) discard;
    // The town's haze, as on every surface.
    float depth = uFogDensity * length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-depth * depth);
    vec3 color = mix(uColor, mix(uFogNear, uFogFar, smoothstep(0.0, 0.8, fog)), fog);
    outColor = vec4(color, uOpacity);
    // Alpha 0 here, with the blend below, keeps the id, depth, normal and ink mask beneath exactly as they were.
    outInfo = vec4(0.0);
  }
`;

function plumeGeometry(tops: readonly THREE.Vector3[], seed: number): THREE.BufferGeometry {
  const rows = SEGMENTS + 1;
  const count = Math.max(1, tops.length) * rows * 2;
  const position = new Float32Array(count * 3);
  const along = new Float32Array(count);
  const side = new Float32Array(count);
  const seeds = new Float32Array(count);
  const index: number[] = [];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let v = 0;
  for (const top of tops) {
    const plume = random();
    const first = v;
    for (let row = 0; row < rows; row += 1) {
      for (const s of [-1, 1]) {
        position[v * 3] = top.x;
        position[v * 3 + 1] = top.y;
        position[v * 3 + 2] = top.z;
        along[v] = row / SEGMENTS;
        side[v] = s;
        seeds[v] = plume;
        v += 1;
      }
      if (row > 0) {
        const a = first + (row - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setIndex(index);
  return geometry;
}

/** One smoke plume rising from each of `tops` (world space). */
export function createChimneySmoke(tops: readonly THREE.Vector3[], seed = 0x5e0c): ChimneySmoke {
  const material = new THREE.ShaderMaterial({
    name: "chimney smoke",
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(SMOKE.color) },
      uOpacity: { value: SMOKE.opacity },
      uRise: { value: SMOKE.rise },
      uBase: { value: SMOKE.base },
      uTop: { value: SMOKE.top },
      uDrift: { value: SMOKE.drift },
      // Shared with every illustrated surface: the same wind and haze.
      uWind: illustratedEnvironment.uWind,
      uFogNear: illustratedEnvironment.uFogNear,
      uFogFar: illustratedEnvironment.uFogFar,
      uFogDensity: illustratedEnvironment.uFogDensity,
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Colour blends over what is there; every alpha (the surface ids, the ink mask) and the info buffer stay put.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(plumeGeometry(tops, seed), material);
  mesh.name = "Chimney smoke";
  // The plumes rise and drift well beyond the chimney tops their vertices sit on; one small draw, so skip culling.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = tops.length > 0;
  return {
    mesh,
    update(time, reduced) {
      if (!Number.isFinite(time)) return;
      material.uniforms.uTime!.value = reduced ? 0 : time;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
