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
  uniform vec2 uResolution;
  uniform vec3 uInk;
  uniform float uThickness;
  uniform int uDebug;
  in vec2 vUv;
  out vec4 outColor;

  float edgeAt(vec2 uv) {
    vec2 px = uThickness / uResolution;
    vec4 c = texture(tColor, uv);
    vec4 i = texture(tInfo, uv);
    vec4 cl = texture(tColor, uv - vec2(px.x, 0.0));
    vec4 cr = texture(tColor, uv + vec2(px.x, 0.0));
    vec4 il = texture(tInfo, uv - vec2(px.x, 0.0));
    vec4 ir = texture(tInfo, uv + vec2(px.x, 0.0));
    vec4 id = texture(tInfo, uv - vec2(0.0, px.y));
    vec4 iu = texture(tInfo, uv + vec2(0.0, px.y));
    float idEdge = max(abs(cl.a - c.a), abs(cr.a - c.a)) * 9.0;
    float depthEdge = max(max(abs(il.r - i.r), abs(ir.r - i.r)), max(abs(id.r - i.r), abs(iu.r - i.r))) * 72.0;
    vec2 normalEdge = max(abs(il.gb - ir.gb), abs(id.gb - iu.gb));
    float normalAmount = length(normalEdge) * 2.4;
    return clamp((idEdge + depthEdge + normalAmount) * max(i.a, 0.0), 0.0, 1.0);
  }

  void main() {
    vec4 color = texture(tColor, vUv);
    vec4 info = texture(tInfo, vUv);
    if (uDebug == 1) { outColor = linearToOutputTexel(vec4(color.rgb, 1.0)); return; }
    if (uDebug == 2) { outColor = vec4(vec3(color.a), 1.0); return; }
    if (uDebug == 3) { outColor = vec4(vec3(info.r), 1.0); return; }
    if (uDebug == 4) { outColor = vec4(info.gb, 1.0, 1.0); return; }
    if (uDebug == 5) { outColor = vec4(vec3(info.a), 1.0); return; }
    float edge = smoothstep(0.18, 0.74, edgeAt(vUv));
    outColor = linearToOutputTexel(vec4(mix(color.rgb, uInk, edge * 0.92), 1.0));
  }
`;

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
        uResolution: { value: this.resolution },
        uInk: { value: { x: 0.13, y: 0.18, z: 0.18 } },
        uThickness: { value: 1.2 },
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

  render(world: Scene, camera: Camera, overlays: Array<{ scene: Scene; camera: Camera }> = []) {
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
