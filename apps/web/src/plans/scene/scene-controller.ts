/**
 * The 3D scene of a locked plan: owns the renderer, the camera (drag to turn, zoom in and out), picking, the
 * highlight of one group, the walk-in of the sitters and the render loop. Loaded on demand (a separate chunk, with
 * three.js), so the plan page pays for it only when a locked plan shows the scene.
 */
import * as THREE from 'three';
import { Kit, disposeTree, glassFactory } from './scene-kit';
import { type Entrance, beginEntrance, idle, makeEntrance, stepEntrance } from './scene-motion';
import { cameraRadius, clampZoom, layoutTables, outsideSpot, placeSitters, type SceneEntry, type SceneGroup, type OutsideGroup } from './scene-model';
import { readScenePalette, readStatusColours, type ScenePalette } from './scene-palette';
import { buildFurniture } from './scene-furniture';
import { BUBBLE_SIZE, LABEL_SIZE, type Person, PeopleFactory, SPRITE_ORDER } from './scene-people';
import { type Signage, bubbleTexture, loadSceneFonts, skyTexture } from './scene-textures';
import { type WorldLabels, buildWorld } from './scene-world';

export interface SceneConfig {
  roster: SceneEntry[];
  signage: Signage;
  labels: WorldLabels;
  /** "+5 người nữa", for the people beyond the biggest layout. */
  moreLabel: (n: number) => string;
  /** The sitters walk in one after another (the first time a locked plan is opened in this browser). */
  enter: boolean;
  reducedMotion: boolean;
  /** Pointer, wheel and keyboard control; false for a still render (the story image). */
  interactive: boolean;
}

const AZIMUTH_LIMIT = 0.75;
const ELEVATION_MIN = 0.14;
const ELEVATION_MAX = 0.7;
const DEFAULT_ELEVATION = 0.42;
const TAP_SLOP = 6;
const TARGET = new THREE.Vector3(0, 0.9, -1.7);

const sampleText = (config: SceneConfig): string => `${config.signage.placeName} ${config.signage.area ?? ''} ${config.roster.map((entry) => `${entry.name} ${entry.say ?? ''}`).join(' ')} ${config.labels.timeBoard} ${config.labels.placeBoard}`;

export class SceneController {
  onSelect: ((id: string | null) => void) | null = null;

  private readonly kit: Kit;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 80);
  private readonly crowd = new THREE.Group();
  private readonly people: PeopleFactory;
  private readonly makeGlass: () => THREE.Group;
  private furniture: THREE.Group | null = null;
  private persons: Person[] = [];
  private entrances: Entrance[] = [];
  private more: THREE.Sprite | null = null;
  private azimuth = 0;
  private elevation = DEFAULT_ELEVATION;
  private zoom = 1;
  private autoSway = 0;
  private touched = false;
  private highlight: SceneGroup | null = null;
  private selectedId: string | null = null;
  private visible = true;
  private raf = 0;
  private disposed = false;
  private startedAt = performance.now();
  private clockStarted = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinchDistance = 0;
  private engaged = false;
  private readonly cleanups: Array<() => void> = [];
  /** A still-render controller (the story image) draws on demand, with no frame loop. */
  private readonly loop: boolean;

  static async create(canvas: HTMLCanvasElement, config: SceneConfig): Promise<SceneController> {
    await loadSceneFonts(sampleText(config));
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    try {
      return new SceneController(renderer, canvas, config, readScenePalette());
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }

  private constructor(
    renderer: THREE.WebGLRenderer,
    private readonly canvas: HTMLCanvasElement,
    private config: SceneConfig,
    palette: ScenePalette,
  ) {
    this.renderer = renderer;
    this.loop = config.interactive;
    this.kit = new Kit(palette);
    this.makeGlass = glassFactory(this.kit);
    this.people = new PeopleFactory(this.kit, readStatusColours(), this.makeGlass);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = skyTexture(palette);
    this.scene.fog = new THREE.Fog(palette.fog, 20, 44);
    this.addLights(palette);
    this.scene.add(buildWorld(this.kit, config.signage, config.labels, this.makeGlass), this.crowd);
    this.populate();
    if (config.interactive) this.listen();
    this.resize();
    this.requestRender();
  }

  /* ---------- scene setup ---------- */

  private addLights(p: ScenePalette): void {
    // Legacy lights were authored 0..1; physical units want about pi times that.
    this.scene.add(new THREE.HemisphereLight(p.hemiSky, p.hemiGround, 0.78 * Math.PI));
    const sun = new THREE.DirectionalLight(p.sun, 0.7 * Math.PI);
    sun.position.set(3, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 8, bottom: -8, near: 1, far: 32 });
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    const fill = new THREE.PointLight(p.fill, 8, 12, 2);
    fill.position.set(0, 3.2, -3);
    this.scene.add(fill);
  }

  /** (Re)builds the tables and the people for the current roster. */
  private populate(): void {
    for (const person of this.persons) {
      this.crowd.remove(person.root);
      disposeTree(person.root);
    }
    if (this.furniture) {
      this.scene.remove(this.furniture);
      disposeTree(this.furniture);
    }
    if (this.more) {
      this.crowd.remove(this.more);
      this.more.material.map?.dispose();
      this.more.material.dispose();
      this.more = null;
    }
    this.persons = [];
    this.entrances = [];
    const sitters = this.config.roster.filter((entry) => entry.group === 'sit');
    const layout = layoutTables(sitters.length);
    this.furniture = buildFurniture(this.kit, layout, this.makeGlass);
    this.scene.add(this.furniture);
    const { seated, overflow } = placeSitters(sitters.length);
    const walkIn = this.config.enter && !this.config.reducedMotion;
    const used: Record<OutsideGroup, number> = { time: 0, place: 0, both: 0, none: 0, no: 0 };
    let seatIndex = 0;
    for (const entry of this.config.roster) {
      if (entry.group === 'sit') {
        if (seatIndex >= seated) continue;
        const seat = layout.seats[seatIndex];
        if (!seat) continue;
        const person = this.people.create(entry);
        person.root.position.set(seat.x, 0, seat.z);
        person.root.rotation.y = seat.back ? 0 : Math.PI;
        if (walkIn) {
          const entrance = makeEntrance(person, seat, seatIndex, seated);
          beginEntrance(entrance);
          this.entrances.push(entrance);
        }
        this.persons.push(person);
        this.crowd.add(person.root);
        seatIndex++;
        continue;
      }
      const spot = outsideSpot(entry.group, used[entry.group]++);
      const person = this.people.create(entry);
      person.root.position.set(spot.x, 0, spot.z);
      person.root.rotation.y = Math.atan2(spot.lookX - spot.x, spot.lookZ - spot.z);
      this.persons.push(person);
      this.crowd.add(person.root);
    }
    if (overflow > 0) this.addMore(overflow, layout.tables.length);
    this.applyHighlight();
  }

  private addMore(count: number, tables: number): void {
    const texture = bubbleTexture(this.kit.p, this.config.moreLabel(count), readStatusColours().sit);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    sprite.scale.set(BUBBLE_SIZE.width, BUBBLE_SIZE.height, 1);
    sprite.center.set(0.5, 0.02);
    sprite.renderOrder = 11;
    sprite.position.set(tables > 4 ? 5.2 : 3.4, LABEL_SIZE.height + 1.0, -3.5);
    this.crowd.add(sprite);
    this.more = sprite;
  }

  /* ---------- public control ---------- */

  setRoster(roster: SceneEntry[]): void {
    this.config = { ...this.config, roster, enter: false };
    this.selectedId = null;
    this.populate();
    this.requestRender();
  }

  setHighlight(group: SceneGroup | null): void {
    this.highlight = group;
    this.applyHighlight();
    this.requestRender();
  }

  zoomBy(step: number): void {
    this.zoom = clampZoom(this.zoom + step);
    this.touched = true;
    this.requestRender();
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    this.setSize(parent.clientWidth, parent.clientHeight);
  }

  setSize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 0.9 ? 54 : this.camera.aspect < 1.3 ? 46 : 40;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** One still frame at the default camera, whatever the user has done with it; for the story image. */
  renderStill(width: number, height: number): void {
    this.setSize(width, height);
    this.azimuth = 0;
    this.elevation = DEFAULT_ELEVATION;
    this.zoom = 1;
    this.autoSway = 0;
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.scene.background = null;
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* ---------- picking and highlight ---------- */

  private applyHighlight(): void {
    for (const person of this.persons) {
      person.lit = this.highlight !== null && person.entry.group === this.highlight;
      person.dim = this.highlight !== null && !person.lit;
    }
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const hit = raycaster.intersectObject(this.crowd, true).find((result) => result.object.visible);
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node && typeof node.userData['personId'] !== 'string') node = node.parent;
    return node ? (node.userData['personId'] as string) : null;
  }

  /* ---------- input ---------- */

  private listen(): void {
    const { canvas } = this;
    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      canvas.addEventListener(type, handler, options);
      this.cleanups.push(() => canvas.removeEventListener(type, handler));
    };
    on('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragMoved = 0;
      this.touched = true;
      this.engaged = true;
      if (this.pointers.size === 2) this.pinchDistance = this.pointerSpan();
    });
    on('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (this.pointers.size === 2) {
        const span = this.pointerSpan();
        if (this.pinchDistance > 0) this.zoom = clampZoom(this.zoom * (this.pinchDistance / span));
        this.pinchDistance = span;
      } else if (this.dragMoved > TAP_SLOP) {
        this.azimuth = Math.max(-AZIMUTH_LIMIT, Math.min(AZIMUTH_LIMIT, this.azimuth - dx * 0.006));
        this.elevation = Math.max(ELEVATION_MIN, Math.min(ELEVATION_MAX, this.elevation + dy * 0.004));
      }
      this.requestRender();
    });
    const release = (event: PointerEvent): void => {
      const wasTap = this.pointers.size === 1 && this.dragMoved <= TAP_SLOP && event.type === 'pointerup';
      this.pointers.delete(event.pointerId);
      this.pinchDistance = 0;
      if (!wasTap) return;
      this.selectedId = this.pick(event.clientX, event.clientY);
      this.onSelect?.(this.selectedId);
      this.requestRender();
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('pointerleave', () => {
      this.engaged = false;
    });
    // The wheel zooms once the scene has been pressed or focused; until then it scrolls the page past it.
    on('wheel', (event) => {
      if (!this.engaged) return;
      event.preventDefault();
      this.zoom = clampZoom(this.zoom * (event.deltaY > 0 ? 1.08 : 1 / 1.08));
      this.touched = true;
      this.requestRender();
    }, { passive: false });
    on('focus', () => {
      this.engaged = true;
    });
    on('blur', () => {
      this.engaged = false;
    });
    on('keydown', (event) => {
      const keys: Record<string, () => void> = {
        ArrowLeft: () => (this.azimuth = Math.max(-AZIMUTH_LIMIT, this.azimuth - 0.08)),
        ArrowRight: () => (this.azimuth = Math.min(AZIMUTH_LIMIT, this.azimuth + 0.08)),
        ArrowUp: () => (this.elevation = Math.min(ELEVATION_MAX, this.elevation + 0.05)),
        ArrowDown: () => (this.elevation = Math.max(ELEVATION_MIN, this.elevation - 0.05)),
        '+': () => this.zoomBy(-0.12),
        '=': () => this.zoomBy(-0.12),
        '-': () => this.zoomBy(0.12),
        _: () => this.zoomBy(0.12),
      };
      const act = keys[event.key];
      if (!act) return;
      act();
      this.touched = true;
      event.preventDefault();
      this.requestRender();
    });
    const resizer = new ResizeObserver(() => this.resize());
    resizer.observe(canvas.parentElement ?? canvas);
    this.cleanups.push(() => resizer.disconnect());
    const watcher = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
      if (this.visible) this.requestRender();
    });
    watcher.observe(canvas);
    this.cleanups.push(() => watcher.disconnect());
    const onVisibility = (): void => {
      if (!document.hidden) this.requestRender();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  private pointerSpan(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 1;
  }

  /* ---------- frame loop ---------- */

  private requestRender(): void {
    if (this.loop && this.raf === 0 && !this.disposed) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    if (document.hidden || !this.visible) return;
    // The clock starts with the first frame, so a slow first frame (shader compile) does not eat the walk-in.
    if (!this.clockStarted) {
      this.clockStarted = true;
      this.startedAt = performance.now();
    }
    const t = (performance.now() - this.startedAt) / 1000;
    this.update(t);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
    // Motion keeps the loop going; with reduced motion (and nobody walking in) frames come only from events.
    if (!this.config.reducedMotion || this.entrances.length > 0) this.raf = requestAnimationFrame(this.tick);
  };

  private update(t: number): void {
    const scale = this.config.reducedMotion ? 0 : 1;
    this.entrances = this.entrances.filter((entrance) => !stepEntrance(entrance, t - 0.4));
    const walking = new Set(this.entrances.map((entrance) => entrance.person));
    for (const person of this.persons) {
      if (!walking.has(person)) idle(person, t, scale);
      const selected = person.entry.id === this.selectedId;
      const emphasised = selected || person.lit;
      const pulse = emphasised ? 1 + Math.sin(t * 5) * 0.08 * scale : 1;
      const ringMaterial = person.ring.material as THREE.MeshBasicMaterial;
      ringMaterial.opacity = emphasised ? 0.95 : person.dim ? 0.15 : 0.55;
      person.ring.scale.setScalar(pulse * (emphasised ? 1.15 : 1));
      (person.fill.material as THREE.MeshBasicMaterial).opacity = emphasised ? 0.28 : 0.1;
      person.label.scale.set(selected ? LABEL_SIZE.width * 1.17 : LABEL_SIZE.width, selected ? LABEL_SIZE.height * 1.17 : LABEL_SIZE.height, 1);
      person.label.material.opacity = person.dim && !selected ? 0.35 : 1;
      person.label.renderOrder = selected ? SPRITE_ORDER.selectedLabel : SPRITE_ORDER.label;
      if (person.bubble) {
        person.bubble.material.opacity = person.dim && !selected ? 0.3 : 1;
        person.bubble.renderOrder = selected ? SPRITE_ORDER.selectedBubble : SPRITE_ORDER.bubble;
      }
    }
  }

  private placeCamera(): void {
    if (!this.touched) this.autoSway = this.config.reducedMotion ? 0 : Math.sin(((performance.now() - this.startedAt) / 1000) * 0.25) * 0.07;
    else this.autoSway *= 0.98;
    const radius = cameraRadius(this.camera.aspect) * this.zoom;
    const a = this.azimuth + this.autoSway;
    const e = this.elevation;
    this.camera.position.set(TARGET.x + radius * Math.sin(a) * Math.cos(e), TARGET.y + radius * Math.sin(e), TARGET.z + radius * Math.cos(a) * Math.cos(e));
    this.camera.lookAt(TARGET);
  }
}
