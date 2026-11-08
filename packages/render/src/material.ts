import {
  Color,
  GLSL3,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from "three";

/**
 * "view" (the default): the classic headlight look, lit from the camera's upper right; nothing else in the scene needed.
 * "world": a sun fixed in the world, with cast shadows from a DirectionalLight, a sky fill and fog, all driven by the
 * shared `illustratedEnvironment` uniforms (the town).
 */
export type IllustratedLighting = "view" | "world";

/** Painted surface marks drawn by "world" materials (see the fragment shader's paintedMarks). */
export type IllustratedPattern =
  | "none" | "brick" | "slate" | "flags" | "ashlar" | "grass" | "water" | "leaves" | "hatch" | "bark" | "render" | "camo" | "tarmac";
export const PATTERN_IDS: Readonly<Record<IllustratedPattern, number>> = {
  none: 0, brick: 1, slate: 2, flags: 3, ashlar: 4, grass: 5, water: 6, leaves: 7, hatch: 8, bark: 9, render: 10, camo: 11, tarmac: 12,
};

export type IllustratedMaterialOptions = {
  color: ColorRepresentation;
  /** The colour in shade. "world" lighting derives it from `color` (see shadeOf) when left out. */
  shadow?: ColorRepresentation;
  surfaceId?: number;
  outline?: number;
  grain?: number;
  lighting?: IllustratedLighting;
  /** "world" lighting only: painted marks on the surface, in `patternColor` at `patternStrength` (0..1, default 0.7). */
  pattern?: IllustratedPattern;
  patternColor?: ColorRepresentation;
  patternStrength?: number;
  /**
   * "world" lighting only: the painted patches of `pattern` (worn render, bare brick, light grass, bark camouflage)
   * count as their own surface, so the line pass inks round them as an illustrator would.
   */
  inkPatches?: boolean;
  /**
   * "world" lighting only: cut away wherever this surface hides the focus (the courier) from the camera, within
   * `illustratedEnvironment.uSeeThrough` units of the sight line. Meant for tree canopies, which the follow camera may
   * look through but not stand in.
   */
  seeThrough?: boolean;
  /**
   * "world" lighting only: take the base colour from the geometry's `color` attribute (linear RGB) instead of `color`,
   * and work out each vertex's shade from it. One material can then draw a whole figure in one call.
   */
  vertexColors?: boolean;
  /**
   * "world" lighting only: draw as a character. A hard light/shade cut instead of the soft one used for scenery, no
   * glancing highlight, and line breaks that stay put on the body as it moves (they follow the bind-pose position).
   */
  character?: boolean;
};

/**
 * Uniforms every "world"-lit material shares by reference, so a scene sets the sun, sky, fog, wind and time once a
 * frame. Fog is off (density 0) until a scene turns it on.
 */
export const illustratedEnvironment = {
  /** Toward the sun, world space (normalised by the shader). */
  uSunDirection: { value: new Vector3(0.45, 0.76, 0.47) },
  uFogNear: { value: new Color("#a3cfc8") },
  uFogFar: { value: new Color("#d3e6d8") },
  /** Squared-exponential fog: fog = 1 - exp(-(density * distance)^2). */
  uFogDensity: { value: 0 },
  /**
   * Light from the sky and the ground (linear RGB), added to every surface by how much it faces up or down. It lifts
   * the shade toward the sky's colour without flattening it, as reflected light does in a painting.
   */
  uSkyLight: { value: new Color(0.006, 0.02, 0.04) },
  uGroundLight: { value: new Color(0.007, 0.0065, 0.006) },
  /** Where scenery turns from shade to light, in sun-facing amount (0..1): a soft cut, so moving shadows stay calm. */
  uCut: { value: new Vector2(0.2, 0.4) },
  /** A crisp highlight added (linear) where a wall catches the sun at a glancing angle against the view. */
  uHighlight: { value: 0.075 },
  uTime: { value: 0 },
  /** Wind direction times strength: vertices with a `sway` weight move along it. */
  uWind: { value: new Vector3(0.9, 0, 0.35) },
  /** What must stay in view (the courier's chest), for `seeThrough` materials. */
  uFocus: { value: new Vector3() },
  /** Radius of the see-through cut around the camera-to-focus sight line, in world units (0 turns it off). */
  uSeeThrough: { value: 0 },
};

const ENVIRONMENT_DEFAULTS = {
  sun: illustratedEnvironment.uSunDirection.value.clone(),
  fogNear: illustratedEnvironment.uFogNear.value.clone(),
  fogFar: illustratedEnvironment.uFogFar.value.clone(),
  fogDensity: illustratedEnvironment.uFogDensity.value,
  skyLight: illustratedEnvironment.uSkyLight.value.clone(),
  groundLight: illustratedEnvironment.uGroundLight.value.clone(),
  cut: illustratedEnvironment.uCut.value.clone(),
  highlight: illustratedEnvironment.uHighlight.value,
  wind: illustratedEnvironment.uWind.value.clone(),
  focus: illustratedEnvironment.uFocus.value.clone(),
  seeThrough: illustratedEnvironment.uSeeThrough.value,
};

/** Put the shared environment back as it started (fog off, default sun and sky, time 0): a scene calls this when it goes. */
export function resetIllustratedEnvironment(): void {
  illustratedEnvironment.uSunDirection.value.copy(ENVIRONMENT_DEFAULTS.sun);
  illustratedEnvironment.uFogNear.value.copy(ENVIRONMENT_DEFAULTS.fogNear);
  illustratedEnvironment.uFogFar.value.copy(ENVIRONMENT_DEFAULTS.fogFar);
  illustratedEnvironment.uFogDensity.value = ENVIRONMENT_DEFAULTS.fogDensity;
  illustratedEnvironment.uSkyLight.value.copy(ENVIRONMENT_DEFAULTS.skyLight);
  illustratedEnvironment.uGroundLight.value.copy(ENVIRONMENT_DEFAULTS.groundLight);
  illustratedEnvironment.uCut.value.copy(ENVIRONMENT_DEFAULTS.cut);
  illustratedEnvironment.uHighlight.value = ENVIRONMENT_DEFAULTS.highlight;
  illustratedEnvironment.uWind.value.copy(ENVIRONMENT_DEFAULTS.wind);
  illustratedEnvironment.uTime.value = 0;
  illustratedEnvironment.uFocus.value.copy(ENVIRONMENT_DEFAULTS.focus);
  illustratedEnvironment.uSeeThrough.value = ENVIRONMENT_DEFAULTS.seeThrough;
}

/**
 * The colour of a surface in shade, from its lit colour (linear RGB): the same hue nudged a little toward red-orange
 * (−0.02 of a turn), the same saturation, half the value. Shade stays rich and coloured instead of greying out.
 */
export function shadeOf(color: ColorRepresentation): Color {
  const c = new Color(color);
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-9) {
    if (max === c.r) hue = ((c.g - c.b) / delta + 6) % 6;
    else if (max === c.g) hue = (c.b - c.r) / delta + 2;
    else hue = (c.r - c.g) / delta + 4;
    hue /= 6;
  }
  const saturation = max > 1e-9 ? delta / max : 0;
  return hsvToColor((hue - 0.02 + 1) % 1, saturation, max * 0.5);
}

function hsvToColor(h: number, s: number, v: number): Color {
  const channel = (offset: number) => {
    const p = Math.abs(((h + offset) % 1) * 6 - 3);
    return v * (1 + s * (Math.min(1, Math.max(0, p - 1)) - 1));
  };
  return new Color().setRGB(channel(1), channel(2 / 3), channel(1 / 3));
}

const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  #ifdef ILLUSTRATED_WORLD
    #include <shadowmap_pars_vertex>
  #endif

  /** 0 at roots and poles, 1 at the tips of grass and the free end of a flag: how far the wind moves a vertex. */
  in float sway;
  /** Added to the material's surface id, so one mesh can carry several outlined surfaces (a figure's clothes). */
  in float idShift;
  uniform float uTime;
  uniform vec3 uWind;

  out vec3 vViewNormal;
  out vec3 vWorldNormal;
  out vec3 vWorldPosition;
  out vec3 vBindPosition;
  out vec4 vClipPosition;
  out vec2 vUv;
  out float vIdShift;
  #ifdef ILLUSTRATED_VERTEX_COLORS
    out vec3 vBaseColor;
  #endif

  void main() {
    vUv = uv;
    vIdShift = idShift;
    vBindPosition = position;
    #ifdef ILLUSTRATED_VERTEX_COLORS
      vBaseColor = color;
    #endif
    vec3 objectNormal = vec3(normal);
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    vec3 transformed = vec3(position);
    #include <skinning_vertex>
    vec4 localPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      // As three does: undo each axis's squared scale first, so squashed instances keep true normals.
      mat3 im = mat3(instanceMatrix);
      objectNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
      objectNormal = im * objectNormal;
      localPosition = instanceMatrix * localPosition;
    #endif
    vec4 worldPosition = modelMatrix * localPosition;
    if (sway != 0.0) {
      float gust = sin(uTime * 1.9 + worldPosition.x * 0.09 + worldPosition.z * 0.13) * 0.6
        + sin(uTime * 3.3 + worldPosition.z * 0.21 - worldPosition.x * 0.05) * 0.4;
      worldPosition.xyz += uWind * (gust * sway);
    }
    vec3 transformedNormal = normalize(normalMatrix * objectNormal);
    vViewNormal = transformedNormal;
    vWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
    vWorldPosition = worldPosition.xyz;
    vClipPosition = projectionMatrix * viewMatrix * worldPosition;
    gl_Position = vClipPosition;
    #ifdef ILLUSTRATED_WORLD
      #include <shadowmap_vertex>
    #endif
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 outColor;
  layout(location = 1) out vec4 outInfo;

  #include <common>
  #ifdef ILLUSTRATED_WORLD
    #include <packing>
    #include <shadowmap_pars_fragment>
    uniform bool receiveShadow;
    uniform vec3 uSunDirection;
    uniform vec3 uFogNear;
    uniform vec3 uFogFar;
    uniform float uFogDensity;
    uniform vec3 uSkyLight;
    uniform vec3 uGroundLight;
    uniform vec2 uCut;
    uniform float uHighlight;
    uniform float uTime;
    uniform int uPattern;
    uniform vec3 uPatternColor;
    uniform float uPatternStrength;
    uniform float uInkPatches;
    uniform vec3 uFocus;
    uniform float uSeeThrough;
  #else
    uniform vec3 uLightDirection;
  #endif

  uniform vec3 uColor;
  uniform vec3 uShadow;
  uniform float uFade;
  uniform float uSurfaceId;
  uniform float uOutline;
  uniform float uGrain;
  in vec3 vViewNormal;
  in vec3 vWorldNormal;
  in vec3 vWorldPosition;
  in vec3 vBindPosition;
  in vec4 vClipPosition;
  in vec2 vUv;
  in float vIdShift;
  #ifdef ILLUSTRATED_VERTEX_COLORS
    in vec3 vBaseColor;
  #endif

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  /** Smooth 3D value noise in [0, 1]: soft blotches rather than blocky voxels. */
  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x);
    float b = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x);
    float c = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x);
    float d = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }

  #ifdef ILLUSTRATED_WORLD
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 rgbToHsv(vec3 c) {
    vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  vec3 hsvToRgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  /** Shade from light (see shadeOf in material.ts): same hue nudged toward red-orange, same saturation, half value. */
  vec3 shadeOf(vec3 lit) {
    vec3 hsv = rgbToHsv(lit);
    hsv.x = fract(hsv.x - 0.02 + 1.0);
    hsv.z *= 0.5;
    return hsvToRgb(hsv);
  }

  /** Surface coordinates in metres: across the ground for floors, along-the-wall and up for walls and roofs. */
  vec2 surfaceUv(vec3 p, vec3 n) {
    if (abs(n.y) > 0.8) return p.xz;
    vec2 t = length(n.xz) > 1e-4 ? normalize(vec2(-n.z, n.x)) : vec2(1.0, 0.0);
    return vec2(dot(p.xz, t), p.y);
  }

  /**
   * Running-bond courses (bricks, slates, flagstones, ashlar): 1 on a joint line 'width' metres wide, anti-aliased.
   * 'tone' is a per-unit shade in [-0.5, 0.5].
   */
  float courses(vec2 uv, vec2 size, float width, out float tone) {
    vec2 b = uv / size;
    float row = floor(b.y);
    b.x += mod(row, 2.0) * 0.5;
    vec2 f = fract(b);
    float d = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
    tone = hash12(floor(b)) - 0.5;
    float w = fwidth(d) * 0.75 + 1e-5;
    return 1.0 - smoothstep(width - w, width + w, d);
  }

  /** A hard-edged threshold of a smooth field, anti-aliased to a pixel. */
  float cut(float field, float at) {
    float w = fwidth(field) * 0.75 + 1e-5;
    return smoothstep(at - w, at + w, field);
  }

  /**
   * Painted surface marks. Returns how far to pull the colour toward the mark colour (x), a darkening toward the
   * shadow colour (y), a per-unit tone (z) and the painted area the marks sit in (w: 0..1, inked when the material
   * asks for it). Patterns: 1 brick, 2 slate, 3 flagstones, 4 ashlar, 5 grass, 6 water (animated), 7 leaves (animated
   * dapples), 8 hatching (in shade), 9 bark, 10 render (stucco worn back to brick), 11 camo (plane-tree bark).
   */
  vec4 paintedMarks(int pattern, vec3 p, vec3 n, float lit) {
    vec2 uv = surfaceUv(p, n);
    float tone = 0.0;
    // Illustrators suggest texture in patches rather than drawing every brick.
    float coverage = valueNoise(p * 0.07);
    if (pattern == 1) {
      float area = cut(coverage, 0.4);
      float line = courses(uv, vec2(1.1, 0.5), 0.05, tone);
      return vec4(line * area, 0.0, tone, area);
    }
    if (pattern == 2) {
      float area = cut(coverage, 0.25);
      float line = courses(uv, vec2(0.95, 0.45), 0.045, tone);
      return vec4(line * area, 0.0, tone, area);
    }
    if (pattern == 3) {
      float area = cut(coverage, 0.46);
      float line = courses(uv, vec2(1.7, 1.15), 0.05, tone);
      return vec4(line * area, 0.0, tone * 0.8, area);
    }
    if (pattern == 4) {
      float area = cut(coverage, 0.45);
      float line = courses(uv, vec2(2.3, 0.95), 0.04, tone);
      return vec4(line * area, 0.0, tone * 0.6, area);
    }
    if (pattern == 5) {
      // Two-tone sward: lighter patches with hard edges, and a scatter of short dark strokes.
      float light = cut(valueNoise(p * 0.11), 0.55);
      vec2 cell = floor(p.xz / 1.3);
      vec2 local = fract(p.xz / 1.3) - 0.5 - (vec2(hash12(cell), hash12(cell + 7.1)) - 0.5) * 0.5;
      float stroke = hash12(cell + 3.3) < 0.22 ? 1.0 - smoothstep(0.05, 0.09, length(local * vec2(5.0, 1.3))) : 0.0;
      return vec4(light * 0.55, stroke * 0.55, 0.0, light);
    }
    if (pattern == 6) {
      // Flowing water: hard-edged light streaks and thin ripple lines that drift with the current.
      vec2 q = p.xz * 0.07;
      float a = valueNoise(vec3(q + vec2(uTime * 0.05, uTime * 0.02), uTime * 0.06));
      float b = valueNoise(vec3(q * 2.4 - vec2(uTime * 0.04, -uTime * 0.03), uTime * 0.1 + 5.0));
      float band = a * 0.65 + b * 0.35;
      float streak = cut(band, 0.6);
      float w = fwidth(band) * 1.5 + 0.004;
      float ripple = 1.0 - smoothstep(0.0, w, abs(band - 0.42));
      return vec4(max(streak * 0.8, ripple * 0.55), 0.0, 0.0, 0.0);
    }
    if (pattern == 7) {
      // Dark dapples and light flecks, drifting slowly with the breeze.
      vec3 drift = vec3(uTime * 0.12, 0.0, uTime * 0.08);
      float dapple = cut(valueNoise(p * 0.42 + drift), 0.6);
      float fleck = cut(valueNoise(p * 0.8 - drift * 1.3 + 11.0), 0.68) * lit;
      return vec4(fleck * 0.75, dapple * 0.85, 0.0, dapple);
    }
    if (pattern == 8) {
      // Diagonal hatching, only in shade and only in patches.
      float s = fract((uv.x * 0.7 + uv.y) / 0.9);
      float d = min(s, 1.0 - s) * 0.9;
      float w = fwidth(d) * 0.75 + 1e-5;
      float line = 1.0 - smoothstep(0.07 - w, 0.07 + w, d);
      return vec4(line * cut(coverage, 0.45) * (1.0 - lit), 0.0, 0.0, 0.0);
    }
    if (pattern == 9) {
      // A few long vertical bark strokes, wavering and broken into patches.
      float s = fract(uv.x / 0.6 + valueNoise(vec3(p.x, p.y * 0.25, p.z)) * 0.5);
      float d = min(s, 1.0 - s) * 0.6;
      float w = fwidth(d) * 0.75 + 1e-5;
      return vec4((1.0 - smoothstep(0.045 - w, 0.045 + w, d)) * cut(valueNoise(p * 0.5), 0.45), 0.0, 0.0, 0.0);
    }
    if (pattern == 10) {
      // Painted stucco worn back to the brick behind it in a few ragged patches, each with its own courses.
      // Smaller chips high up, more wear toward the foot of the wall where it is knocked and damp.
      float worn = valueNoise(p * 0.5 + vec3(3.1, 0.0, 7.7)) * 0.7 + valueNoise(p * 1.7) * 0.3;
      worn += (1.0 - smoothstep(0.5, 4.0, p.y)) * 0.08;
      float area = cut(worn, 0.76);
      float line = courses(uv, vec2(1.1, 0.5), 0.05, tone);
      return vec4(area * (0.82 + line * 0.18), line * area * 0.6, tone * area, area);
    }
    if (pattern == 12) {
      // Tarmac: darker patched repairs in rough rectangles here and there, and a few long thin cracks.
      vec2 grid = vec2(7.0, 4.5);
      vec2 cell = floor(uv / grid);
      vec2 inCell = fract(uv / grid);
      vec2 size = vec2(0.35 + hash12(cell + 2.1) * 0.5, 0.3 + hash12(cell + 5.3) * 0.5);
      vec2 middle = 0.5 + (vec2(hash12(cell + 7.7), hash12(cell + 9.1)) - 0.5) * (1.0 - size);
      vec2 d = abs(inCell - middle) - size * 0.5;
      float edge = max(d.x, d.y);
      float aa = fwidth(edge) + 1e-4;
      float repair = (1.0 - smoothstep(-aa, aa, edge)) * step(hash12(cell + 0.37), 0.3);
      float vein = valueNoise(vec3(uv * 0.32, 0.0));
      float vw = fwidth(vein) * 1.1 + 1e-4;
      float crack = (1.0 - smoothstep(0.0, vw, abs(vein - 0.5))) * cut(valueNoise(vec3(uv * 0.11, 3.0)), 0.62);
      return vec4(0.0, repair * 0.42 + crack * 0.4, 0.0, 0.0);
    }
    if (pattern == 11) {
      // Plane-tree bark: jigsaw flakes of pale new bark on the darker old.
      float flakes = valueNoise(vec3(p.x * 1.1, p.y * 0.45, p.z * 1.1)) * 0.7 + valueNoise(p * 2.6) * 0.3;
      float area = cut(flakes, 0.55);
      return vec4(area * 0.9, 0.0, 0.0, area);
    }
    return vec4(0.0);
  }

  /** The size of one pattern unit in metres: below a fraction of it per pixel the marks fade (far views stay calm). */
  float patternCell(int pattern) {
    if (pattern == 1) return 0.5;
    if (pattern == 2) return 0.45;
    if (pattern == 3) return 1.1;
    if (pattern == 4) return 0.95;
    if (pattern == 5) return 1.3;
    if (pattern == 6) return 4.0;
    if (pattern == 7) return 2.0;
    if (pattern == 8) return 0.9;
    if (pattern == 10) return 1.4;
    if (pattern == 11) return 0.9;
    if (pattern == 12) return 3.0;
    return 0.6;
  }

  /**
   * Where the ink may be drawn (1) or is left out (0): illustrators lift the pen now and then, so long contours break
   * into strokes. Two noise fields multiplied give irregular gaps of a few tens of centimetres. Characters use their
   * bind-pose position, so a gap stays on the same bit of sleeve while the arm swings.
   */
  float lineBreak(vec3 p, float scale, float threshold) {
    float a = valueNoise(p * scale);
    float b = valueNoise(p * scale * 1.7 + vec3(5.2, 1.3, 7.7));
    return step(threshold, a * b);
  }
  #endif

  vec2 encodeNormal(vec3 normal) {
    float scale = inversesqrt(max(0.001, 8.0 * normal.z + 8.0));
    return normal.xy * scale + 0.5;
  }

  void main() {
    vec3 viewNormal = normalize(vViewNormal);
    float surfaceId = uSurfaceId + vIdShift;
    float lineMask = uOutline;
    #ifdef ILLUSTRATED_WORLD
      vec3 worldNormal = normalize(vWorldNormal);
      vec3 toSun = normalize(uSunDirection);
      float facing = dot(worldNormal, toSun);
      #ifdef ILLUSTRATED_VERTEX_COLORS
        vec3 base = vBaseColor;
        vec3 shade = shadeOf(vBaseColor);
      #else
        vec3 base = uColor;
        vec3 shade = uShadow;
      #endif

      // How much sun reaches the surface: its facing times the cast-shadow term.
      float sunlight = max(facing, 0.0);
      float castShadow = 1.0;
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        if (receiveShadow) {
          DirectionalLightShadow sun = directionalLightShadows[0];
          float shadowTerm = getShadow(directionalShadowMap[0], sun.shadowMapSize, sun.shadowIntensity, sun.shadowBias, sun.shadowRadius, vDirectionalShadowCoord[0]);
          // Fade out toward the shadow map's border, so shadows do not pop in at the edge of the fitted square.
          vec3 coord = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
          float border = smoothstep(0.0, 0.08, min(min(coord.x, 1.0 - coord.x), min(coord.y, 1.0 - coord.y)));
          castShadow = mix(1.0, shadowTerm, border);
        }
      #endif
      sunlight *= castShadow;

      // The cut between shade and light: soft on scenery (moving shadows and curved walls stay calm), hard on
      // characters (they read as drawn figures against the street).
      #ifdef ILLUSTRATED_CHARACTER
        float aa = fwidth(sunlight) * 0.75 + 1e-4;
        float lit = smoothstep(0.1 - aa, 0.15 + aa, sunlight);
      #else
        float lit = smoothstep(uCut.x, uCut.y, sunlight);
      #endif
      vec3 color = mix(shade, base, lit);

      // Painted value patches: broad hard-edged areas a shade darker or lighter, as in a gouache wash.
      float footprint = length(fwidth(vWorldPosition));
      if (uGrain > 0.0) {
        float closeness = 1.0 - smoothstep(6.0, 16.0, footprint);
        float darker = cut(valueNoise(vWorldPosition * 0.045 + vec3(1.7, 0.0, 4.1)), 0.68);
        float lighter = cut(valueNoise(vWorldPosition * 0.08 + vec3(9.2, 3.3, 0.6)), 0.38);
        float swing = clamp(uGrain * 2.0, 0.0, 0.14) * closeness;
        color *= 1.0 - swing * darker * 0.9 + swing * lighter * 0.6;
      }

      float area = 0.0;
      if (uPattern > 0 && uPatternStrength > 0.0) {
        float cell = patternCell(uPattern);
        float fade = 1.0 - smoothstep(cell * 0.08, cell * 0.28, footprint);
        // Always evaluated (the branch above depends on uniforms only): the marks take screen-space derivatives,
        // which are undefined inside a branch that differs between neighbouring pixels. Far away, fade is 0.
        vec4 marks = paintedMarks(uPattern, vWorldPosition, worldNormal, lit);
        // Marks take the light of the surface they sit on, so they never glow in shade.
        vec3 markColor = uPatternColor * mix(shade / max(base, vec3(0.04)), vec3(1.0), lit);
        color *= 1.0 + marks.z * 0.07 * fade;
        color = mix(color, markColor, clamp(marks.x * uPatternStrength * fade, 0.0, 1.0));
        color = mix(color, shade * 0.88, clamp(marks.y * uPatternStrength * fade, 0.0, 1.0));
        // A area drawn as its own surface gets its own outline; it fades with the marks so far walls stay calm.
        area = marks.w * step(0.5, fade) * uInkPatches;
      }
      surfaceId += area * 0.006;

      #ifndef ILLUSTRATED_CHARACTER
        // A crisp glancing highlight where a wall faces the sun and the view looks into the light (never on floors).
        vec3 toView = normalize(cameraPosition - vWorldPosition);
        vec3 halfway = normalize(toSun + toView);
        float glance = pow(1.0 - max(dot(toView, halfway), 0.0), 5.0) * sunlight * max(dot(worldNormal, halfway), 0.0);
        float wall = clamp((0.95 - worldNormal.y) / 0.05, 0.0, 1.0);
        color += uHighlight * smoothstep(0.03, 0.034, glance) * wall;
        lineMask *= lineBreak(vWorldPosition, 0.55, 0.06);
      #else
        lineMask *= lineBreak(vBindPosition + vec3(surfaceId * 31.0), 1.8, 0.06);
      #endif

      // Sky and ground light, by how much the surface faces up.
      color += mix(uGroundLight, uSkyLight, 0.5 + 0.5 * worldNormal.y);

      // Squared-exponential fog, near colour turning to the far (horizon) colour with distance.
      float depth = uFogDensity * length(vWorldPosition - cameraPosition);
      float fog = 1.0 - exp(-depth * depth);
      color = mix(color, mix(uFogNear, uFogFar, smoothstep(0.0, 0.8, fog)), fog);
    #else
      float light = dot(viewNormal, normalize(uLightDirection));
      // One hard cel band, anti-aliased over about a pixel.
      float edge = max(fwidth(light), 1e-4) * 1.5;
      float lit = smoothstep(0.08 - edge, 0.08 + edge, light);
      // Painterly variation: broad soft blotches with a little finer mottling. Each fades out where it would be finer
      // than a pixel (far away), so distant surfaces stay calm instead of sparkling.
      vec3 color = mix(uShadow, uColor, lit);
      if (uGrain > 0.0) {
        float footprint = length(fwidth(vWorldPosition));
        float blotch = (valueNoise(vWorldPosition * 0.06) - 0.5) * (1.0 - smoothstep(4.0, 12.0, footprint));
        float mottle = (valueNoise(vWorldPosition * 0.45) - 0.5) * (1.0 - smoothstep(0.6, 1.6, footprint));
        color += (blotch * 0.8 + mottle * 0.35) * uGrain * 2.2;
      }
    #endif

    #ifdef ILLUSTRATED_CHARACTER
      // Dissolve (0..1): a camera pinned right behind a character would see nothing but its back, so the character
      // opens into a lattice of growing round holes (in bind-pose space, so they stay on the body) and the street
      // shows through. Last in main, after every derivative.
      if (uFade > 0.0) {
        vec3 cell = mod(vBindPosition + 0.04, 0.16) - 0.08;
        if (length(cell) / 0.08 < uFade * 1.85) discard;
      }
    #endif
    #ifdef ILLUSTRATED_SEE_THROUGH
      // Cut a window around the sight line from the camera to the focus (wider toward the camera, so it reads as a
      // round opening around the courier), but only above about chest height minus 0.6: canopies always start well
      // above the ground, while grass tufts in the same material stay put. The line pass inks the cut's rim.
      // Last in main, so every derivative above is taken with the whole pixel quad still running.
      if (uSeeThrough > 0.0 && vWorldPosition.y > uFocus.y - 0.6) {
        vec3 sight = uFocus - cameraPosition;
        float t = dot(vWorldPosition - cameraPosition, sight) / max(dot(sight, sight), 1e-6);
        if (t > 0.0 && t < 1.0 && distance(vWorldPosition, cameraPosition + sight * t) < uSeeThrough * mix(1.5, 1.0, t)) discard;
      }
    #endif
    float reversedDepth = 1.0 - (0.5 * vClipPosition.z / vClipPosition.w + 0.5);
    outColor = vec4(color, surfaceId);
    outInfo = vec4(reversedDepth, encodeNormal(viewNormal), lineMask);
  }
`;

const SHARED_WORLD_UNIFORMS = [
  "uSunDirection", "uFogNear", "uFogFar", "uFogDensity", "uSkyLight", "uGroundLight", "uCut", "uHighlight", "uTime", "uWind",
  "uFocus", "uSeeThrough",
] as const;

export function createIllustratedMaterial(options: IllustratedMaterialOptions) {
  const base = new Color(options.color);
  const world = options.lighting === "world";
  // In the world the shade follows the colour by rule (see shadeOf), unless a swatch asks for something else.
  const shadow = options.shadow ? new Color(options.shadow) : world ? shadeOf(base) : base.clone().offsetHSL(-0.02, 0.04, -0.28);
  const defines: Record<string, string> = {};
  if (world) {
    defines.ILLUSTRATED_WORLD = "";
    if (options.seeThrough) defines.ILLUSTRATED_SEE_THROUGH = "";
    if (options.vertexColors) defines.ILLUSTRATED_VERTEX_COLORS = "";
    if (options.character) defines.ILLUSTRATED_CHARACTER = "";
  }
  const material = new ShaderMaterial({
    name: "ClockworkIllustratedMaterial",
    glslVersion: GLSL3,
    lights: world,
    defines,
    // The colour attribute is only declared (USE_COLOR) when the material asks for vertex colours.
    vertexColors: world && options.vertexColors === true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      ...(world ? [UniformsLib.lights] : []),
      {
        uColor: { value: base },
        uShadow: { value: shadow },
        uFade: { value: 0 },
        uSurfaceId: { value: options.surfaceId ?? 0.3 },
        uOutline: { value: options.outline ?? 1 },
        uGrain: { value: options.grain ?? 0.035 },
        uPattern: { value: PATTERN_IDS[options.pattern ?? "none"] },
        uPatternColor: { value: new Color(options.patternColor ?? options.shadow ?? base) },
        uPatternStrength: { value: options.patternStrength ?? 0.7 },
        uInkPatches: { value: options.inkPatches ? 1 : 0 },
        uLightDirection: { value: { x: 0.45, y: 0.76, z: 0.47 } },
        uTime: { value: 0 },
        uWind: { value: new Vector3() },
        uFocus: { value: new Vector3() },
        uSeeThrough: { value: 0 },
      },
    ]),
    vertexShader,
    fragmentShader,
  });
  // Geometry without a `sway` or `idShift` attribute (nearly everything) reads 0: it stays still and keeps the
  // material's surface id. (three's types list only colour and uv, but the renderer reads this map for any attribute.)
  const defaults = material.defaultAttributeValues as Record<string, number[]>;
  defaults.sway = [0];
  defaults.idShift = [0];
  if (world) for (const name of SHARED_WORLD_UNIFORMS) material.uniforms[name] = illustratedEnvironment[name];
  return material;
}
