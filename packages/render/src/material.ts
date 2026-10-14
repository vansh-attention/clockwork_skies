import {
  Color,
  GLSL3,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type ColorRepresentation,
} from "three";

export type IllustratedMaterialOptions = {
  color: ColorRepresentation;
  shadow?: ColorRepresentation;
  surfaceId?: number;
  outline?: number;
  grain?: number;
};

const vertexShader = /* glsl */ `
  out vec3 vViewNormal;
  out vec3 vWorldPosition;
  out vec4 vClipPosition;
  out vec2 vUv;

  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vClipPosition = projectionMatrix * viewMatrix * worldPosition;
    gl_Position = vClipPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  layout(location = 0) out vec4 outColor;
  layout(location = 1) out vec4 outInfo;

  uniform vec3 uColor;
  uniform vec3 uShadow;
  uniform float uSurfaceId;
  uniform float uOutline;
  uniform float uGrain;
  uniform vec3 uLightDirection;
  in vec3 vViewNormal;
  in vec3 vWorldPosition;
  in vec4 vClipPosition;
  in vec2 vUv;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec2 encodeNormal(vec3 normal) {
    float scale = inversesqrt(max(0.001, 8.0 * normal.z + 8.0));
    return normal.xy * scale + 0.5;
  }

  void main() {
    vec3 normal = normalize(vViewNormal);
    float light = dot(normal, normalize(uLightDirection));
    float tone = smoothstep(-0.15, 0.42, light);
    float grain = (hash31(floor(vWorldPosition * 3.5)) - 0.5) * uGrain;
    vec3 color = mix(uShadow, uColor, tone) + grain;
    float outlineNoise = smoothstep(0.08, 0.24, hash31(floor(vWorldPosition * 2.0)));
    float reversedDepth = 1.0 - (0.5 * vClipPosition.z / vClipPosition.w + 0.5);
    outColor = vec4(color, uSurfaceId);
    outInfo = vec4(reversedDepth, encodeNormal(normal), uOutline * outlineNoise);
  }
`;

export function createIllustratedMaterial(options: IllustratedMaterialOptions) {
  const base = new Color(options.color);
  const shadow = options.shadow ? new Color(options.shadow) : base.clone().offsetHSL(-0.02, 0.04, -0.28);
  return new ShaderMaterial({
    name: "ClockworkIllustratedMaterial",
    glslVersion: GLSL3,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uColor: { value: base },
        uShadow: { value: shadow },
        uSurfaceId: { value: options.surfaceId ?? 0.3 },
        uOutline: { value: options.outline ?? 1 },
        uGrain: { value: options.grain ?? 0.035 },
        uLightDirection: { value: { x: 0.45, y: 0.76, z: 0.47 } },
      },
    ]),
    vertexShader,
    fragmentShader,
  });
}
