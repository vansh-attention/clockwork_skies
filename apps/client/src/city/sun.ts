import * as THREE from "three";
import { illustratedEnvironment } from "@clockwork/render";

/** The light sits at least this far up-sun of the focus (and further for a bigger square); the shadow camera reaches as far again beyond it. */
const SUN_DISTANCE = 400;

/**
 * The town's sun: a directional light that casts the shadows the illustrated materials draw ("world" lighting).
 * Its direction is `illustratedEnvironment.uSunDirection`, so shading and shadows always agree. The shadow map is
 * fitted to a square around what matters (the courier while playing, the whole island otherwise) and snapped to
 * whole texels, so shadows stay put instead of shimmering as the camera moves.
 */
export class Sun {
  readonly light = new THREE.DirectionalLight(0xffffff, 1);
  private halfSize = 0;
  private distance = SUN_DISTANCE;
  private readonly direction = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();

  constructor(mapSize = 2048) {
    const { light } = this;
    light.name = "Sun";
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.6;
    light.shadow.radius = 1.5;
    light.target.name = "Sun target";
  }

  /** Both objects belong in the scene: three reads the target's world position for the light's direction. */
  get objects(): THREE.Object3D[] { return [this.light, this.light.target]; }

  /** Fit the shadow map to a square of `halfSize` around `focus`, snapped to texels. */
  follow(focus: Readonly<THREE.Vector3>, halfSize: number): void {
    if (!Number.isFinite(focus.x) || !Number.isFinite(focus.y) || !Number.isFinite(focus.z) || !(halfSize > 0)) return;
    const { direction, right, up, centre, light } = this;
    direction.copy(illustratedEnvironment.uSunDirection.value).normalize();
    right.set(0, 1, 0).cross(direction).normalize();
    up.copy(direction).cross(right).normalize();
    const texel = (2 * halfSize) / light.shadow.mapSize.x;
    const along = (axis: THREE.Vector3) => Math.round(focus.dot(axis) / texel) * texel;
    centre.copy(right).multiplyScalar(along(right)).addScaledVector(up, along(up)).addScaledVector(direction, focus.dot(direction));
    // A tight depth range keeps the bias (a fraction of it) small, so shadows sit on the ground instead of floating.
    const distance = Math.max(SUN_DISTANCE, halfSize * 2.5);
    light.target.position.copy(centre);
    light.position.copy(centre).addScaledVector(direction, distance);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    if (halfSize !== this.halfSize || distance !== this.distance) {
      this.halfSize = halfSize;
      this.distance = distance;
      const camera = light.shadow.camera;
      camera.left = -halfSize;
      camera.right = halfSize;
      camera.top = halfSize;
      camera.bottom = -halfSize;
      camera.near = 1;
      camera.far = distance * 2;
      camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.light.shadow.dispose();
    this.light.dispose();
  }
}
