// Development asset study, loaded only by the private artifact HTML (never imported by the game entry).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { IllustratedComposer, createIllustratedMaterial } from "@clockwork/render";

type AttributeData = { itemSize: number; array: number[] };
type GeometryData = { attributes: Record<string, AttributeData>; indices: number[] };
type Selection = { hair: string; top: string; bottom: string; shoes: string; face?: boolean; angle?: number };
const workspace = location.pathname.split("/artifacts/")[0];
const assets = `${workspace}/.claude/abeto-messenger/character-reference-assets`;
const read = async <T>(name: string): Promise<T> => {
  const response = await fetch(`${assets}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
};
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(800, 800);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor("#e5ddca");
document.querySelector("#canvas")!.append(renderer.domElement);
const composer = new IllustratedComposer(renderer);
composer.resize(800, 800);
composer.setThickness(0.8);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 30);
const scene = new THREE.Scene(), model = new THREE.Group();
scene.add(model);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
const ktx = new KTX2Loader().detectSupport(renderer);
const [atlas, eyes, rig, idle] = await Promise.all([
  new THREE.TextureLoader().loadAsync(`${assets}/atlas.png`),
  ktx.loadAsync(`${assets}/mainchar-eye-highq.ktx2`),
  read<{ attributes: Record<string, AttributeData> }>("avatar-bones.json"),
  read<{ bones: { position: number[]; quaternion: number[]; scale: number[] }[] }>("avatar-idle-pose.json"),
]);
atlas.colorSpace = THREE.SRGBColorSpace;
atlas.minFilter = THREE.NearestFilter; atlas.magFilter = THREE.NearestFilter;
eyes.wrapS = eyes.wrapT = THREE.RepeatWrapping;
const material = createIllustratedMaterial({ color: "white", vertexColors: true, character: true, lighting: "world", grain: 0, outline: 1 });
material.uniforms.uReferenceAtlas = { value: atlas };
material.uniforms.uReferenceEyes = { value: eyes };
material.uniforms.uReferenceSkin = { value: new THREE.Color("#ebced0") };
material.uniforms.uEyeFrame = { value: 0 };
material.fragmentShader = `
  uniform sampler2D uReferenceAtlas;
  uniform sampler2D uReferenceEyes;
  uniform vec3 uReferenceSkin;
  uniform float uEyeFrame;
  vec3 referenceColor(vec2 sourceUv) {
    vec3 base = texture(uReferenceAtlas, sourceUv).rgb;
    if (sourceUv.y > 1.0) {
      float mask = texture(uReferenceEyes, vec2(sourceUv.x * 0.25 + uEyeFrame * 0.25, sourceUv.y)).r;
      float aa = max(fwidth(mask), 0.0001);
      mask = smoothstep(0.5 - aa, 0.5 + aa, mask);
      base = uReferenceSkin * (1.0 - mask);
    }
    return base;
  }
` + material.fragmentShader
  .replace("vec3 base = vBaseColor;", "vec3 base = referenceColor(vUv);")
  .replace("vec3 shade = shadeOf(vBaseColor);", "vec3 shade = shadeOf(base);");
const bones = Array.from({ length: rig.attributes.hierarchy!.array.length }, (_, i) => {
  const bone = new THREE.Bone(); bone.name = `reference_${i}`;
  bone.position.fromArray(rig.attributes.position!.array, i * 3);
  bone.quaternion.fromArray(rig.attributes.quaternion!.array, i * 4);
  bone.scale.fromArray(rig.attributes.scale!.array, i * 3);
  return bone;
});
bones.forEach((bone, i) => {
  const parent = rig.attributes.hierarchy!.array[i]! - 1;
  if (parent >= 0) bones[parent]!.add(bone); else model.add(bone);
});
model.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton(bones);
skeleton.calculateInverses();
idle.bones.forEach((pose, i) => {
  bones[i]!.position.fromArray(pose.position);
  bones[i]!.quaternion.fromArray(pose.quaternion).normalize();
  bones[i]!.scale.fromArray(pose.scale);
});
const cache = new Map<string, Promise<THREE.SkinnedMesh>>();
const mesh = (name: string) => {
  if (!cache.has(name)) cache.set(name, (async () => {
    const data = await read<GeometryData>(`${name}-geometry.json`), geometry = new THREE.BufferGeometry();
    for (const [key, attribute] of Object.entries(data.attributes)) geometry.setAttribute(key, new THREE.BufferAttribute(key === "skinIndex" ? new Uint16Array(attribute.array) : new Float32Array(attribute.array), attribute.itemSize));
    const count = geometry.getAttribute("position").count;
    geometry.setIndex(data.indices);
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    const ids = data.attributes.surfaceId!.array;
    geometry.setAttribute("idShift", new THREE.BufferAttribute(Float32Array.from(ids, (id) => id * 0.7), 1));
    geometry.setAttribute("sway", new THREE.BufferAttribute(new Float32Array(count), 1));
    const object = new THREE.SkinnedMesh(geometry, material);
    object.name = name; object.frustumCulled = false;
    // Bind in the authored coordinate system; the common parent supplies the forward-axis conversion.
    object.bind(skeleton, new THREE.Matrix4());
    return object;
  })());
  return cache.get(name)!;
};
model.rotation.y = Math.PI;
let active: THREE.SkinnedMesh[] = [];
let selection: Selection = { hair: "hair1", top: "top1", bottom: "bottom1", shoes: "shoes1" };
const render = () => { model.updateMatrixWorld(true); composer.render(scene, camera); };
const show = async (next: Partial<Selection> = {}) => {
  selection = { ...selection, ...next };
  active.forEach((part) => model.remove(part));
  active = await Promise.all(["base", selection.hair, selection.top, selection.bottom, selection.shoes].map(mesh));
  active.forEach((part) => model.add(part));
  const distance = selection.face ? 0.85 : 2.7, angle = selection.angle ?? 0.25;
  controls.target.set(0, selection.face ? 1.475 : 0.83, 0);
  camera.position.set(Math.sin(angle) * distance, selection.face ? 1.49 : 0.95, -Math.cos(angle) * distance);
  controls.update(); render();
  document.querySelector("#status")!.textContent = `${selection.hair} · ${selection.top} · ${selection.bottom} · ${selection.shoes}`;
  return selection;
};
const grid = async (kind: "hair" | "top" | "bottom" | "shoes") => {
  const target = document.querySelector("#grid")!; target.replaceChildren();
  const previous = { ...selection }, count = kind === "top" ? 9 : 7;
  for (let i = 1; i <= count; i++) {
    const name = `${kind}${i}`;
    await show({ [kind]: name, face: kind === "hair", angle: 0.2 });
    const card = document.createElement("button"), image = document.createElement("img");
    image.src = renderer.domElement.toDataURL("image/png"); image.alt = name;
    card.append(image, document.createTextNode(name)); card.onclick = () => { void show({ [kind]: name }); };
    target.append(card);
  }
  await show(previous);
};
for (const kind of ["hair", "top", "bottom", "shoes"] as const) {
  const select = document.querySelector<HTMLSelectElement>(`#${kind}`)!;
  for (let i = 1; i <= (kind === "top" ? 9 : 7); i++) select.add(new Option(`${kind} ${i}`, `${kind}${i}`));
  select.onchange = () => { void show({ [kind]: select.value }); };
  document.querySelector<HTMLButtonElement>(`#grid-${kind}`)!.onclick = () => { void grid(kind); };
}
document.querySelector<HTMLButtonElement>("#face")!.onclick = () => { void show({ face: true }); };
document.querySelector<HTMLButtonElement>("#body")!.onclick = () => { void show({ face: false }); };
document.querySelector<HTMLButtonElement>("#blink")!.onclick = () => { material.uniforms.uEyeFrame!.value = material.uniforms.uEyeFrame!.value === 0 ? 2 : 0; render(); };
controls.addEventListener("change", render);
await show();
Object.assign(window, { __referenceStudy: { show, grid, render, bones, skeleton, model, material, renderer, camera }, __referenceStudyReady: true });
