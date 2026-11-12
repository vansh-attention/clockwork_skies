import * as THREE from "three";
import { createIllustratedMaterial } from "@clockwork/render";
import { AUTHORED_EYE_MASK, AUTHORED_PALETTE } from "./authoredAssets";

let palette: THREE.DataTexture | undefined;
let eyeMask: THREE.DataTexture | undefined;

/** The decoded avatar's atlas UVs and sculpted face, rendered through the game's depth/normal ink pass. */
export function createAuthoredMaterial(): THREE.ShaderMaterial {
  if (!palette) {
    palette = new THREE.DataTexture(Uint8Array.from(AUTHORED_PALETTE.data), AUTHORED_PALETTE.width, AUTHORED_PALETTE.height, THREE.RGBAFormat);
    palette.flipY = true;
    palette.needsUpdate = true;
  }
  palette.colorSpace = THREE.SRGBColorSpace;
  palette.minFilter = THREE.NearestFilter; palette.magFilter = THREE.NearestFilter;
  palette.generateMipmaps = false;
  if (!eyeMask) {
    eyeMask = new THREE.DataTexture(Uint8Array.from(AUTHORED_EYE_MASK.data), AUTHORED_EYE_MASK.width, AUTHORED_EYE_MASK.height, THREE.RedFormat);
    eyeMask.wrapS = eyeMask.wrapT = THREE.RepeatWrapping;
    eyeMask.minFilter = eyeMask.magFilter = THREE.LinearFilter;
    eyeMask.needsUpdate = true;
  }
  const material = createIllustratedMaterial({ color: "white", vertexColors: true, character: true, lighting: "world", grain: 0, outline: 0.85 });
  material.name = "Authored anime courier";
  material.uniforms.uAvatarAtlas = { value: palette };
  material.uniforms.uAvatarEyes = { value: eyeMask };
  material.uniforms.uAvatarSkin = { value: new THREE.Color("#f7dfd9") };
  material.uniforms.uAvatarHair = { value: new THREE.Color("#161c20") };
  material.uniforms.uAvatarTop = { value: new THREE.Color("#9ed68b") };
  material.uniforms.uAvatarDenim = { value: new THREE.Color("#788bac") };
  material.uniforms.uAvatarShoes = { value: new THREE.Color("#eee7d4") };
  material.uniforms.uAvatarBlink = { value: -1 };
  material.vertexShader = `in float partSlot; out float vPartSlot;\n` + material.vertexShader.replace("vUv = uv;", "vUv = uv; vPartSlot = partSlot;");
  material.fragmentShader = `
    in float vPartSlot;
    uniform sampler2D uAvatarAtlas;
    uniform sampler2D uAvatarEyes;
    uniform vec3 uAvatarSkin;
    uniform vec3 uAvatarHair;
    uniform vec3 uAvatarTop;
    uniform vec3 uAvatarDenim;
    uniform vec3 uAvatarShoes;
    uniform float uAvatarBlink;
  ` + material.fragmentShader
    .replace("vec3 base = vBaseColor;", `
      vec3 base = texture(uAvatarAtlas, vUv).rgb;
      // The skin swatch also occurs on exposed hands in the clothing pieces. Match its atlas coordinates,
      // retaining the separate mouth/brow and crease swatches carried by the authored face geometry.
      bool skinSwatch = distance(vUv, vec2(0.221631, 0.655798)) < 0.008;
      if (skinSwatch) base = uAvatarSkin;
      if (vPartSlot > 0.5 && vPartSlot < 1.5) base = uAvatarHair;
      if (vPartSlot > 1.5 && vPartSlot < 2.5 && !skinSwatch) {
        float warmCloth = step(base.g * 1.12, base.r) * step(base.b * 1.1, base.r);
        float value = clamp(dot(base, vec3(0.2126, 0.7152, 0.0722)) / 0.235, 0.68, 1.15);
        base = mix(base, uAvatarTop * value, warmCloth);
      }
      if (vPartSlot > 2.5 && vPartSlot < 3.5 && !skinSwatch) {
        float value = clamp(dot(base, vec3(0.2126, 0.7152, 0.0722)) / 0.085, 0.62, 1.12);
        base = uAvatarDenim * value;
      }
      if (vPartSlot > 3.5 && !skinSwatch) {
        float paleCanvas = smoothstep(0.14, 0.6, max(base.r, max(base.g, base.b)));
        base = mix(base, uAvatarShoes, paleCanvas);
      }
      if (vUv.y > 1.0) {
        float t = uTime * 3.0;
        float progress = max(0.0, max(max(mod(t, 22.0) - 21.0, mod(t, 34.0) - 33.0), mod(t, 57.0) - 56.0));
        float frame = uAvatarBlink < 0.0 ? floor(progress * 3.0) : uAvatarBlink;
        float mask = texture(uAvatarEyes, vec2(vUv.x * 0.25 + frame * 0.25, vUv.y)).r;
        float aa = max(length(vec2(dFdx(mask), dFdy(mask))) * 0.70710678, 0.0001);
        base = uAvatarSkin * (1.0 - smoothstep(0.5 - aa, 0.5 + aa, mask));
      }
    `)
    .replace("vec3 shade = shadeOf(vBaseColor);", "vec3 shade = shadeOf(base);");
  return material;
}
