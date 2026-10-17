import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SeededRandom } from "@clockwork/shared";
import { GATES, PICKUPS, ROCKS, STATIONS } from "./map";
import type { SpaceSession } from "./SpaceSession";
import { eyeOf } from "./flight";
import type { Ship } from "./types";

export class Resources {
  private readonly values = new Set<{ dispose(): void }>();

  own<R extends { dispose(): void }>(value: R): R {
    this.values.add(value);
    return value;
  }

  get size(): number { return this.values.size; }

  dispose(): void {
    for (const value of this.values) value.dispose();
    this.values.clear();
  }
}

function bake(geometry: T.BufferGeometry, colour: number): T.BufferGeometry {
  const normal = geometry.getAttribute("normal");
  const colours = new Float32Array(normal.count * 3);
  const base = new T.Color(colour);
  for (let i = 0; i < normal.count; i++) {
    const light = normal.getX(i) * 0.35 + normal.getY(i) * 0.7 + normal.getZ(i) * 0.4;
    const shade = light > 0.25 ? 1 : light > -0.25 ? 0.7 : 0.42;
    colours[i * 3] = base.r * shade;
    colours[i * 3 + 1] = base.g * shade;
    colours[i * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute("color", new T.BufferAttribute(colours, 3));
  return geometry;
}

export function buildSector(resources: Resources) {
  const temporary: T.BufferGeometry[] = [];
  try {
    const world = new T.Scene();
    world.background = new T.Color(0x070c17);
    const camera = new T.PerspectiveCamera(75, 1, 0.1, 3500);
    world.add(camera);
    const material = resources.own(new T.MeshBasicMaterial({ vertexColors: true }));
    for (const [i, solid] of STATIONS.entries()) {
      if (solid.kind !== "box") throw new Error("Station proxy must be a box");
      temporary.push(bake(new T.BoxGeometry(solid.half[0] * 2, solid.half[1] * 2, solid.half[2] * 2),
        i < 2 ? 0xd6ddcf : i < 4 ? 0xc77b50 : 0x77becb).translate(...solid.center));
    }
    const merged = mergeGeometries(temporary);
    if (!merged) throw new Error("Station geometry merge failed");
    const station = new T.Mesh(resources.own(merged), material);
    station.name = "Relay Hub / Dock / Broken Truss";
    world.add(station);

    const rocks = new T.InstancedMesh(
      resources.own(bake(new T.IcosahedronGeometry(1, 1), 0xa7b2bd)), material, ROCKS.length);
    const pose = new T.Object3D();
    ROCKS.forEach((rock, i) => {
      if (rock.kind !== "sphere") throw new Error("Rock proxy must be a sphere");
      pose.position.set(...rock.center);
      pose.scale.setScalar(rock.radius);
      pose.rotation.set(i * 0.37, i * 0.21, i * 0.13);
      pose.updateMatrix();
      rocks.setMatrixAt(i, pose.matrix);
    });
    rocks.computeBoundingSphere();
    rocks.name = "Asteroid clusters";
    world.add(rocks);

    const gates = new T.InstancedMesh(
      resources.own(new T.TorusGeometry(22, 0.8, 5, 32)),
      resources.own(new T.MeshBasicMaterial({ color: 0xffffff })), GATES.length);
    const colour = new T.Color();
    pose.rotation.set(0, 0, 0);
    pose.scale.setScalar(1);
    GATES.forEach((gate, i) => {
      pose.position.set(...gate);
      pose.updateMatrix();
      gates.setMatrixAt(i, pose.matrix);
      gates.setColorAt(i, colour.set(0x7ed9e8));
    });
    gates.computeBoundingSphere();
    world.add(gates);

    const pickups = new T.InstancedMesh(
      resources.own(new T.OctahedronGeometry(4)),
      resources.own(new T.MeshBasicMaterial({ color: 0xffffff })), PICKUPS.length);
    PICKUPS.forEach((pickup, i) => {
      pose.position.set(...pickup.at);
      pose.updateMatrix();
      pickups.setMatrixAt(i, pose.matrix);
      pickups.setColorAt(i, colour.set(pickup.kind === "repair" ? 0xef786b :
        pickup.kind === "energy" ? 0x7ed9e8 : 0xefca70));
    });
    pickups.computeBoundingSphere();
    world.add(pickups);

    const drones = new T.InstancedMesh(
      resources.own(bake(new T.ConeGeometry(1.5, 5, 5).rotateX(-Math.PI / 2), 0xf1d0a5)),
      material, 6);
    pose.scale.setScalar(0);
    pose.updateMatrix();
    for (let i = 0; i < drones.count; i++) drones.setMatrixAt(i, pose.matrix);
    drones.frustumCulled = false;
    world.add(drones);

    const rockets = new T.InstancedMesh(
      resources.own(new T.ConeGeometry(0.4, 2, 5).rotateX(-Math.PI / 2)),
      resources.own(new T.MeshBasicMaterial({ color: 0xefca70 })), 8);
    for (let i = 0; i < rockets.count; i++) rockets.setMatrixAt(i, pose.matrix);
    rockets.frustumCulled = false;
    world.add(rockets);

    const traceGeometry = resources.own(new T.BufferGeometry());
    const tracePositions = new Float32Array(24 * 6);
    traceGeometry.setAttribute("position", new T.BufferAttribute(tracePositions, 3));
    const traces = new T.LineSegments(traceGeometry,
      resources.own(new T.LineBasicMaterial({ color: 0xffdb85 })));
    traces.frustumCulled = false;
    world.add(traces);

    const rng = new SeededRandom(451);
    const positions = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const y = rng.range(-1, 1), angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(1 - y * y) * 2400;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y * 2400;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const starGeometry = resources.own(new T.BufferGeometry());
    starGeometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    const stars = new T.Points(starGeometry, resources.own(new T.PointsMaterial({
      color: 0xc3d0dc, size: 1.1, sizeAttenuation: false, depthWrite: false,
    })));
    stars.frustumCulled = false;
    stars.renderOrder = -1;
    world.add(stars);
    const sill = new T.Mesh(resources.own(new T.BoxGeometry(1.25, 0.12, 0.18)),
      resources.own(new T.MeshBasicMaterial({ color: 0x253443 })));
    sill.position.set(0, -0.67, -1);
    camera.add(sill);
    return { world, camera, station, rocks, gates, pickups, drones, rockets,
      stars, traces, tracePositions };
  } catch (error) {
    resources.dispose();
    throw error;
  } finally {
    for (const geometry of temporary) geometry.dispose();
  }
}

export class SectorUpdater {
  private readonly pose = new T.Object3D();
  private readonly colour = new T.Color();
  private readonly velocity = new T.Vector3();
  private readonly forward = new T.Vector3(0, 0, -1);

  constructor(private readonly sector: ReturnType<typeof buildSector>) {}

  updateActors(session: SpaceSession, alpha: number): void {
    const { drones, gates, pickups } = this.sector;
    const pose = this.pose;
    const blend = Math.max(0, Math.min(1, alpha));
    for (let i = 0; i < drones.count; i++) {
      const ship = session.drones[i]!;
      pose.position.lerpVectors(ship.prevP, ship.p, blend);
      pose.quaternion.slerpQuaternions(ship.prevQ, ship.q, blend);
      pose.scale.setScalar(ship.hull > 0 ? 1 : 0);
      pose.updateMatrix();
      drones.setMatrixAt(i, pose.matrix);
    }
    drones.instanceMatrix.needsUpdate = true;

    pose.quaternion.identity();
    for (let i = 0; i < gates.count; i++) {
      pose.position.set(...GATES[i]!);
      pose.scale.setScalar(session.mode === "training" ? 1 : 0);
      pose.updateMatrix();
      gates.setMatrixAt(i, pose.matrix);
      gates.setColorAt(i, this.colour.set(i === session.gate ? 0x7ed9e8 :
        i < session.gate ? 0x3c555c : 0x455666));
    }
    gates.instanceMatrix.needsUpdate = true;
    if (gates.instanceColor) gates.instanceColor.needsUpdate = true;

    for (let i = 0; i < pickups.count; i++) {
      pose.position.set(...PICKUPS[i]!.at);
      pose.scale.setScalar(session.pickupAt[i]! <= session.time ? 1 : 0);
      pose.updateMatrix();
      pickups.setMatrixAt(i, pose.matrix);
    }
    pickups.instanceMatrix.needsUpdate = true;
  }

  updateEffects(session: SpaceSession, alpha: number): void {
    const { rockets, traces, tracePositions } = this.sector;
    const pose = this.pose;
    const blend = Math.max(0, Math.min(1, alpha));
    for (let i = 0; i < rockets.count; i++) {
      const rocket = session.combat.rockets[i]!;
      pose.position.lerpVectors(rocket.prev, rocket.p, blend);
      if (rocket.active && rocket.v.lengthSq() > 0) {
        pose.quaternion.setFromUnitVectors(this.forward, this.velocity.copy(rocket.v).normalize());
      } else pose.quaternion.identity();
      pose.scale.setScalar(rocket.active ? 1 : 0);
      pose.updateMatrix();
      rockets.setMatrixAt(i, pose.matrix);
    }
    rockets.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < session.combat.traces.length; i++) {
      const trace = session.combat.traces[i]!;
      const j = i * 6;
      tracePositions[j] = trace.active ? trace.a.x : 0;
      tracePositions[j + 1] = trace.active ? trace.a.y : 0;
      tracePositions[j + 2] = trace.active ? trace.a.z : 0;
      tracePositions[j + 3] = trace.active ? trace.b.x : 0;
      tracePositions[j + 4] = trace.active ? trace.b.y : 0;
      tracePositions[j + 5] = trace.active ? trace.b.z : 0;
    }
    (traces.geometry.getAttribute("position") as T.BufferAttribute).needsUpdate = true;
  }
}

export function updateCockpitCamera(camera: T.PerspectiveCamera, ship: Ship): void {
  camera.quaternion.copy(ship.q);
  eyeOf(ship, camera.position);
  camera.updateMatrixWorld();
}

export function fitIndicator(x: number, y: number, behind: boolean,
  out: { x: number; y: number; bearing: number; offscreen: boolean }): void {
  x = Number.isFinite(x) ? x : 0.8;
  y = Number.isFinite(y) ? y : 0;
  if (behind) { x *= -1; y *= -1; }
  out.offscreen = behind || Math.abs(x) > 0.8 || Math.abs(y) > 0.65;
  if (out.offscreen) {
    if (Math.abs(x) + Math.abs(y) < 1e-8) x = 0.8;
    const scale = 1 / Math.max(Math.abs(x) / 0.8, Math.abs(y) / 0.65);
    x *= scale; y *= scale;
  }
  out.bearing = Math.atan2(-y, x) * 180 / Math.PI + 90;
  out.x = 50 + x * 50;
  out.y = 50 - y * 50;
}

type SceneOptions = {
  rendererFactory?: () => T.WebGLRenderer;
  observerFactory?: (callback: ResizeObserverCallback) => ResizeObserver;
  sectorFactory?: typeof buildSector;
};

export class SpaceScene {
  readonly resources = new Resources();
  readonly sector!: ReturnType<typeof buildSector>;
  readonly renderer!: T.WebGLRenderer;
  readonly marker = { x: 50, y: 50, behind: false, offscreen: false, bearing: 0,
    kind: "none" as "gate" | "target" | "none", distance: 0, hull: 0 };
  private updater!: SectorUpdater;
  private observer: ResizeObserver | null = null;
  private readonly point = new T.Vector3();
  private readonly buffer = new T.Vector2();
  private quality: "medium" | "low" = "medium";
  private disposed = false;
  maxCalls = 0;
  maxTriangles = 0;

  constructor(private readonly mount: HTMLElement, options: SceneOptions = {}) {
    let renderer: T.WebGLRenderer | undefined;
    let observer: ResizeObserver | undefined;
    try {
      this.sector = (options.sectorFactory ?? buildSector)(this.resources);
      this.updater = new SectorUpdater(this.sector);
      renderer = options.rendererFactory?.() ?? new T.WebGLRenderer({
        antialias: true, powerPreference: "high-performance",
      });
      this.renderer = renderer;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.setPixelRatio(1);
      renderer.domElement.tabIndex = 0;
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      renderer.domElement.setAttribute("aria-label", "Space flight canvas");
      mount.appendChild(renderer.domElement);
      observer = (options.observerFactory ?? ((callback) => new ResizeObserver(callback)))(this.resize);
      this.observer = observer;
      observer.observe(mount);
      this.resize();
      renderer.compile(this.sector.world, this.sector.camera);
    } catch (error) {
      observer?.disconnect();
      this.resources.dispose();
      renderer?.renderLists.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      throw error;
    }
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  setQuality(quality: "medium" | "low"): void {
    this.quality = quality;
    this.resize();
  }

  private resize = (): void => {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    const scale = this.quality === "low" ? Math.min(1, 1280 / width, 720 / height) : 1;
    this.renderer.setSize(Math.round(width * scale), Math.round(height * scale), false);
    this.sector.camera.aspect = width / height;
    this.sector.camera.updateProjectionMatrix();
  };

  update(session: SpaceSession, alpha: number): void {
    const { world, camera, stars } = this.sector;
    updateCockpitCamera(camera, session.player);
    stars.position.copy(camera.position);
    this.updater.updateActors(session, alpha);
    this.updater.updateEffects(session, alpha);

    const gate = session.mode === "training" ? GATES[session.gate] : undefined;
    let target: Ship | undefined;
    let distanceSq = Infinity;
    for (const drone of session.drones) {
      if (drone.hull <= 0) continue;
      const nextDistance = drone.p.distanceToSquared(session.player.p);
      if (nextDistance < distanceSq) { target = drone; distanceSq = nextDistance; }
      if (drone.id === session.player.lockId) { target = drone; break; }
    }
    const locked = target?.id === session.player.lockId;
    const objectiveGate = locked ? undefined : gate;
    this.marker.kind = objectiveGate ? "gate" : target ? "target" : "none";
    if (objectiveGate) this.point.set(...objectiveGate);
    else if (target) this.point.copy(target.p);
    else this.point.copy(session.player.p);
    this.marker.distance = this.point.distanceTo(session.player.p);
    this.marker.hull = objectiveGate ? 0 : target?.hull ?? 0;
    this.point.applyMatrix4(camera.matrixWorldInverse);
    this.marker.behind = this.point.z >= 0;
    this.point.applyMatrix4(camera.projectionMatrix);
    fitIndicator(this.point.x, this.point.y, this.marker.behind, this.marker);
    try {
      this.renderer.render(world, camera);
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.maxCalls = Math.max(this.maxCalls, this.renderer.info.render.calls);
    this.maxTriangles = Math.max(this.maxTriangles, this.renderer.info.render.triangles);
  }

  diagnostics() {
    const gl = this.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "unavailable";
    this.renderer.getDrawingBufferSize(this.buffer);
    return { renderer, calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      maxCalls: this.maxCalls, maxTriangles: this.maxTriangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      resourceCount: this.resources.size,
      width: this.buffer.x, height: this.buffer.y };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    this.resources.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
