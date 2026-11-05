import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CLOCKWORK_WORLD, PAINTS } from "@clockwork/content";
import { MATCH_RULES, V, angularDistance, type MatchEvent, type MatchState, type InputCommand } from "@clockwork/shared";
import { createIllustratedMaterial, IllustratedComposer, type DebugView } from "@clockwork/render";

export type HudState = {
  phase: string;
  alive: number;
  hull: number;
  shield: number;
  boost: number;
  heat: number;
  rockets: number;
  speed: number;
  altitude: number;
  stormDistance: number;
  status: string;
  kills: number;
  target: string | null;
  sightX?: number;
  sightY?: number;
};

const tmp = new THREE.Vector3();

export class GameScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: IllustratedComposer;
  private readonly world = new THREE.Scene();
  private readonly overlay = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1500);
  private readonly playerMeshes = new Map<string, THREE.Group>();
  private readonly pickupMeshes = new Map<string, THREE.Object3D>();
  private readonly propellers: THREE.Object3D[] = [];
  private readonly gears: THREE.Object3D[] = [];
  private readonly clock = new THREE.Clock();
  private readonly stormLine: THREE.LineLoop;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private frame = 0;
  private state: MatchState | null = null;
  private sessionId = "";
  private debugView: DebugView = "final";
  private fpsSamples: number[] = [];
  private pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  private targetId: string | null = null;
  private sightScreen = { x: 50, y: 50 };
  private eventFlash = 0;
  private readonly shotLines = new Map<THREE.Line, number>();
  private readonly rocketMeshes = new Map<string, THREE.Mesh>();
  private readonly cockpit = new THREE.Group();
  private hudElapsed = 0;
  private flightInput: InputCommand | null = null;
  private spectatorId: string | null = null;

  constructor(private readonly container: HTMLDivElement, private readonly onHud: (state: HudState) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x75bdc3, 1);
    this.renderer.domElement.setAttribute("aria-label", "Clockwork Skies flight view. Click to capture the mouse.");
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.composer = new IllustratedComposer(this.renderer);
    this.composer.setThickness(1.15);
    this.world.background = new THREE.Color(0x75bdc3);
    this.camera.position.set(0, 180, 820);
    this.camera.lookAt(0, 0, 0);
    this.world.add(this.camera);
    this.buildWorld();
    this.stormLine = this.createStormLine();
    this.overlay.add(this.stormLine);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.animate();
  }

  get canvas() { return this.renderer.domElement; }
  get rocketTargetId() { return this.targetId; }
  setIdentity(sessionId: string) { this.sessionId = sessionId; }
  setState(state: MatchState | null) {
    this.state = state; this.stormLine.visible = !!state;
    if (!state) {
      for (const mesh of this.playerMeshes.values()) mesh.visible = false;
      for (const mesh of this.rocketMeshes.values()) mesh.visible = false;
      this.targetId = null; this.spectatorId = null;
    }
  }
  setReducedMotion(value: boolean) { this.reducedMotion = value; }
  setFlightInput(value: InputCommand | null) { this.flightInput = value; }
  cycleSpectator() {
    const ids = Object.values(this.state?.players ?? {}).filter((player) => player.status === "active").map((player) => player.id);
    this.spectatorId = ids[(ids.indexOf(this.spectatorId ?? "") + 1) % ids.length] ?? null;
  }
  setDebugView(view: DebugView) { this.debugView = view; this.composer.setDebugView(view); }
  flash(event: MatchEvent) {
    if (event.type === "damage" && event.playerId === this.sessionId) this.eventFlash = 1;
    if (event.type !== "shot") return;
    const player = this.state?.players[event.playerId]; if (!player) return;
    const p = new THREE.Vector3(player.aircraft.position.x, player.aircraft.position.y, player.aircraft.position.z);
    const f = new THREE.Vector3(player.aircraft.forward.x, player.aircraft.forward.y, player.aircraft.forward.z);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(f, 7), p.clone().addScaledVector(f, 130)]), new THREE.LineBasicMaterial({ color: 0xffdf80, transparent: true, opacity: 0.9 }));
    this.overlay.add(line); this.shotLines.set(line, 0.09);
  }

  private buildWorld() {
    const planet = new THREE.Mesh(
      new THREE.IcosahedronGeometry(CLOCKWORK_WORLD.planetRadius, 5),
      createIllustratedMaterial({ color: "#6f9b88", shadow: "#385f58", surfaceId: 0.08, grain: 0.025 }),
    );
    planet.name = "Clockwork Prime";
    this.world.add(planet);
    // Curved orchard plates and longitude seams make altitude and motion readable.
    CLOCKWORK_WORLD.landmarks.forEach((landmark, index) => {
      const plate = new THREE.Mesh(new THREE.SphereGeometry(CLOCKWORK_WORLD.planetRadius + 0.7, 28, 10, 0, Math.PI * 2, 0, 0.20 + (index % 3) * 0.025), createIllustratedMaterial({ color: index % 2 ? "#b4b783" : "#91ad86", shadow: "#637a62", surfaceId: 0.10 + index * 0.004, outline: 0.3 }));
      plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(landmark.direction.x, landmark.direction.y, landmark.direction.z));
      this.world.add(plate);
    });
    for (let seam = 0; seam < 4; seam++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(CLOCKWORK_WORLD.planetRadius + 0.9, 0.6, 4, 100), createIllustratedMaterial({ color: "#b8b797", shadow: "#81927b", surfaceId: 0.12, outline: 0.25 }));
      ring.rotation.y = seam * Math.PI / 4; this.world.add(ring);
    }

    const latheRing = new THREE.Mesh(
      new THREE.TorusGeometry(CLOCKWORK_WORLD.planetRadius + 4, 3.5, 7, 160),
      createIllustratedMaterial({ color: "#c66a47", shadow: "#713e36", surfaceId: 0.14 }),
    );
    latheRing.rotation.x = Math.PI / 2;
    latheRing.rotation.z = 0.38;
    this.world.add(latheRing);
    this.gears.push(latheRing);

    CLOCKWORK_WORLD.landmarks.forEach((landmark, index) => {
      const group = new THREE.Group();
      group.name = landmark.name;
      this.placeOnPlanet(group, landmark.direction, 3);
      const ink = createIllustratedMaterial({ color: "#384946", shadow: "#202b2a", surfaceId: 0.2 + index * 0.015 });
      const cream = createIllustratedMaterial({ color: index % 2 ? "#e9e2cf" : "#d9ddc7", shadow: "#8f9588", surfaceId: 0.35 + index * 0.02 });
      const accent = createIllustratedMaterial({ color: landmark.accent, shadow: "#6e493c", surfaceId: 0.55 + index * 0.02 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(landmark.radius * 0.58, landmark.radius * 0.72, 8, 10), ink);
      base.position.y = 4;
      group.add(base);
      for (let tower = 0; tower < 3 + (index % 3); tower += 1) {
        const angle = tower / (3 + (index % 3)) * Math.PI * 2;
        const height = 13 + ((tower + index) % 3) * 6;
        const building = new THREE.Mesh(new THREE.BoxGeometry(10, height, 10), cream);
        building.position.set(Math.cos(angle) * landmark.radius * 0.35, 8 + height / 2, Math.sin(angle) * landmark.radius * 0.35);
        building.rotation.y = -angle + 0.25;
        group.add(building);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(8, 7, 4), accent);
        roof.position.copy(building.position); roof.position.y += height / 2 + 3.5; roof.rotation.y = Math.PI / 4;
        group.add(roof);
      }
      if (index % 2 === 0) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 32, 8), ink);
        mast.position.y = 25; group.add(mast);
        const blades = new THREE.Group(); blades.position.y = 39; blades.rotation.x = Math.PI / 2;
        for (let blade = 0; blade < 4; blade += 1) {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 22, 1.4), accent);
          mesh.position.y = 10; mesh.rotation.z = blade * Math.PI / 2; blades.add(mesh);
        }
        group.add(blades); this.propellers.push(blades);
      } else {
        const gear = new THREE.Mesh(new THREE.TorusGeometry(15, 3, 6, 18), accent);
        gear.position.y = 22; gear.rotation.x = Math.PI / 2; group.add(gear); this.gears.push(gear);
      }
      this.world.add(group);
    });

    const cottages: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[][] = [[], []];
    CLOCKWORK_WORLD.landmarks.forEach((landmark, district) => {
      const center = new THREE.Vector3(landmark.direction.x, landmark.direction.y, landmark.direction.z);
      const tangent = new THREE.Vector3().crossVectors(center,
        Math.abs(center.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(center, tangent).normalize();
      for (let house = 0; house < 12; house += 1) {
        const angle = house * Math.PI * (3 - Math.sqrt(5));
        const distance = 28 + house % 4 * 7;
        const direction = center.clone().addScaledVector(tangent, Math.cos(angle) * distance / CLOCKWORK_WORLD.planetRadius)
          .addScaledVector(bitangent, Math.sin(angle) * distance / CLOCKWORK_WORLD.planetRadius).normalize();
        const height = 7 + (house + district) % 4 * 2;
        const transform = new THREE.Matrix4().compose(
          direction.clone().multiplyScalar(CLOCKWORK_WORLD.planetRadius + 1),
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
          new THREE.Vector3(1, 1, 1));
        cottages.push(new THREE.BoxGeometry(7, height, 7).translate(0, height * 0.5, 0).applyMatrix4(transform));
        roofs[(house + district) % 2]!.push(new THREE.ConeGeometry(6, 5, 4)
          .rotateY(Math.PI / 4).translate(0, height + 2.5, 0).applyMatrix4(transform));
      }
    });
    const cottageGeometry = mergeGeometries(cottages);
    if (cottageGeometry) this.world.add(new THREE.Mesh(cottageGeometry,
      createIllustratedMaterial({ color: "#eee9d6", shadow: "#a4ac9c", surfaceId: 0.59 })));
    cottages.forEach(part => part.dispose());
    ["#bd6445", "#d19b5a"].forEach((color, index) => {
      const geometry = mergeGeometries(roofs[index]!);
      if (geometry) this.world.add(new THREE.Mesh(geometry,
        createIllustratedMaterial({ color, shadow: "#754e42", surfaceId: 0.61 + index * 0.01 })));
      roofs[index]!.forEach(part => part.dispose());
    });

    // Merge small orchard silhouettes into a handful of draw calls. They give
    // the globe a readable scale in both the title view and following camera.
    const trunks: THREE.BufferGeometry[] = [];
    const canopies: THREE.BufferGeometry[][] = [[], [], []];
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < 210; index += 1) {
      const y = 1 - 2 * (index + 0.5) / 210;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const direction = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      const transform = new THREE.Matrix4().compose(
        direction.clone().multiplyScalar(CLOCKWORK_WORLD.planetRadius + 1),
        new THREE.Quaternion().setFromUnitVectors(up, direction), new THREE.Vector3(1, 1, 1));
      const height = 16 + index % 5 * 3;
      trunks.push(new THREE.CylinderGeometry(1.2, 1.8, 7, 5).translate(0, 4, 0).applyMatrix4(transform));
      canopies[index % 3]!.push(new THREE.ConeGeometry(7 + index % 3, height, 6)
        .translate(0, 8 + height * 0.5, 0).applyMatrix4(transform));
    }
    const trunkGeometry = mergeGeometries(trunks);
    if (trunkGeometry) this.world.add(new THREE.Mesh(trunkGeometry,
      createIllustratedMaterial({ color: "#826f54", shadow: "#4b4e42", surfaceId: 0.69 })));
    trunks.forEach(geometry => geometry.dispose());
    ["#43845b", "#5d9967", "#86a96b"].forEach((color, index) => {
      const geometry = mergeGeometries(canopies[index]!);
      if (geometry) this.world.add(new THREE.Mesh(geometry,
        createIllustratedMaterial({ color, shadow: "#416a51", surfaceId: 0.71 + index * 0.01 })));
      canopies[index]!.forEach(part => part.dispose());
    });

    for (let i = 0; i < 54; i += 1) {
      const direction = new THREE.Vector3(
        Math.sin(i * 12.989) * 0.8,
        Math.cos(i * 7.23),
        Math.sin(i * 4.77),
      ).normalize();
      const cloud = new THREE.Group();
      this.placeOnPlanet(cloud, direction, 95 + (i % 4) * 7);
      const cloudMaterial = createIllustratedMaterial({ color: "#e7e8db", shadow: "#9fb2ab", surfaceId: 0.76 + (i % 5) * 0.002, grain: 0.05 });
      for (let puff = 0; puff < 3; puff += 1) {
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(7 + ((i + puff) % 4) * 2, 2), cloudMaterial);
        mesh.position.set((puff - 1) * 8, Math.sin(puff) * 3, 0); cloud.add(mesh);
      }
      this.world.add(cloud);
    }

    CLOCKWORK_WORLD.pickupNodes.forEach((pickup, index) => {
      const material = createIllustratedMaterial({ color: ["#d46b4f", "#dfaa45", "#66a990", "#8b7ab2"][index % 4]!, shadow: "#45524d", surfaceId: 0.84 + index * 0.001 });
      const marker = new THREE.Mesh(new THREE.TorusGeometry(6, 1.5, 6, 18), material);
      marker.position.copy(tmp.set(pickup.direction.x, pickup.direction.y, pickup.direction.z).multiplyScalar(CLOCKWORK_WORLD.planetRadius + pickup.altitude));
      marker.lookAt(0, 0, 0); marker.name = pickup.id; this.world.add(marker); this.pickupMeshes.set(pickup.id, marker);
    });

    const specks = new THREE.BufferGeometry();
    const positions = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i += 1) {
      const radius = 650 + (i % 7) * 50; const phi = Math.acos(1 - 2 * ((i + 0.5) / 420)); const theta = i * 2.39996;
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(phi) * radius;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }
    specks.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // Even decorative points must write both MRT attachments. A stock PointsMaterial
    // only writes color and causes GL_INVALID_OPERATION on the two-buffer world pass.
    const pointMaterial = new THREE.ShaderMaterial({
      name: "ClockworkSkyPoints", glslVersion: THREE.GLSL3,
      uniforms: { uColor: { value: new THREE.Color(0xdff0ea) } },
      vertexShader: `out float vDepth; void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip; gl_PointSize = 1.8;
        vDepth = 1.0 - (0.5 * clip.z / clip.w + 0.5);
      }`,
      fragmentShader: `precision highp float; uniform vec3 uColor; in float vDepth;
        layout(location = 0) out vec4 outColor;
        layout(location = 1) out vec4 outInfo;
        void main() { outColor = vec4(uColor, 0.99); outInfo = vec4(vDepth, 0.5, 0.5, 0.0); }
      `,
    });
    this.world.add(new THREE.Points(specks, pointMaterial));
    this.buildCockpit();
  }

  private buildCockpit() {
    const cockpit = this.cockpit;
    cockpit.visible = false;
    cockpit.name = "First person cockpit";
    const dark = createIllustratedMaterial({ color: "#344542", shadow: "#172321", surfaceId: 0.93 });
    const copper = createIllustratedMaterial({ color: "#b86143", shadow: "#60362e", surfaceId: 0.95 });
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.65, 2.4), dark); left.position.set(-1.25, -1.12, -2.1); left.rotation.y = -0.18;
    const right = left.clone(); right.position.x = 1.25; right.rotation.y = 0.18;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.48, 0.65), dark); dash.position.set(0, -1.25, -1.9);
    const sight = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 5, 20), copper); sight.position.set(0, -0.05, -2.4); sight.name = "Cannon sight";
    cockpit.add(left, right, dash, sight); this.camera.add(cockpit);
  }

  private createPlane(paintId: string) {
    const paint = PAINTS.find((candidate) => candidate.id === paintId) ?? PAINTS[0];
    const group = new THREE.Group();
    const body = createIllustratedMaterial({ color: paint.body, shadow: "#7c8178", surfaceId: 0.62 });
    const accent = createIllustratedMaterial({ color: paint.accent, shadow: "#64392f", surfaceId: 0.66 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.7, 8, 8), body); fuselage.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 8), accent); nose.rotation.x = -Math.PI / 2; nose.position.z = -5.5;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(10, 0.35, 3), body); wings.position.z = 0.5;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1.8), accent); tail.position.z = 3.7;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 2), accent); fin.position.set(0, 1.4, 3.2);
    const prop = new THREE.Group(); prop.position.z = -7;
    for (let i = 0; i < 3; i += 1) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.2), accent); blade.rotation.z = i * Math.PI * 2 / 3; prop.add(blade); }
    group.add(fuselage, nose, wings, tail, fin, prop); group.userData.propeller = prop; this.propellers.push(prop);
    return group;
  }

  private createStormLine() {
    const geometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, () => new THREE.Vector3()));
    const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: 0xe7634f, transparent: true, opacity: 0.85, linewidth: 2 }));
    // Vertices are rewritten as the zone moves; initial all-zero bounds are stale.
    line.frustumCulled = false;
    return line;
  }

  private updateStormLine() {
    if (!this.state) return;
    const center = tmp.set(this.state.storm.center.x, this.state.storm.center.y, this.state.storm.center.z).normalize();
    const reference = Math.abs(center.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangentA = new THREE.Vector3().crossVectors(center, reference).normalize();
    const tangentB = new THREE.Vector3().crossVectors(center, tangentA).normalize();
    const points = this.stormLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    const radius = CLOCKWORK_WORLD.planetRadius + 105;
    for (let i = 0; i < points.count; i += 1) {
      const angle = i / (points.count - 1) * Math.PI * 2;
      const p = center.clone().multiplyScalar(Math.cos(this.state.storm.angularRadius))
        .add(tangentA.clone().multiplyScalar(Math.cos(angle) * Math.sin(this.state.storm.angularRadius)))
        .add(tangentB.clone().multiplyScalar(Math.sin(angle) * Math.sin(this.state.storm.angularRadius)))
        .multiplyScalar(radius);
      points.setXYZ(i, p.x, p.y, p.z);
    }
    points.needsUpdate = true;
  }

  private placeOnPlanet(group: THREE.Group, directionValue: { x: number; y: number; z: number }, altitude: number) {
    const direction = tmp.set(directionValue.x, directionValue.y, directionValue.z).normalize();
    group.position.copy(direction).multiplyScalar(CLOCKWORK_WORLD.planetRadius + altitude);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  }

  private syncState() {
    if (!this.state) return;
    const playerIds = new Set(Object.keys(this.state.players));
    for (const [id, mesh] of this.playerMeshes) if (!playerIds.has(id)) { this.world.remove(mesh); this.playerMeshes.delete(id); }
    for (const [id, player] of Object.entries(this.state.players)) {
      if (id === this.sessionId) continue;
      let mesh = this.playerMeshes.get(id);
      if (!mesh) { mesh = this.createPlane(player.paint); this.playerMeshes.set(id, mesh); this.world.add(mesh); }
      mesh.visible = player.status === "active";
      mesh.position.lerp(tmp.set(player.aircraft.position.x, player.aircraft.position.y, player.aircraft.position.z), 0.3);
      mesh.up.copy(mesh.position).normalize();
      mesh.lookAt(tmp.copy(mesh.position).add(new THREE.Vector3(player.aircraft.forward.x, player.aircraft.forward.y, player.aircraft.forward.z)));
      mesh.rotateY(Math.PI); // Group.lookAt points +Z; the model nose points -Z.
    }
    for (const [id, mesh] of this.pickupMeshes) mesh.visible = this.state.pickups[id]?.active ?? false;
    for (const [id, mesh] of this.rocketMeshes) if (!this.state.projectiles[id]) { this.world.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); this.rocketMeshes.delete(id); }
    for (const [id, rocket] of Object.entries(this.state.projectiles)) {
      let mesh = this.rocketMeshes.get(id);
      if (!mesh) { mesh = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 6), createIllustratedMaterial({ color: "#efbe67", shadow: "#b65839", surfaceId: 0.92 })); this.rocketMeshes.set(id, mesh); this.world.add(mesh); }
      mesh.visible = true; mesh.position.set(rocket.position.x, rocket.position.y, rocket.position.z);
      const direction = new THREE.Vector3(rocket.velocity.x, rocket.velocity.y, rocket.velocity.z).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    }
    this.updateStormLine();
    this.targetId = this.findTarget();
  }

  private findTarget() {
    if (!this.state) return null;
    const local = this.state.players[this.sessionId]; if (!local || local.status !== "active") return null;
    const origin = new THREE.Vector3(local.aircraft.position.x, local.aircraft.position.y, local.aircraft.position.z);
    const forward = new THREE.Vector3(local.aircraft.forward.x, local.aircraft.forward.y, local.aircraft.forward.z).normalize();
    let best: { id: string; angle: number } | null = null;
    for (const [id, player] of Object.entries(this.state.players)) {
      if (id === this.sessionId || player.status !== "active") continue;
      const offset = new THREE.Vector3(player.aircraft.position.x, player.aircraft.position.y, player.aircraft.position.z).sub(origin);
      if (offset.length() > MATCH_RULES.rocket.lockRange) continue;
      const angle = Math.acos(THREE.MathUtils.clamp(forward.dot(offset.normalize()), -1, 1));
      if (angle < 0.42 && (!best || angle < best.angle)) best = { id, angle };
    }
    return best?.id ?? null;
  }

  private updateCamera(elapsed: number) {
    const local = this.state?.players[this.sessionId];
    this.cockpit.visible = !!local && (local.status === "active" || local.status === "winner");
    if (!local || local.status === "lobby" || this.state?.phase === "lobby") {
      const speed = this.reducedMotion ? 0 : elapsed * 0.06;
      this.camera.position.set(Math.sin(speed) * 690, 270, Math.cos(speed) * 690);
      this.camera.up.set(0, 1, 0); this.camera.lookAt(0, 0, 0); return;
    }
    if (local.status === "spectating" || local.status === "redeploying") {
      const target = (this.spectatorId ? this.state!.players[this.spectatorId] : null);
      const followed = target?.status === "active" ? target : Object.values(this.state!.players).find((player) => player.status === "active");
      if (followed) this.spectatorId = followed.id;
      if (!followed) return;
      const p = new THREE.Vector3(followed.aircraft.position.x, followed.aircraft.position.y, followed.aircraft.position.z);
      const up = p.clone().normalize(); const forward = new THREE.Vector3(followed.aircraft.forward.x, followed.aircraft.forward.y, followed.aircraft.forward.z).normalize();
      this.camera.position.lerp(p.clone().add(up.multiplyScalar(18)).sub(forward.multiplyScalar(32)), 0.08);
      this.camera.up.copy(p).normalize(); this.camera.lookAt(p); return;
    }
    const p = new THREE.Vector3(local.aircraft.position.x, local.aircraft.position.y, local.aircraft.position.z);
    const forward = new THREE.Vector3(local.aircraft.forward.x, local.aircraft.forward.y, local.aircraft.forward.z).normalize();
    this.camera.position.copy(p).addScaledVector(forward, 1.8).addScaledVector(p.clone().normalize(), 1.25);
    this.camera.up.copy(p).normalize();
    if (!this.reducedMotion && !this.flightInput?.rearView) this.camera.up.applyAxisAngle(forward, -(this.flightInput?.fineRoll ?? 0) * 0.22);
    // A miniature planet's horizon lies far below tangent flight. Look through the
    // lower windscreen, but PROJECT the true cannon direction rather than moving aim.
    const radialUp = p.clone().normalize();
    const viewDirection = forward.clone().multiplyScalar(this.flightInput?.rearView ? -1 : 1).addScaledVector(radialUp, -0.5).normalize();
    this.camera.lookAt(this.camera.position.clone().addScaledVector(viewDirection, 100));
    this.camera.updateMatrixWorld();
    const weaponPoint = this.camera.position.clone().addScaledVector(forward, 100);
    const projected = weaponPoint.clone().project(this.camera);
    this.sightScreen = { x: (projected.x + 1) * 50, y: (1 - projected.y) * 50 };
    const sight = this.cockpit.getObjectByName("Cannon sight");
    if (sight) sight.position.copy(this.camera.worldToLocal(weaponPoint)).normalize().multiplyScalar(2.4);
    this.cockpit.visible = !this.flightInput?.rearView;
  }

  private updateHud(dt: number) {
    this.hudElapsed += dt;
    if (this.hudElapsed < 0.1) return;
    this.hudElapsed = 0;
    const local = this.state?.players[this.sessionId]; if (!this.state || !local) return;
    const alive = Object.values(this.state.players).filter((player) => player.status === "active" || player.status === "redeploying").length;
    const altitude = Math.max(0, Math.round(V.length(local.aircraft.position) - MATCH_RULES.planetRadius));
    const stormDistance = angularDistance(local.aircraft.position, this.state.storm.center) - this.state.storm.angularRadius;
    this.onHud({ phase: this.state.phase, alive, hull: local.aircraft.hull, shield: local.aircraft.shield, boost: local.aircraft.boost,
      heat: local.aircraft.cannonHeat, rockets: local.aircraft.rockets, speed: local.aircraft.speed, altitude,
      stormDistance, status: local.status, kills: local.kills, target: this.targetId, sightX: this.sightScreen?.x ?? 50, sightY: this.sightScreen?.y ?? 50 });
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05); const elapsed = this.clock.elapsedTime;
    this.syncState(); this.updateCamera(elapsed);
    if (!this.reducedMotion) {
      for (const propeller of this.propellers) propeller.rotation.z += dt * 9;
      for (const gear of this.gears) gear.rotation.z += dt * 0.08;
      for (const marker of this.pickupMeshes.values()) marker.rotation.z += dt * 0.9;
    }
    this.eventFlash = Math.max(0, this.eventFlash - dt * 3);
    for (const [line, ttl] of this.shotLines) {
      if (ttl > dt) { this.shotLines.set(line, ttl - dt); continue; }
      this.overlay.remove(line); line.geometry.dispose(); (line.material as THREE.Material).dispose(); this.shotLines.delete(line);
    }
    this.composer.render(this.world, this.camera, [{ scene: this.overlay, camera: this.camera }]);
    this.updateHud(dt);
    this.fpsSamples.push(dt > 0 ? 1 / dt : 60);
    if (this.fpsSamples.length >= 120) {
      const average = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
      this.fpsSamples.length = 0;
      const next = average < 42 ? Math.max(0.65, this.pixelRatio - 0.1) : average > 57 ? Math.min(Math.min(window.devicePixelRatio, 1.5), this.pixelRatio + 0.05) : this.pixelRatio;
      if (next !== this.pixelRatio) { this.pixelRatio = next; this.renderer.setPixelRatio(next); this.resize(); }
    }
  };

  private resize = () => {
    const width = Math.max(1, this.container.clientWidth); const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
    this.composer.resize(width, height, this.pixelRatio);
  };
  private onVisibility = () => { if (document.hidden) this.clock.stop(); else this.clock.start(); };

  dispose() {
    cancelAnimationFrame(this.frame); window.removeEventListener("resize", this.resize); document.removeEventListener("visibilitychange", this.onVisibility);
    this.world.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) { object.geometry?.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material?.dispose()); } });
    this.overlay.traverse((object) => { if (object instanceof THREE.Line) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
    this.composer.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
