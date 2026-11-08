import * as THREE from "three";

/**
 * The painted sky and the air in it.
 * - `dome`: a sphere that follows the camera and is drawn at the far plane. A horizon-to-zenith gradient (hazier
 *   below the horizon, where the islands hang over the void) with flat two-tone clouds that drift. It writes both
 *   illustration buffers (surface id 1, like the clear colour, and no line mask), so silhouettes against it still
 *   get their outline from the side of the thing in front.
 * - `overlay`: a few hundred dust specks drifting in a box around the camera, drawn after the line pass so they
 *   are never outlined.
 */
/**
 * A turquoise sky with mint cloud: two flat tones, as the reference's sky reads (its sky about hue 177°, saturation
 * 0.48; its lighter cloud about hue 167°, saturation 0.32, measured on its frames).
 */
export const SKY_COLORS = {
  zenith: "#4fb2ad",
  horizon: "#9edbcd",
  below: "#8ec4c1",
  cloudLight: "#b4e9db",
  cloudShade: "#93d8ca",
  speck: "#f7f3e2",
} as const;

const domeVertex = /* glsl */ `
  out vec3 vDirection;
  void main() {
    vDirection = position;
    vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    // On the far plane: behind everything, whatever the dome's radius.
    gl_Position = clip.xyww;
  }
`;

const domeFragment = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 outColor;
  layout(location = 1) out vec4 outInfo;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uCloudLight;
  uniform vec3 uCloudShade;
  uniform float uTime;
  in vec3 vDirection;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += noise(p) * amplitude;
      p = p * 2.03 + vec2(17.1, 9.4);
      amplitude *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 d = normalize(vDirection);
    float up = d.y;
    vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, up));
    sky = mix(sky, uBelow, smoothstep(0.0, -0.4, up));

    // Clouds on a flat ceiling: long, brushy streaks drawn out along the wind (the noise is stretched one way and
    // warped), denser toward the horizon, two tones with hard (anti-aliased) edges. Computed for every sky pixel (no
    // branch) so fwidth stays well defined; below the horizon they are masked away.
    vec2 p = d.xz / (max(up, 0.0) + 0.2) * 1.4 * vec2(0.42, 1.25) + vec2(uTime * 0.012, uTime * 0.005);
    p += 0.45 * vec2(noise(p * 1.6 + 3.7), noise(p * 1.6 - 1.9));
    float cover = fbm(p) - 0.56 + (1.0 - smoothstep(0.05, 0.5, up)) * 0.08;
    float edge = fwidth(cover) * 1.2 + 1e-4;
    float cloud = smoothstep(-edge, edge, cover);
    float inner = cover - 0.05 - (noise(p * 3.1 + vec2(0.4, 0.2)) - 0.5) * 0.08;
    float lit = smoothstep(-edge, edge, inner);
    sky = mix(sky, mix(uCloudShade, uCloudLight, lit), cloud * smoothstep(0.0, 0.08, up));
    outColor = vec4(sky, 1.0);
    outInfo = vec4(0.0, 0.5, 0.5, 0.0);
  }
`;

const speckVertex = /* glsl */ `
  attribute vec3 seed;
  uniform vec3 uCamera;
  uniform float uTime;
  uniform float uBox;
  uniform float uSize;
  varying float vAlpha;
  void main() {
    vec3 drift = vec3(uTime * 1.1, uTime * 0.22 + sin(uTime * 0.35 + seed.x * 6.28) * 1.6, uTime * 0.55);
    vec3 p = seed * uBox + drift;
    // Wrap into a box centred on the camera, so the air is always full around it.
    p = mod(p - uCamera, uBox) - uBox * 0.5 + uCamera;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = min(uSize * 260.0 / max(1.0, -view.z), 48.0);
    gl_Position = projectionMatrix * view;
    float dist = length(p - uCamera);
    vAlpha = smoothstep(uBox * 0.5, uBox * 0.3, dist) * smoothstep(3.0, 10.0, dist);
  }
`;

const speckFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(uColor, smoothstep(0.5, 0.25, r) * vAlpha * 0.6);
    #include <colorspace_fragment>
  }
`;

const SPECKS = 360;
const SPECK_BOX = 180;
const DOME_RADIUS = 3000;

export class Sky {
  readonly dome: THREE.Mesh;
  readonly overlay = new THREE.Scene();
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly speckMaterial: THREE.ShaderMaterial;
  private readonly specks: THREE.Points;

  constructor(seed = 7) {
    this.domeMaterial = new THREE.ShaderMaterial({
      name: "ClockworkSkyDome",
      glslVersion: THREE.GLSL3,
      uniforms: {
        uZenith: { value: new THREE.Color(SKY_COLORS.zenith) },
        uHorizon: { value: new THREE.Color(SKY_COLORS.horizon) },
        uBelow: { value: new THREE.Color(SKY_COLORS.below) },
        uCloudLight: { value: new THREE.Color(SKY_COLORS.cloudLight) },
        uCloudShade: { value: new THREE.Color(SKY_COLORS.cloudShade) },
        uTime: { value: 0 },
      },
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), this.domeMaterial);
    this.dome.name = "Painted sky";
    this.dome.frustumCulled = false;
    // Drawn last: at the far plane, early depth testing then skips every pixel the town already covers.
    this.dome.renderOrder = 1000;

    let state = seed;
    const random = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    const seeds = new Float32Array(SPECKS * 3);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = random();
    const geometry = new THREE.BufferGeometry();
    // Positions are computed in the shader; three still wants a position attribute to count the points.
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPECKS * 3), 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 3));
    this.speckMaterial = new THREE.ShaderMaterial({
      name: "ClockworkDustSpecks",
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uBox: { value: SPECK_BOX },
        uSize: { value: 1 },
        uColor: { value: new THREE.Color(SKY_COLORS.speck) },
      },
      vertexShader: speckVertex,
      fragmentShader: speckFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.specks = new THREE.Points(geometry, this.speckMaterial);
    this.specks.name = "Dust specks";
    this.specks.frustumCulled = false;
    this.overlay.add(this.specks);
  }

  /** Keep the dome on the camera and move the clouds and specks along by `time` seconds. */
  update(camera: THREE.Camera, time: number, pixelRatio: number): void {
    this.dome.position.copy(camera.position);
    this.domeMaterial.uniforms.uTime!.value = time;
    const uniforms = this.speckMaterial.uniforms;
    (uniforms.uCamera!.value as THREE.Vector3).copy(camera.position);
    uniforms.uTime!.value = time;
    uniforms.uSize!.value = pixelRatio;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.domeMaterial.dispose();
    this.specks.geometry.dispose();
    this.speckMaterial.dispose();
  }
}
