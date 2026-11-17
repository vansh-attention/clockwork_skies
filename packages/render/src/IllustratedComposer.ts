import {
  Camera,
  ClampToEdgeWrapping,
  Data3DTexture,
  DepthTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

import { createDepthPrepassMaterial, DEPTH_PREPASS_LAYER } from "./material.js";

export type DebugView = "final" | "color" | "surface-id" | "depth" | "normals" | "mask";

/** A colour grade: maps a display (sRGB, 0..1) colour to the display colour it should become. */
export type GradeFunction = (r: number, g: number, b: number) => readonly [number, number, number];

/**
 * Bakes a grade into a size^3 colour look-up table (8 bits a channel, trilinear filtered) for the composer's `lut`
 * style. The caller owns the texture and disposes of it.
 */
export function createGradeLut(grade: GradeFunction, size = 33): Data3DTexture {
  const n = Math.max(2, Math.min(64, Math.round(size)));
  const data = new Uint8Array(n * n * n * 4);
  const byte = (value: number) => Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255);
  for (let b = 0; b < n; b += 1) for (let g = 0; g < n; g += 1) for (let r = 0; r < n; r += 1) {
    const [gr, gg, gb] = grade(r / (n - 1), g / (n - 1), b / (n - 1));
    const i = ((b * n + g) * n + r) * 4;
    data[i] = byte(gr); data[i + 1] = byte(gg); data[i + 2] = byte(gb); data[i + 3] = 255;
  }
  const texture = new Data3DTexture(data, n, n, n);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** A table that changes nothing, owned (and disposed of) by the composer. */
function identityLut(size: number): Data3DTexture {
  const texture = createGradeLut((r, g, b) => [r, g, b], size);
  texture.userData.composerOwned = true;
  return texture;
}

const outlineVertex = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const outlineFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tInfo;
  uniform sampler2D tDepth;
  uniform highp sampler3D tLut;
  uniform vec2 uResolution;
  uniform vec3 uInk;
  uniform float uThickness;
  uniform float uNear;
  uniform float uFar;
  uniform bool uOrthographic;
  uniform float uFadeNear;
  uniform float uFadeFar;
  uniform float uFadeMin;
  uniform float uInkTint;
  uniform float uGrade;
  uniform float uLut;
  uniform float uLutSize;
  uniform int uLines;
  uniform float uBoil;
  uniform float uBoilFrame;
  uniform int uDebug;
  uniform mat4 uUnproject;
  uniform float uLutDirect;
  uniform float uSmoothOut;
  in vec2 vUv;
  out vec4 outColor;

  // Every lookup below names level 0 (these buffers have no other): it reads the same texel as a plain lookup but
  // needs no screen-space derivatives, so the GPU may skip the lookups of whichever branch a pixel does not take.

  /** View distance for a depth-buffer value (the far plane where nothing was drawn). */
  float viewDistance(float d) {
    if (uOrthographic) return uNear + d * (uFar - uNear);
    float z = d * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }

  /** View distance of the surface at uv. */
  float linearDepth(vec2 uv) {
    return viewDistance(textureLod(tDepth, uv, 0.0).r);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  /** Smooth 3D value noise in 0..1: the very field the materials paint with (material.ts valueNoise). */
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

  /** Where in the world the surface seen at uv is, from its depth-buffer value. */
  vec3 worldAt(vec2 uv, float d) {
    vec4 p = uUnproject * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }

  /**
   * The line breaks of scenery: 1 where the pen draws, 0 in the gaps where an illustrator lifts it, by place in the
   * world (two noise fields multiplied give irregular gaps of a few tens of centimetres). Scenery materials ask for
   * them (the first channel of their info buffer is 1) rather than working them out on every pixel of every wall;
   * here they cost only the pixels a line crosses. Characters break their own lines, on the body, and write 0.
   */
  float worldLineBreak(vec3 p) {
    float a = valueNoise(p * 0.55);
    float b = valueNoise(p * 0.55 * 1.7 + vec3(5.2, 1.3, 7.7));
    return step(0.06, a * b);
  }

  /** Inverse of the materials' encodeNormal (a Lambert azimuthal projection of the view-space normal). */
  vec3 decodeNormal(vec2 encoded) {
    vec2 f = encoded * 4.0 - 2.0;
    float l = dot(f, f);
    return vec3(f * sqrt(max(0.0, 1.0 - l / 4.0)), 1.0 - l / 2.0);
  }

  /**
   * "Drawn" lines, as an illustrator inks them: sample a small cross around the pixel and draw where the surface,
   * its distance or its facing changes across it. The pen pressure (the mask a material writes) is taken from the
   * nearest of the samples, so a silhouette is inked with the stroke of whatever stands in front, gaps included.
   * Depth steps count relative to distance and need to be bigger on surfaces seen edge-on (a long street seen at a
   * grazing angle does not sprout lines).
   */
  float drawnEdgeAt(vec2 uv, float centreId, vec4 centreInfo, float centreRaw) {
    vec2 px = uThickness * clamp(uResolution.y / 1000.0, 0.8, 1.8) / uResolution;
    vec2 offsets[5] = vec2[5](vec2(0.0), vec2(-px.x, 0.0), vec2(px.x, 0.0), vec2(0.0, -px.y), vec2(0.0, px.y));
    float ids[5];
    float raws[5];
    float depths[5];
    float masks[5];
    float breaks[5];
    vec3 normals[5];
    // The middle of the cross was read already (in main); the four arms are read here.
    ids[0] = centreId;
    raws[0] = centreRaw;
    depths[0] = viewDistance(centreRaw);
    normals[0] = decodeNormal(centreInfo.gb);
    masks[0] = centreInfo.a;
    breaks[0] = centreInfo.r;
    for (int i = 1; i < 5; i++) {
      vec2 at = uv + offsets[i];
      vec4 info = textureLod(tInfo, at, 0.0);
      ids[i] = textureLod(tColor, at, 0.0).a;
      raws[i] = textureLod(tDepth, at, 0.0).r;
      depths[i] = viewDistance(raws[i]);
      normals[i] = decodeNormal(info.gb);
      masks[i] = info.a;
      breaks[i] = info.r;
    }
    float idChange = length(vec2(ids[1] - ids[2], ids[3] - ids[4]));
    float depthChange = length(vec2(depths[1] - depths[2], depths[3] - depths[4])) / max(depths[0], 1e-3);
    vec3 n = normals[0];
    float normalChange = length(vec2(distance(normals[1], n) - distance(normals[2], n), distance(normals[3], n) - distance(normals[4], n)));
    float edgeOn = 1.0 + (1.0 - clamp(n.z, 0.0, 1.0)) * 5.0;
    float edge = smoothstep(0.0012, 0.0026, idChange)
      + smoothstep(0.045 * edgeOn, 0.075 * edgeOn, depthChange)
      + smoothstep(0.32, 0.5, normalChange);
    float mask = masks[0];
    float nearest = depths[0];
    int front = 0;
    for (int i = 1; i < 5; i++) {
      if (depths[i] < nearest) { nearest = depths[i]; mask = masks[i]; front = i; }
    }
    float amount = clamp(edge, 0.0, 1.0) * max(mask, 0.0);
    // The pen lifts of scenery, at the place the stroke belongs to (whatever stands in front): only where a line is drawn.
    if (amount > 0.0 && breaks[front] > 0.5) amount *= worldLineBreak(worldAt(uv + offsets[front], raws[front]));
    return amount;
  }

  float edgeAt(vec2 uv, float centreDepth, vec4 c, vec4 i, float centreRaw) {
    if (uLines == 1) return drawnEdgeAt(uv, c.a, i, centreRaw);
    // Lines keep the same on-screen weight at any resolution.
    vec2 px = uThickness * clamp(uResolution.y / 1000.0, 0.8, 1.8) / uResolution;
    vec4 cl = textureLod(tColor, uv - vec2(px.x, 0.0), 0.0);
    vec4 cr = textureLod(tColor, uv + vec2(px.x, 0.0), 0.0);
    vec4 il = textureLod(tInfo, uv - vec2(px.x, 0.0), 0.0);
    vec4 ir = textureLod(tInfo, uv + vec2(px.x, 0.0), 0.0);
    vec4 id = textureLod(tInfo, uv - vec2(0.0, px.y), 0.0);
    vec4 iu = textureLod(tInfo, uv + vec2(0.0, px.y), 0.0);
    float idEdge = max(abs(cl.a - c.a), abs(cr.a - c.a)) * 9.0;
    // Depth steps relative to distance: the same jump reads the same near and far.
    float dl = linearDepth(uv - vec2(px.x, 0.0));
    float dr = linearDepth(uv + vec2(px.x, 0.0));
    float dd = linearDepth(uv - vec2(0.0, px.y));
    float du = linearDepth(uv + vec2(0.0, px.y));
    float jump = max(max(abs(dl - centreDepth), abs(dr - centreDepth)), max(abs(dd - centreDepth), abs(du - centreDepth)));
    float depthEdge = jump / max(centreDepth, 1e-3) * 16.0;
    vec2 normalEdge = max(abs(il.gb - ir.gb), abs(id.gb - iu.gb));
    float normalAmount = length(normalEdge) * 2.4;
    float amount = clamp((idEdge + depthEdge + normalAmount) * max(i.a, 0.0), 0.0, 1.0);
    if (amount > 0.0 && i.r > 0.5) amount *= worldLineBreak(worldAt(uv, centreRaw));
    return amount;
  }

  float boilHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  /** Smooth value noise in 0..1. */
  float boilNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = boilHash(i);
    float b = boilHash(i + vec2(1.0, 0.0));
    float c = boilHash(i + vec2(0.0, 1.0));
    float d = boilHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /**
   * The hand-drawn line boil: where the lines are looked for shifts by up to uBoil pixels, in a smooth field over a
   * coarse screen grid that is redrawn each boil frame. Lines wobble in short coherent strokes (never per-pixel fizz)
   * while the fills underneath stay put, like successive inked drawings of the same frame.
   */
  vec2 boilOffset(vec2 uv) {
    if (uBoil <= 0.0) return vec2(0.0);
    vec2 cell = uv * uResolution / (46.0 * clamp(uResolution.y / 1000.0, 0.8, 1.8));
    // A small seed per frame (golden-ratio steps, under 64): the hash below multiplies by hundreds, and a large seed
    // would lose the float precision it needs, collapsing the noise into a few coarse levels after a minute.
    vec2 seed = fract(vec2(uBoilFrame * 0.61803399, uBoilFrame * 0.75487767)) * 61.0;
    vec2 n = vec2(boilNoise(cell + seed), boilNoise(cell + seed + vec2(37.2, 11.9))) * 2.0 - 1.0;
    return n * uBoil * clamp(uResolution.y / 1000.0, 0.8, 1.8) / uResolution;
  }

  /** How bright a display colour looks: what the smoothing pass compares between neighbouring pixels. */
  const vec3 LUMA = vec3(0.299, 0.587, 0.114);

  /** A gentle illustrated grade: a touch less saturation, teal in the shadows, warmth in the lights, a soft vignette. */
  vec3 grade(vec3 c, vec2 uv) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 graded = mix(vec3(luma), c, 0.9);
    graded += (1.0 - smoothstep(0.0, 0.45, luma)) * vec3(-0.010, 0.012, 0.020);
    graded += smoothstep(0.5, 1.0, luma) * vec3(0.028, 0.012, -0.012);
    float vignette = smoothstep(0.55, 1.05, length((uv - 0.5) * vec2(1.25, 1.0)));
    graded *= 1.0 - vignette * 0.12;
    return mix(c, graded, uGrade);
  }

  vec3 linearToDisplay(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  vec3 displayToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  /**
   * A colour look-up table, indexed and filled with display (sRGB) colours: the whole image is regraded through it,
   * so every surface, shadow and line shares one palette. uLut blends it in (0 leaves the image as it was).
   */
  vec3 lookUp(vec3 linear) {
    vec3 display = linearToDisplay(linear);
    float scale = (uLutSize - 1.0) / uLutSize;
    vec3 graded = textureLod(tLut, display * scale + 0.5 / uLutSize, 0.0).rgb;
    return mix(linear, displayToLinear(graded), uLut);
  }

  void main() {
    vec4 color = texture(tColor, vUv);
    vec4 info = textureLod(tInfo, vUv, 0.0);
    float rawDepth = textureLod(tDepth, vUv, 0.0).r;
    float depth = viewDistance(rawDepth);
    if (uDebug == 1) { outColor = linearToOutputTexel(vec4(color.rgb, 1.0)); return; }
    if (uDebug == 2) { outColor = vec4(vec3(color.a), 1.0); return; }
    if (uDebug == 3) { outColor = vec4(vec3(1.0 - clamp(depth / uFar * 4.0, 0.0, 1.0)), 1.0); return; }
    if (uDebug == 4) { outColor = vec4(info.gb, 1.0, 1.0); return; }
    if (uDebug == 5) { outColor = vec4(vec3(info.a), 1.0); return; }
    vec2 lineUv = vUv + boilOffset(vUv);
    // Lines are looked for at this pixel, or (while they boil) a little way off it: only then is that place read too.
    vec4 lineColor = color;
    vec4 lineInfo = info;
    float lineRaw = rawDepth;
    if (uBoil > 0.0) {
      lineColor = textureLod(tColor, lineUv, 0.0);
      lineInfo = textureLod(tInfo, lineUv, 0.0);
      lineRaw = textureLod(tDepth, lineUv, 0.0).r;
    }
    float raw = edgeAt(lineUv, viewDistance(lineRaw), lineColor, lineInfo, lineRaw);
    // Drawn lines are already shaped; classic lines are thresholded here.
    float edge = uLines == 1 ? raw : smoothstep(0.18, 0.74, raw);
    // Far lines soften into the haze; the ink takes some colour from what it outlines.
    edge *= mix(1.0, uFadeMin, smoothstep(uFadeNear, uFadeFar, depth));
    vec3 ink = mix(uInk, color.rgb * 0.36, uInkTint);
    vec3 inked = mix(color.rgb, ink, edge * (uLines == 1 ? 1.0 : 0.92));
    if (uLutDirect > 0.5) {
      // The table holds display colours and the screen is sent display colours: straight out, with no trip to linear
      // light and back (render() only sets this when the table is fully on and the screen takes sRGB).
      float lutScale = (uLutSize - 1.0) / uLutSize;
      vec3 direct = textureLod(tLut, linearToDisplay(inked) * lutScale + 0.5 / uLutSize, 0.0).rgb;
      outColor = vec4(direct, uSmoothOut > 0.5 ? dot(direct, LUMA) : 1.0);
      return;
    }
    vec3 graded = uLut > 0.0 ? lookUp(inked) : grade(inked, vUv);
    // Bound for the smoothing pass (uSmoothOut): display colours, with their brightness in alpha for it to read.
    // Otherwise straight to the screen, in whatever colour space the renderer sends there.
    if (uSmoothOut > 0.5) {
      vec3 shown = linearToDisplay(graded);
      outColor = vec4(shown, dot(shown, LUMA));
      return;
    }
    outColor = linearToOutputTexel(vec4(graded, 1.0));
  }
`;

/**
 * Smooths the stair-steps off the finished picture (fast approximate anti-aliasing, after Timothy Lottes' FXAA as
 * laid out in Jasper Flick's tutorial). The line pass leaves each pixel's brightness in alpha. Where a pixel and its
 * four neighbours hardly differ (most of the picture) it is passed straight through, for five lookups. On an edge it
 * finds which way the edge runs and how far along it the step lies, and slides the pixel toward the far side by that
 * much: slanted lines and roof edges come out even, while the inside of fills and the weight of the ink stay put.
 */
const smoothFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tImage;
  uniform vec2 uTexel;
  in vec2 vUv;
  out vec4 outColor;

  // Below this difference in brightness (or this share of the brightest neighbour) a pixel is left alone.
  const float CONTRAST = 0.0312;
  const float RELATIVE = 0.063;
  // How much a lone speck or hairline may be blended into its surroundings (1 is softest): kept low, so thin ink
  // lines hold their weight.
  const float SUBPIXEL = 0.4;
  const int STEPS = 6;
  const float GUESS = 8.0;

  float lumaAt(vec2 uv) { return textureLod(tImage, uv, 0.0).a; }

  void main() {
    vec4 centre = textureLod(tImage, vUv, 0.0);
    float m = centre.a;
    float n = lumaAt(vUv + vec2(0.0, uTexel.y));
    float e = lumaAt(vUv + vec2(uTexel.x, 0.0));
    float s = lumaAt(vUv - vec2(0.0, uTexel.y));
    float w = lumaAt(vUv - vec2(uTexel.x, 0.0));
    float highest = max(max(max(max(n, e), s), w), m);
    float lowest = min(min(min(min(n, e), s), w), m);
    float contrast = highest - lowest;
    if (contrast < max(CONTRAST, RELATIVE * highest)) { outColor = vec4(centre.rgb, 1.0); return; }

    float ne = lumaAt(vUv + uTexel);
    float nw = lumaAt(vUv + vec2(-uTexel.x, uTexel.y));
    float se = lumaAt(vUv + vec2(uTexel.x, -uTexel.y));
    float sw = lumaAt(vUv - uTexel);
    float around = (2.0 * (n + e + s + w) + ne + nw + se + sw) / 12.0;
    float speck = smoothstep(0.0, 1.0, clamp(abs(around - m) / contrast, 0.0, 1.0));
    float pixelBlend = speck * speck * SUBPIXEL;

    float across = 2.0 * abs(n + s - 2.0 * m) + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
    float along = 2.0 * abs(e + w - 2.0 * m) + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
    bool level = across >= along;
    float ahead = level ? n : e;
    float behind = level ? s : w;
    float pixelStep = level ? uTexel.y : uTexel.x;
    float aheadSlope = abs(ahead - m);
    float behindSlope = abs(behind - m);
    float farLuma = ahead;
    float slope = aheadSlope;
    if (aheadSlope < behindSlope) { pixelStep = -pixelStep; farLuma = behind; slope = behindSlope; }

    // Walk both ways along the edge until it ends (the brightness leaves the edge's own), in growing strides.
    vec2 onEdge = vUv;
    vec2 stride;
    if (level) { onEdge.y += pixelStep * 0.5; stride = vec2(uTexel.x, 0.0); } else { onEdge.x += pixelStep * 0.5; stride = vec2(0.0, uTexel.y); }
    float edgeLuma = (m + farLuma) * 0.5;
    float limit = slope * 0.25;
    float strides[STEPS] = float[STEPS](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);
    vec2 forward = onEdge;
    float forwardDelta = 0.0;
    bool forwardEnd = false;
    for (int i = 0; i < STEPS && !forwardEnd; i++) {
      forward += stride * strides[i];
      forwardDelta = lumaAt(forward) - edgeLuma;
      forwardEnd = abs(forwardDelta) >= limit;
    }
    if (!forwardEnd) forward += stride * GUESS;
    vec2 backward = onEdge;
    float backwardDelta = 0.0;
    bool backwardEnd = false;
    for (int i = 0; i < STEPS && !backwardEnd; i++) {
      backward -= stride * strides[i];
      backwardDelta = lumaAt(backward) - edgeLuma;
      backwardEnd = abs(backwardDelta) >= limit;
    }
    if (!backwardEnd) backward -= stride * GUESS;
    float forwardRun = level ? forward.x - vUv.x : forward.y - vUv.y;
    float backwardRun = level ? vUv.x - backward.x : vUv.y - backward.y;
    bool nearerForward = forwardRun <= backwardRun;
    float nearest = nearerForward ? forwardRun : backwardRun;
    bool endRises = (nearerForward ? forwardDelta : backwardDelta) >= 0.0;
    float edgeBlend = endRises == (m - edgeLuma >= 0.0) ? 0.0 : 0.5 - nearest / (forwardRun + backwardRun);

    float blend = max(pixelBlend, edgeBlend);
    vec2 uv = vUv;
    if (level) uv.y += pixelStep * blend; else uv.x += pixelStep * blend;
    outColor = vec4(textureLod(tImage, uv, 0.0).rgb, 1.0);
  }
`;

/**
 * How lines are found:
 * - "classic": wherever the surface id, distance or facing jumps next to the pixel; every material inks evenly.
 * - "drawn": as an illustrator inks. A cross of samples finds where the surface, its relative distance or its facing
 *   changes. Small surface-id steps count, so painted patches get outlines. Edge-on surfaces need bigger distance
 *   steps. Each material's pen pressure (its line mask, with gaps) comes from whatever stands in front.
 */
export type LineStyle = "classic" | "drawn";

/**
 * How the line pass draws: lines are found as `lines` says, fade between fadeNear and fadeFar (to fadeMin of full
 * strength), take inkTint of their colour from what they outline, grade (0..1) the image with the built-in grade or
 * regrade it through a look-up table (`lut`, 0..1, see setGradeLut), and boil (wobble by up to `boil` pixels, 0..3,
 * redrawn BOIL_FPS times a second as `setTime` advances) like hand-inked animation.
 */
export type IllustratedStyle = {
  lines: LineStyle; fadeNear: number; fadeFar: number; fadeMin: number; inkTint: number; grade: number; lut: number; boil: number;
};
const DEFAULT_STYLE: IllustratedStyle = { lines: "classic", fadeNear: 1e6, fadeFar: 2e6, fadeMin: 1, inkTint: 0, grade: 0, lut: 0, boil: 0 };
/** How many times a second the line boil is redrawn: on "eights", like hand-drawn animation. */
export const BOIL_FPS = 8;
/** Boil frames repeat after this many (keeps the seed small enough for exact float maths in the shader). */
const BOIL_FRAMES = 997;

const debugIndex: Record<DebugView, number> = { final: 0, color: 1, "surface-id": 2, depth: 3, normals: 4, mask: 5 };

export class IllustratedComposer {
  private readonly target: WebGLRenderTarget;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly resolution = new Vector2(1, 1);
  private pixelRatio = 1;
  /** The depth prepass's bare material while the prepass is on (see setDepthPrepass). */
  private prepass: ShaderMaterial | null = null;
  /** The smoothing pass (see setSmoothing): where the line pass draws to, and the quad that smooths it onto the screen. */
  private smooth: { target: WebGLRenderTarget; material: ShaderMaterial; scene: Scene } | null = null;

  constructor(private readonly renderer: WebGLRenderer) {
    this.target = new WebGLRenderTarget(1, 1, {
      count: 2,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
    this.target.depthTexture = new DepthTexture(1, 1, FloatType);
    this.target.textures[0]!.name = "clockwork-color";
    this.target.textures[1]!.name = "clockwork-info";
    // The info buffer holds a flag, a packed normal and a pen pressure, all in 0..1 and none needing more than eight
    // bits: half the memory to write for every pixel and to read five times a pixel in the line pass. Colour keeps its
    // sixteen bits (the surface ids in its alpha are finer than eight).
    this.target.textures[1]!.type = UnsignedByteType;
    this.target.textures[1]!.minFilter = NearestFilter;
    this.target.textures[1]!.magFilter = NearestFilter;
    this.material = new ShaderMaterial({
      name: "ClockworkOutlinePass",
      glslVersion: GLSL3,
      uniforms: {
        tColor: { value: this.target.textures[0] },
        tInfo: { value: this.target.textures[1] },
        tDepth: { value: this.target.depthTexture },
        uResolution: { value: this.resolution },
        uInk: { value: { x: 0.13, y: 0.18, z: 0.18 } },
        uThickness: { value: 1.2 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uOrthographic: { value: false },
        uFadeNear: { value: DEFAULT_STYLE.fadeNear },
        uFadeFar: { value: DEFAULT_STYLE.fadeFar },
        uFadeMin: { value: DEFAULT_STYLE.fadeMin },
        uInkTint: { value: DEFAULT_STYLE.inkTint },
        uGrade: { value: DEFAULT_STYLE.grade },
        uLines: { value: 0 },
        // A sampler always needs a texture; this 1x1x1 table is never read while uLut is 0.
        tLut: { value: identityLut(2) },
        uLut: { value: DEFAULT_STYLE.lut },
        uLutSize: { value: 2 },
        uBoil: { value: DEFAULT_STYLE.boil },
        uBoilFrame: { value: 0 },
        uDebug: { value: 0 },
        // Clip space to world space for the camera being drawn (set each frame in render).
        uUnproject: { value: new Matrix4() },
        uLutDirect: { value: 0 },
        uSmoothOut: { value: 0 },
      },
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  resize(width: number, height: number, pixelRatio = 1) {
    this.pixelRatio = pixelRatio;
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    this.resolution.set(w, h);
    this.target.setSize(w, h);
    this.smooth?.target.setSize(w, h);
  }

  /**
   * Smooth the stair-steps off slanted lines and edges with a last pass over the finished picture (see
   * smoothFragment). Off by default; debug views are never smoothed. It needs the renderer to output sRGB (three's
   * default), and is skipped otherwise.
   */
  setSmoothing(enabled: boolean) {
    if (enabled === (this.smooth !== null)) return;
    if (this.smooth) {
      this.smooth.target.dispose();
      this.smooth.material.dispose();
      for (const object of this.smooth.scene.children) if (object instanceof Mesh) object.geometry.dispose();
      this.smooth = null;
      return;
    }
    // Display colours with brightness in alpha: eight bits a channel is what the screen gets anyway.
    const target = new WebGLRenderTarget(this.resolution.x, this.resolution.y, { type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    target.texture.name = "clockwork-inked";
    const material = new ShaderMaterial({
      name: "ClockworkSmoothPass",
      glslVersion: GLSL3,
      uniforms: { tImage: { value: target.texture }, uTexel: { value: new Vector2(1, 1) } },
      vertexShader: outlineVertex,
      fragmentShader: smoothFragment,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    this.smooth = { target, material, scene };
  }

  get smoothing(): boolean { return this.smooth !== null; }

  setDebugView(view: DebugView) { this.material.uniforms.uDebug!.value = debugIndex[view]; }
  setThickness(value: number) { this.material.uniforms.uThickness!.value = Math.max(0.5, value); }

  /** The ink colour (linear RGB components, as three's Color holds them). */
  setInk(color: { r: number; g: number; b: number }) {
    if (![color.r, color.g, color.b].every(Number.isFinite)) return;
    this.material.uniforms.uInk!.value = { x: color.r, y: color.g, z: color.b };
  }

  /** Line fading, ink tint and colour grade; anything left out keeps its current value. Defaults: no fade, flat ink, no grade. */
  setStyle(style: Partial<IllustratedStyle>) {
    const uniforms = this.material.uniforms;
    const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
    if (finite(style.fadeNear)) uniforms.uFadeNear!.value = style.fadeNear;
    if (finite(style.fadeFar)) uniforms.uFadeFar!.value = style.fadeFar;
    // Whichever end moved, the fade must still run near to far (smoothstep is undefined with its edges reversed).
    // A relative gap: an absolute one vanishes in the shader's float32 at the large default distances.
    const near = uniforms.uFadeNear!.value;
    uniforms.uFadeFar!.value = Math.max(uniforms.uFadeFar!.value, near + Math.abs(near) * 1e-4 + 1e-3);
    if (finite(style.fadeMin)) uniforms.uFadeMin!.value = Math.min(1, Math.max(0, style.fadeMin));
    if (finite(style.inkTint)) uniforms.uInkTint!.value = Math.min(1, Math.max(0, style.inkTint));
    if (finite(style.grade)) uniforms.uGrade!.value = Math.min(1, Math.max(0, style.grade));
    if (finite(style.lut)) uniforms.uLut!.value = Math.min(1, Math.max(0, style.lut));
    if (style.lines === "classic" || style.lines === "drawn") uniforms.uLines!.value = style.lines === "drawn" ? 1 : 0;
    if (style.boil !== undefined && Number.isFinite(style.boil)) uniforms.uBoil!.value = Math.min(3, Math.max(0, style.boil));
  }

  /**
   * The colour look-up table the `lut` style blends in (see createGradeLut). The composer does not own it: whoever
   * made it disposes of it. Passing null goes back to an identity table (and `lut` then changes nothing).
   */
  setGradeLut(table: Data3DTexture | null) {
    const uniforms = this.material.uniforms;
    const previous = uniforms.tLut!.value as Data3DTexture;
    if (previous.userData.composerOwned) previous.dispose();
    const next = table ?? identityLut(2);
    uniforms.tLut!.value = next;
    uniforms.uLutSize!.value = next.image.width;
  }

  /**
   * Animation time in seconds: the line boil redraws BOIL_FPS times a second as it advances. Hold it still (reduced
   * motion) and the lines hold still too.
   */
  setTime(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const frame = Math.floor(Math.max(0, seconds) * BOIL_FPS) % BOIL_FRAMES;
    this.material.uniforms.uBoilFrame!.value = frame;
  }

  /**
   * Draw the depth of every object on DEPTH_PREPASS_LAYER first, with a bare shader, so the painted materials shade
   * each pixel once instead of once per wall behind it. Off by default: it costs a second pass over that geometry,
   * which pays where surfaces overlap deeply (a street) and not for a single object against the sky.
   */
  setDepthPrepass(enabled: boolean) {
    if (enabled === (this.prepass !== null)) return;
    this.prepass?.dispose();
    this.prepass = enabled ? createDepthPrepassMaterial() : null;
  }

  get depthPrepass(): boolean { return this.prepass !== null; }

  /** The depth-only pass over the prepass layer. Shadows are left for the painted pass, which sees every caster. */
  private renderDepthFirst(world: Scene, camera: Camera) {
    const shadows = this.renderer.shadowMap as { autoUpdate: boolean; needsUpdate: boolean } | undefined;
    const autoUpdate = shadows?.autoUpdate ?? false;
    const needsUpdate = shadows?.needsUpdate ?? false;
    if (shadows) { shadows.autoUpdate = false; shadows.needsUpdate = false; }
    const layers = camera.layers.mask;
    const override = world.overrideMaterial;
    camera.layers.set(DEPTH_PREPASS_LAYER);
    world.overrideMaterial = this.prepass;
    try {
      this.renderer.render(world, camera);
    } finally {
      world.overrideMaterial = override;
      camera.layers.mask = layers;
      if (shadows) { shadows.autoUpdate = autoUpdate; shadows.needsUpdate = needsUpdate; }
    }
  }

  /** The boil frame now showing (0..BOIL_FRAMES-1). */
  get boilFrame(): number { return this.material.uniforms.uBoilFrame!.value; }

  get style(): IllustratedStyle {
    const uniforms = this.material.uniforms;
    return {
      lines: uniforms.uLines!.value === 1 ? "drawn" : "classic",
      fadeNear: uniforms.uFadeNear!.value, fadeFar: uniforms.uFadeFar!.value, fadeMin: uniforms.uFadeMin!.value,
      inkTint: uniforms.uInkTint!.value, grade: uniforms.uGrade!.value, lut: uniforms.uLut!.value, boil: uniforms.uBoil!.value,
    };
  }

  render(world: Scene, camera: Camera, overlays: Array<{ scene: Scene; camera: Camera }> = []) {
    // The line pass reads real distances from the depth buffer, so it needs this camera's clip planes.
    const uniforms = this.material.uniforms;
    const clip = camera as Camera & { near?: number; far?: number; isOrthographicCamera?: boolean };
    if (typeof clip.near === "number" && typeof clip.far === "number") {
      uniforms.uNear!.value = clip.near;
      uniforms.uFar!.value = clip.far;
    }
    uniforms.uOrthographic!.value = clip.isOrthographicCamera === true;
    const previousAutoClear = this.renderer.autoClear;
    // Each buffer is cleared once, by hand: the scene (and its depth prepass) draw onto it without clearing again.
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    if (this.prepass) this.renderDepthFirst(world, camera);
    this.renderer.render(world, camera);
    // The scene render has just brought the camera up to date: the line pass finds world positions from its matrices.
    (uniforms.uUnproject!.value as Matrix4).multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    const toScreenAsSrgb = this.renderer.outputColorSpace === SRGBColorSpace;
    uniforms.uLutDirect!.value = uniforms.uLut!.value >= 1 && toScreenAsSrgb ? 1 : 0;
    // With smoothing on, the line pass draws to a buffer and the smoothing pass brings it to the screen.
    const smooth = toScreenAsSrgb && uniforms.uDebug!.value === 0 ? this.smooth : null;
    uniforms.uSmoothOut!.value = smooth ? 1 : 0;
    if (smooth) {
      this.renderer.setRenderTarget(smooth.target);
      this.renderer.render(this.quadScene, this.quadCamera);
      (smooth.material.uniforms.uTexel!.value as Vector2).set(1 / this.resolution.x, 1 / this.resolution.y);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(smooth ? smooth.scene : this.quadScene, this.quadCamera);
    for (const overlay of overlays) this.renderer.render(overlay.scene, overlay.camera);
    this.renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.target.dispose();
    this.prepass?.dispose();
    this.prepass = null;
    this.setSmoothing(false);
    const table = this.material.uniforms.tLut!.value as Data3DTexture;
    if (table.userData.composerOwned) table.dispose();
    this.material.dispose();
    for (const object of this.quadScene.children) {
      if (object instanceof Mesh) object.geometry.dispose();
    }
  }
}
