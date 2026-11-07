import {
  Camera,
  DepthTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

export type DebugView = "final" | "color" | "surface-id" | "depth" | "normals" | "mask";

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

  float edgeAt(vec2 uv, float centreDepth) {
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
    float edge = smoothstep(0.18, 0.74, edgeAt(lineUv, uBoil > 0.0 ? linearDepth(lineUv) : depth));
    // Far lines soften into the haze; the ink takes some colour from what it outlines.
    edge *= mix(1.0, uFadeMin, smoothstep(uFadeNear, uFadeFar, depth));
    vec3 ink = mix(uInk, color.rgb * 0.36, uInkTint);
    vec3 inked = mix(color.rgb, ink, edge * 0.92);
    outColor = linearToOutputTexel(vec4(grade(inked, vUv), 1.0));
  }
`;

/**
 * How the line pass draws: lines fade between fadeNear and fadeFar (to fadeMin of full strength), take inkTint of their
 * colour from what they outline, grade (0..1) the image, and boil (wobble by up to `boil` pixels, 0..3, redrawn
 * BOIL_FPS times a second as `setTime` advances) like hand-inked animation.
 */
export type IllustratedStyle = { fadeNear: number; fadeFar: number; fadeMin: number; inkTint: number; grade: number; boil: number };
const DEFAULT_STYLE: IllustratedStyle = { fadeNear: 1e6, fadeFar: 2e6, fadeMin: 1, inkTint: 0, grade: 0, boil: 0 };
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
    if (style.boil !== undefined && Number.isFinite(style.boil)) uniforms.uBoil!.value = Math.min(3, Math.max(0, style.boil));
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
      fadeNear: uniforms.uFadeNear!.value, fadeFar: uniforms.uFadeFar!.value, fadeMin: uniforms.uFadeMin!.value,
      inkTint: uniforms.uInkTint!.value, grade: uniforms.uGrade!.value, boil: uniforms.uBoil!.value,
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
    this.material.dispose();
    for (const object of this.quadScene.children) {
      if (object instanceof Mesh) object.geometry.dispose();
    }
  }
}
