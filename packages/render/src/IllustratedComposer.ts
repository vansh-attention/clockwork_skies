import {
  Camera,
  ClampToEdgeWrapping,
  Data3DTexture,
  DepthTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

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
  in vec2 vUv;
  out vec4 outColor;

  /** View distance of the surface at uv (the far plane where nothing was drawn). */
  float linearDepth(vec2 uv) {
    float d = texture(tDepth, uv).r;
    if (uOrthographic) return uNear + d * (uFar - uNear);
    float z = d * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
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
  float drawnEdgeAt(vec2 uv) {
    vec2 px = uThickness * clamp(uResolution.y / 1000.0, 0.8, 1.8) / uResolution;
    vec2 offsets[5] = vec2[5](vec2(0.0), vec2(-px.x, 0.0), vec2(px.x, 0.0), vec2(0.0, -px.y), vec2(0.0, px.y));
    float ids[5];
    float depths[5];
    float masks[5];
    vec3 normals[5];
    for (int i = 0; i < 5; i++) {
      vec2 at = uv + offsets[i];
      vec4 info = texture(tInfo, at);
      ids[i] = texture(tColor, at).a;
      depths[i] = linearDepth(at);
      normals[i] = decodeNormal(info.gb);
      masks[i] = info.a;
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
    for (int i = 1; i < 5; i++) {
      if (depths[i] < nearest) { nearest = depths[i]; mask = masks[i]; }
    }
    return clamp(edge, 0.0, 1.0) * max(mask, 0.0);
  }

  float edgeAt(vec2 uv, float centreDepth) {
    if (uLines == 1) return drawnEdgeAt(uv);
    // Lines keep the same on-screen weight at any resolution.
    vec2 px = uThickness * clamp(uResolution.y / 1000.0, 0.8, 1.8) / uResolution;
    vec4 c = texture(tColor, uv);
    vec4 i = texture(tInfo, uv);
    vec4 cl = texture(tColor, uv - vec2(px.x, 0.0));
    vec4 cr = texture(tColor, uv + vec2(px.x, 0.0));
    vec4 il = texture(tInfo, uv - vec2(px.x, 0.0));
    vec4 ir = texture(tInfo, uv + vec2(px.x, 0.0));
    vec4 id = texture(tInfo, uv - vec2(0.0, px.y));
    vec4 iu = texture(tInfo, uv + vec2(0.0, px.y));
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
    return clamp((idEdge + depthEdge + normalAmount) * max(i.a, 0.0), 0.0, 1.0);
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
    vec3 graded = texture(tLut, display * scale + 0.5 / uLutSize).rgb;
    return mix(linear, displayToLinear(graded), uLut);
  }

  void main() {
    vec4 color = texture(tColor, vUv);
    vec4 info = texture(tInfo, vUv);
    float depth = linearDepth(vUv);
    if (uDebug == 1) { outColor = linearToOutputTexel(vec4(color.rgb, 1.0)); return; }
    if (uDebug == 2) { outColor = vec4(vec3(color.a), 1.0); return; }
    if (uDebug == 3) { outColor = vec4(vec3(1.0 - clamp(depth / uFar * 4.0, 0.0, 1.0)), 1.0); return; }
    if (uDebug == 4) { outColor = vec4(info.gb, 1.0, 1.0); return; }
    if (uDebug == 5) { outColor = vec4(vec3(info.a), 1.0); return; }
    vec2 lineUv = vUv + boilOffset(vUv);
    float raw = edgeAt(lineUv, uBoil > 0.0 ? linearDepth(lineUv) : depth);
    // Drawn lines are already shaped; classic lines are thresholded here.
    float edge = uLines == 1 ? raw : smoothstep(0.18, 0.74, raw);
    // Far lines soften into the haze; the ink takes some colour from what it outlines.
    edge *= mix(1.0, uFadeMin, smoothstep(uFadeNear, uFadeFar, depth));
    vec3 ink = mix(uInk, color.rgb * 0.36, uInkTint);
    vec3 inked = mix(color.rgb, ink, edge * (uLines == 1 ? 1.0 : 0.92));
    vec3 graded = uLut > 0.0 ? lookUp(inked) : grade(inked, vUv);
    outColor = linearToOutputTexel(vec4(graded, 1.0));
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
  }

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
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(world, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = false;
    for (const overlay of overlays) this.renderer.render(overlay.scene, overlay.camera);
    this.renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.target.dispose();
    const table = this.material.uniforms.tLut!.value as Data3DTexture;
    if (table.userData.composerOwned) table.dispose();
    this.material.dispose();
    for (const object of this.quadScene.children) {
      if (object instanceof Mesh) object.geometry.dispose();
    }
  }
}
