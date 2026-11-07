import {
  Color,
  GLSL3,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type ColorRepresentation,
} from "three";

/**
 * "view" (the default): the classic headlight look, lit from the camera's upper right; nothing else in the scene needed.
 * "world": a sun fixed in the world, with cast shadows from a DirectionalLight and fog, all driven by the shared
 * `illustratedEnvironment` uniforms (the hill town).
 */
export type IllustratedLighting = "view" | "world";

/** Painted surface marks drawn by "world" materials (see the fragment shader's paintedMarks). */
export type IllustratedPattern = "none" | "brick" | "slate" | "flags" | "ashlar" | "grass" | "water" | "leaves" | "hatch" | "bark";
export const PATTERN_IDS: Readonly<Record<IllustratedPattern, number>> = {
  none: 0, brick: 1, slate: 2, flags: 3, ashlar: 4, grass: 5, water: 6, leaves: 7, hatch: 8, bark: 9,
};

export type IllustratedMaterialOptions = {
  color: ColorRepresentation;
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
   * "world" lighting only: cut away wherever this surface hides the focus (the courier) from the camera, within
   * `illustratedEnvironment.uSeeThrough` units of the sight line. Meant for tree canopies, which the follow camera may
   * look through but not stand in.
   */
  seeThrough?: boolean;
};

/**
 * Uniforms every "world"-lit material shares by reference, so a scene sets the sun, fog, wind and time once a frame.
 * Fog is off (density 0) until a scene turns it on.
 */
export const illustratedEnvironment = {
  /** Toward the sun, world space (normalised by the shader). */
  uSunDirection: { value: new Vector3(0.45, 0.76, 0.47) },
  uFogNear: { value: new Color("#a3cfc8") },
  uFogFar: { value: new Color("#d3e6d8") },
  /** Squared-exponential fog: fog = 1 - exp(-(density * distance)^2). */
  uFogDensity: { value: 0 },
  /** How much shaded faces that look up catch sky light (0..1). */
  uSkyFill: { value: 0.22 },
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
  skyFill: illustratedEnvironment.uSkyFill.value,
  wind: illustratedEnvironment.uWind.value.clone(),
  focus: illustratedEnvironment.uFocus.value.clone(),
  seeThrough: illustratedEnvironment.uSeeThrough.value,
};

/** Put the shared environment back as it started (fog off, default sun, time 0): a scene calls this when it goes. */
export function resetIllustratedEnvironment(): void {
  illustratedEnvironment.uSunDirection.value.copy(ENVIRONMENT_DEFAULTS.sun);
  illustratedEnvironment.uFogNear.value.copy(ENVIRONMENT_DEFAULTS.fogNear);
  illustratedEnvironment.uFogFar.value.copy(ENVIRONMENT_DEFAULTS.fogFar);
  illustratedEnvironment.uFogDensity.value = ENVIRONMENT_DEFAULTS.fogDensity;
  illustratedEnvironment.uSkyFill.value = ENVIRONMENT_DEFAULTS.skyFill;
  illustratedEnvironment.uWind.value.copy(ENVIRONMENT_DEFAULTS.wind);
  illustratedEnvironment.uTime.value = 0;
  illustratedEnvironment.uFocus.value.copy(ENVIRONMENT_DEFAULTS.focus);
  illustratedEnvironment.uSeeThrough.value = ENVIRONMENT_DEFAULTS.seeThrough;
}

const vertexShader = /* glsl */ `
  #include <common>
  #ifdef ILLUSTRATED_WORLD
    #include <shadowmap_pars_vertex>
  #endif

  /** 0 at roots and poles, 1 at the tips of grass and the free end of a flag: how far the wind moves a vertex. */
  in float sway;
  uniform float uTime;
  uniform vec3 uWind;

  out vec3 vViewNormal;
  out vec3 vWorldNormal;
  out vec3 vWorldPosition;
  out vec4 vClipPosition;
  out vec2 vUv;

  void main() {
    vUv = uv;
    vec3 objectNormal = normal;
    vec4 localPosition = vec4(position, 1.0);
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
    uniform float uSkyFill;
    uniform float uTime;
    uniform int uPattern;
    uniform vec3 uPatternColor;
    uniform float uPatternStrength;
    uniform vec3 uFocus;
    uniform float uSeeThrough;
  #else
    uniform vec3 uLightDirection;
  #endif

  uniform vec3 uColor;
  uniform vec3 uShadow;
  uniform float uSurfaceId;
  uniform float uOutline;
  uniform float uGrain;
  in vec3 vViewNormal;
  in vec3 vWorldNormal;
  in vec3 vWorldPosition;
  in vec4 vClipPosition;
  in vec2 vUv;

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
   * shadow colour (y) and a per-unit tone (z). Patterns: 1 brick, 2 slate, 3 flagstones, 4 ashlar, 5 grass,
   * 6 water (animated), 7 leaves (animated dapples), 8 hatching (in shade), 9 bark.
   */
  vec3 paintedMarks(int pattern, vec3 p, vec3 n, float lit) {
    vec2 uv = surfaceUv(p, n);
    float tone = 0.0;
    // Illustrators suggest texture in patches rather than drawing every brick.
    float coverage = valueNoise(p * 0.07);
    if (pattern == 1) {
      float line = courses(uv, vec2(1.1, 0.5), 0.05, tone);
      return vec3(line * cut(coverage, 0.4), 0.0, tone);
    }
    if (pattern == 2) {
      float line = courses(uv, vec2(0.95, 0.45), 0.045, tone);
      return vec3(line * cut(coverage, 0.25), 0.0, tone);
    }
    if (pattern == 3) {
      float line = courses(uv, vec2(1.7, 1.15), 0.05, tone);
      return vec3(line * cut(coverage, 0.46), 0.0, tone * 0.8);
    }
    if (pattern == 4) {
      float line = courses(uv, vec2(2.3, 0.95), 0.04, tone);
      return vec3(line * cut(coverage, 0.45), 0.0, tone * 0.6);
    }
    if (pattern == 5) {
      // Two-tone sward: lighter patches with hard edges, and a scatter of short dark strokes.
      float light = cut(valueNoise(p * 0.11), 0.55);
      vec2 cell = floor(p.xz / 1.3);
      vec2 local = fract(p.xz / 1.3) - 0.5 - (vec2(hash12(cell), hash12(cell + 7.1)) - 0.5) * 0.5;
      float stroke = hash12(cell + 3.3) < 0.22 ? 1.0 - smoothstep(0.05, 0.09, length(local * vec2(5.0, 1.3))) : 0.0;
      return vec3(light * 0.55, stroke * 0.55, 0.0);
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
      return vec3(max(streak * 0.8, ripple * 0.55), 0.0, 0.0);
    }
    if (pattern == 7) {
      // Dark dapples and light flecks, drifting slowly with the breeze.
      vec3 drift = vec3(uTime * 0.12, 0.0, uTime * 0.08);
      float dapple = cut(valueNoise(p * 0.42 + drift), 0.6);
      float fleck = cut(valueNoise(p * 0.8 - drift * 1.3 + 11.0), 0.68) * lit;
      return vec3(fleck * 0.75, dapple * 0.85, 0.0);
    }
    if (pattern == 8) {
      // Diagonal hatching, only in shade and only in patches.
      float s = fract((uv.x * 0.7 + uv.y) / 0.9);
      float d = min(s, 1.0 - s) * 0.9;
      float w = fwidth(d) * 0.75 + 1e-5;
      float line = 1.0 - smoothstep(0.07 - w, 0.07 + w, d);
      return vec3(line * cut(coverage, 0.45) * (1.0 - lit), 0.0, 0.0);
    }
    if (pattern == 9) {
      // A few long vertical bark strokes, wavering and broken into patches.
      float s = fract(uv.x / 0.6 + valueNoise(vec3(p.x, p.y * 0.25, p.z)) * 0.5);
      float d = min(s, 1.0 - s) * 0.6;
      float w = fwidth(d) * 0.75 + 1e-5;
      return vec3((1.0 - smoothstep(0.045 - w, 0.045 + w, d)) * cut(valueNoise(p * 0.5), 0.45), 0.0, 0.0);
    }
    return vec3(0.0);
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
    return 0.6;
  }
  #endif

  vec2 encodeNormal(vec3 normal) {
    float scale = inversesqrt(max(0.001, 8.0 * normal.z + 8.0));
    return normal.xy * scale + 0.5;
  }

  void main() {
    vec3 viewNormal = normalize(vViewNormal);
    #ifdef ILLUSTRATED_WORLD
      vec3 worldNormal = normalize(vWorldNormal);
      float light = dot(worldNormal, normalize(uSunDirection));
    #else
      float light = dot(viewNormal, normalize(uLightDirection));
    #endif

    // One hard cel band, anti-aliased over about a pixel.
    float edge = max(fwidth(light), 1e-4) * 1.5;
    float lit = smoothstep(0.08 - edge, 0.08 + edge, light);

    #ifdef ILLUSTRATED_WORLD
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        if (receiveShadow) {
          DirectionalLightShadow sun = directionalLightShadows[0];
          float shade = getShadow(directionalShadowMap[0], sun.shadowMapSize, sun.shadowIntensity, sun.shadowBias, sun.shadowRadius, vDirectionalShadowCoord[0]);
          // Fade out toward the shadow map's border, so shadows do not pop in at the edge of the fitted square.
          vec3 coord = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
          float border = smoothstep(0.0, 0.08, min(min(coord.x, 1.0 - coord.x), min(coord.y, 1.0 - coord.y)));
          shade = mix(1.0, shade, border);
          // Cast shadows as crisp as the cel band: they are drawn, not blurred.
          lit *= smoothstep(0.35, 0.65, shade);
        }
      #endif
    #endif

    // Painterly variation: broad soft blotches with a little finer mottling. Each fades out where it would be finer
    // than a pixel (far away), so distant surfaces stay calm instead of sparkling.
    vec3 color = mix(uShadow, uColor, lit);
    if (uGrain > 0.0) {
      float footprint = length(fwidth(vWorldPosition));
      float blotch = (valueNoise(vWorldPosition * 0.06) - 0.5) * (1.0 - smoothstep(4.0, 12.0, footprint));
      float mottle = (valueNoise(vWorldPosition * 0.45) - 0.5) * (1.0 - smoothstep(0.6, 1.6, footprint));
      color += (blotch * 0.8 + mottle * 0.35) * uGrain * 2.2;
    }

    #ifdef ILLUSTRATED_WORLD
      if (uPattern > 0 && uPatternStrength > 0.0) {
        float cell = patternCell(uPattern);
        float footprint = length(fwidth(vWorldPosition));
        float fade = 1.0 - smoothstep(cell * 0.08, cell * 0.28, footprint);
        // Always evaluated (the branch above depends on uniforms only): the marks take screen-space derivatives,
        // which are undefined inside a branch that differs between neighbouring pixels. Far away, fade is 0.
        vec3 marks = paintedMarks(uPattern, vWorldPosition, worldNormal, lit) * fade;
        // Marks take the light of the surface they sit on, so they never glow in shade.
        vec3 markColor = uPatternColor * mix(uShadow / max(uColor, vec3(0.04)), vec3(1.0), lit);
        color *= 1.0 + marks.z * 0.07;
        color = mix(color, markColor, clamp(marks.x * uPatternStrength, 0.0, 1.0));
        color = mix(color, uShadow * 0.88, clamp(marks.y * uPatternStrength, 0.0, 1.0));
      }
      // Shaded faces that look up catch a little of the sky.
      color += (1.0 - lit) * max(worldNormal.y, 0.0) * uSkyFill * (uColor - uShadow);
      // Squared-exponential fog, near colour turning to the far (horizon) colour with distance.
      float depth = uFogDensity * length(vWorldPosition - cameraPosition);
      float fog = 1.0 - exp(-depth * depth);
      color = mix(color, mix(uFogNear, uFogFar, smoothstep(0.0, 1.0, fog)), fog);
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
    outColor = vec4(color, uSurfaceId);
    outInfo = vec4(reversedDepth, encodeNormal(viewNormal), uOutline);
  }
`;

const SHARED_WORLD_UNIFORMS = ["uSunDirection", "uFogNear", "uFogFar", "uFogDensity", "uSkyFill", "uTime", "uWind", "uFocus", "uSeeThrough"] as const;

export function createIllustratedMaterial(options: IllustratedMaterialOptions) {
  const base = new Color(options.color);
  const shadow = options.shadow ? new Color(options.shadow) : base.clone().offsetHSL(-0.02, 0.04, -0.28);
  const world = options.lighting === "world";
  const material = new ShaderMaterial({
    name: "ClockworkIllustratedMaterial",
    glslVersion: GLSL3,
    lights: world,
    defines: world ? { ILLUSTRATED_WORLD: "", ...(options.seeThrough ? { ILLUSTRATED_SEE_THROUGH: "" } : {}) } : {},
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      ...(world ? [UniformsLib.lights] : []),
      {
        uColor: { value: base },
        uShadow: { value: shadow },
        uSurfaceId: { value: options.surfaceId ?? 0.3 },
        uOutline: { value: options.outline ?? 1 },
        uGrain: { value: options.grain ?? 0.035 },
        uPattern: { value: PATTERN_IDS[options.pattern ?? "none"] },
        uPatternColor: { value: new Color(options.patternColor ?? options.shadow ?? base) },
        uPatternStrength: { value: options.patternStrength ?? 0.7 },
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
  // Geometry without a `sway` attribute (nearly everything) reads 0 and stays still.
  // (three's types list only colour and uv, but the renderer reads this map for any attribute the geometry lacks.)
  (material.defaultAttributeValues as Record<string, number[]>).sway = [0];
  if (world) for (const name of SHARED_WORLD_UNIFORMS) material.uniforms[name] = illustratedEnvironment[name];
  return material;
}
