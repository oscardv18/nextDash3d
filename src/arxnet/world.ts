import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { bevelBox, buildPremiumKit, branchGeometry, servicePose, entranceRamp, ROAD_LEVEL } from './premium'
import { AVENUE_SPECIES, crownGeometry, meadowGeometry } from './foliage'
import { batchVegetation, type FoliageBatch } from './vegetation'
import { AssetLayer } from './assetLayer'
import type { AssetLibrary } from './assets'
import { DT, SCENE, clamp, hash, rng, type Dept, type Kind, type Preset, type Quality, type Theme } from './data'

/** Live UI state the world reads every frame. */
export interface WorldView {
  selected: string | null
  theme: Theme
  flows: boolean
  people: boolean
  autoRotate: boolean
  labels: boolean
}

export interface WorldCallbacks {
  getView: () => WorldView
  onSelect: (id: string) => void
  onDeselect: () => void
  /** Pointer went down on the canvas (used to dismiss popovers). */
  onCanvasPointer: () => void
}

type Std = THREE.MeshStandardMaterial
type Basic = THREE.MeshBasicMaterial
type Anim = (t: number, dt: number) => void
type InstItem = number[]

interface Mats {
  ground: Std; dots: Basic; shade: Basic; bld: Std; bld2: Std; plinth: Std; clad: Std; glass: Std; glassT: Std
  metal: Std; dark: Std; floor: Std; walk: Std; plate: Std; asphalt: Std; curb: Std; grass: Std; leafI: Std
  trunk: Std; water: Std; white: Std; box: Std; cont: Std; vc: Std; person: Std; accent: Std; mark2: Std
  rackU: Std; rackB: Std; mark: Std; soil: Std; wrap: Std; meadow: Std; vehicleGlass: Std; skin: Std; rubber: Std; vehicleMetal: Std; wood: Std; contact: Basic; beam: Basic; track: Basic; glowS: THREE.PointsMaterial; glowL: THREE.PointsMaterial
}

interface GlowItem { p: number[]; c: THREE.Color; blink: boolean; ph?: number; sp?: number }
interface Veg { trees: InstItem[]; cyp: InstItem[]; shrubs: InstItem[]; benches: InstItem[] }

interface District {
  id: string
  pos: THREE.Vector3
  group: THREE.Group
  angle: number
  capMat: Std
  edgeMat: Basic
  color: THREE.Color
  labelY: number
  pulse: { mesh: THREE.Mesh; mat: Basic; t: number }
  holo: THREE.Group
  holoMats: Basic[]
  hs: number
  port: THREE.Vector3
  veg: (THREE.InstancedMesh | null)[]
  brk: THREE.Group
  brkMat: Basic
  road: { from: THREE.Vector3; to: THREE.Vector3; dir: THREE.Vector3; rot: number }
}

interface Arc { curve: THREE.QuadraticBezierCurve3; mat: Basic; map: THREE.Texture; a: string; b: string; color: THREE.Color; base: number; sp: number }
interface Walker { rec: District | null; a: number; r: number; s: number; ph: number; accent: boolean; role: 'walk' | 'stand' | 'work'; uniform: boolean; style: number; outfitSlot: number; skinTone: number; width: number; height: number; pose: number }
interface Truck { rec: District; off: number; sp: number; side: number }
interface CamState { theta: number; phi: number; r: number; target: THREE.Vector3 }
interface PutOpts { ry?: number; rx?: number; rz?: number; s?: number[]; cast?: boolean; dyn?: boolean; h?: number; parent?: THREE.Object3D }
interface BldOpts { y?: number; mat?: Std; r?: number; frames?: boolean; ribbons?: number; base?: boolean; cap?: Std; parapet?: boolean; units?: number }

/** Real-world proportion: a person stands at roughly half the height of a truck cab. */
const PERSON_SCALE = 0.84
const TRUCK_SCALE = 1.3

const keep = <G extends THREE.BufferGeometry>(g: G) => {
  g.userData.keep = true
  return g
}

export class ArxWorld {
  private host: HTMLElement
  private labelsHost: HTMLElement
  private cb: WorldCallbacks
  private quality: Quality
  private density: number
  private preset!: Preset

  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  private hemi: THREE.HemisphereLight
  private dir: THREE.DirectionalLight
  private rim: THREE.DirectionalLight
  private environmentTarget: THREE.WebGLRenderTarget | null = null
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private gtao: GTAOPass | null = null
  private tex: Record<string, THREE.CanvasTexture>
  M: Mats
  G: Record<string, THREE.BufferGeometry> = {}
  private GC: Record<string, THREE.BufferGeometry> = {}
  P: Record<string, THREE.BufferGeometry> = {}
  private reduced: boolean
  private motionQuery: MediaQueryList | null = null

  world: THREE.Group | null = null
  private R = 14
  private PT = ROAD_LEVEL
  private r0 = 60
  private marks: THREE.Matrix4[] = []
  pickables: THREE.Object3D[] = []
  private anims: Anim[] = []
  d3: District[] = []
  private d3map: Record<string, District> = {}
  private capMats: Std[] = []
  private arcs: Arc[] = []
  private glowSets: { list: GlowItem[]; col: THREE.BufferAttribute }[] = []
  private roadMaps: THREE.Texture[] = []
  private coreEdge: Basic | null = null
  private ico: THREE.LineSegments | null = null
  private icoMat: THREE.LineBasicMaterial | null = null
  private coreTrees: THREE.InstancedMesh | null = null
  private coreLabelY = 9
  private packets!: THREE.InstancedMesh
  private pkGlow!: THREE.Points
  private pkPos!: Float32Array
  private pk: { arc: Arc; off: number; sp: number }[] = []
  ppl: Walker[] = []
  private peopleOutfits: THREE.InstancedMesh[] = []
  private peopleHands!: THREE.InstancedMesh
  peopleContact!: THREE.InstancedMesh
  foliageBatches: FoliageBatch[] = []
  private peopleSkin!: THREE.InstancedMesh
  private peopleArms!: THREE.InstancedMesh
  private peopleLegs!: THREE.InstancedMesh
  private peopleShins!: THREE.InstancedMesh
  private peopleForearms!: THREE.InstancedMesh
  private peopleHelmets!: THREE.InstancedMesh
  private truckGlass!: THREE.InstancedMesh
  private truckWheels!: THREE.InstancedMesh
  private truckHubs!: THREE.InstancedMesh
  trucks: Truck[] = []
  private cabMesh!: THREE.InstancedMesh
  private trailerMesh!: THREE.InstancedMesh
  truckShade!: THREE.InstancedMesh
  private landTrees: THREE.InstancedMesh[] = []
  /** Warehouse sets the asset layer upgrades with modelled equipment. */
  forklifts: { fk: THREE.Group; car: THREE.Group }[] = []
  racks: { group: THREE.Group; rows: number[]; xs: number[]; levels: number[]; base: number; legacy: THREE.InstancedMesh[] }[] = []
  private assets: AssetLayer | null = null
  private hedges: THREE.InstancedMesh | null = null
  private truckLivery!: THREE.InstancedMesh

  private cam: CamState
  private goal: CamState
  private flight: { a: CamState; b: CamState; t: number; dur: number; lift: number } | null = null
  private focusId: string | null = null
  private ray = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private tmpV = new THREE.Vector3()
  private dummy = new THREE.Object3D()
  private actorLocal = new THREE.Object3D()
  private actorMatrix = new THREE.Matrix4()
  private partMatrix = new THREE.Matrix4()
  private ptrs = new Map<number, { x: number; y: number }>()
  private drag: { moved: number; btn: number; shift: boolean } | null = null
  private pinch = 0
  private interact = 0
  private time = 0
  private last = 0
  private autoV = 0
  private hoverId: string | null = null
  private hoverAt = 0
  private raf = 0
  private ro: ResizeObserver
  private appliedTheme: Theme | null = null
  private autoLevel: number
  qLevel = 2
  private fpsN = 0
  private fpsT = 0
  private disposed = false
  private measuredFps: number | null = null

  constructor(host: HTMLElement, labelsHost: HTMLElement, cb: WorldCallbacks, opts: { quality: Quality; density: number }) {
    this.host = host
    this.labelsHost = labelsHost
    this.cb = cb
    this.quality = opts.quality
    this.density = opts.density
    this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
    this.reduced = !!this.motionQuery?.matches
    this.motionQuery?.addEventListener('change', this.onMotionPreference)
    this.autoLevel = window.innerWidth < 760 ? 1 : 2

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    this.renderer = renderer
    renderer.info.autoReset = false
    // PCF with a filter radius gives soft, stable contact shadows (PCFSoft was removed upstream).
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none'

    const scene = new THREE.Scene()
    this.scene = scene
    scene.background = new THREE.Color()
    scene.fog = new THREE.Fog(0x000000, 80, 190)
    this.camera = new THREE.PerspectiveCamera(21, 1, 1, 700)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1)
    scene.add(this.hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 2)
    dir.castShadow = true
    dir.shadow.bias = -0.0004
    dir.shadow.normalBias = 0.025
    dir.shadow.radius = 2.5
    scene.add(dir)
    scene.add(dir.target)
    this.dir = dir
    this.rim = new THREE.DirectionalLight(0xffffff, 0.5)
    this.rim.position.set(-30, 18, -26)
    scene.add(this.rim)
    try {
      const pm = new THREE.PMREMGenerator(renderer)
      const room = new RoomEnvironment()
      this.environmentTarget = pm.fromScene(room, 0.04)
      scene.environment = this.environmentTarget.texture
      room.dispose()
      pm.dispose()
    } catch {
      try { scene.environment = this.makeEnv() } catch { scene.environment = null }
    }
    try {
      if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('HDR unavailable; using direct rendering')
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Math.min(2, renderer.capabilities.maxSamples) })
      const comp = new EffectComposer(renderer, rt)
      comp.addPass(new RenderPass(scene, this.camera))
      try {
        const ao = new GTAOPass(scene, this.camera, 256, 256)
        ao.output = GTAOPass.OUTPUT.Default
        ao.blendIntensity = 0.60
        ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 12 })
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 })
        comp.addPass(ao)
        this.gtao = ao
      } catch (e) {
        console.warn('arx gtao init', e)
      }
      // High threshold: only emissive accents bloom, never white albedo.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.5, 0.93)
      comp.addPass(this.bloom)
      comp.addPass(new OutputPass())
      this.composer = comp
    } catch (e) {
      console.warn('arx composer', e)
      this.composer = null
    }

    this.tex = this.makeTextures()
    this.M = this.createMaterials(this.tex)
    const M = this.M
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.ground)
    gp.rotation.x = -Math.PI / 2
    gp.receiveShadow = true
    scene.add(gp)
    const dp = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.dots)
    dp.rotation.x = -Math.PI / 2
    dp.position.y = 0.012
    scene.add(dp)

    const G = this.G
    G.box = keep(new THREE.BoxGeometry(1, 1, 1))
    G.box.translate(0, 0.5, 0)
    G.sph = keep(new THREE.SphereGeometry(1, 24, 16))
    G.hemi = keep(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2))
    G.ao = keep(new THREE.PlaneGeometry(1, 1))
    G.ao.rotateX(-Math.PI / 2)
    G.trunk = this.cy(0.045, 0.065, 0.6, 8)
    G.packet = keep(new THREE.SphereGeometry(0.07, 12, 8))
    G.pulse = keep(new THREE.RingGeometry(3.7, 3.95, 6))
    G.pulse.rotateX(-Math.PI / 2)
    this.buildProps()

    this.cam = { theta: Math.PI / 4, phi: 0.95, r: 60, target: new THREE.Vector3() }
    this.goal = { theta: Math.PI / 4 - 0.5, phi: 0.95, r: 60, target: new THREE.Vector3() }

    const el = renderer.domElement
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onCancel)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', this.onContext)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    if (import.meta.env?.DEV) {
      const debug = window as typeof window & { arxnetDiagnostics?: () => ReturnType<ArxWorld['diagnostics']> }
      debug.arxnetDiagnostics = this.debugRead
      ;(window as typeof window & { arxnetWorld?: ArxWorld }).arxnetWorld = this
    }
  }

  /** Builds the scene for a preset and starts rendering. */
  start(preset: Preset, depts: Dept[], theme: Theme) {
    this.applyQuality()
    this.build(preset, depts, theme)
    this.cam.r = this.goal.r * 1.5
    this.cam.phi = 0.62
    this.cam.theta = this.goal.theta - 0.6
    this.resize()
    this.raf = requestAnimationFrame(this.tick)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    const debug = window as typeof window & { arxnetDiagnostics?: () => ReturnType<ArxWorld['diagnostics']> }
    if (debug.arxnetDiagnostics === this.debugRead) delete debug.arxnetDiagnostics
    const handle = window as typeof window & { arxnetWorld?: ArxWorld }
    if (handle.arxnetWorld === this) delete handle.arxnetWorld
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.motionQuery?.removeEventListener('change', this.onMotionPreference)
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onCancel)
    el.removeEventListener('pointerleave', this.onLeave)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('contextmenu', this.onContext)
    const geometries = new Set<THREE.BufferGeometry>([...Object.values(this.G), ...Object.values(this.GC), ...Object.values(this.P)])
    const materials = new Set<THREE.Material>(Object.values(this.M))
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose()
      if (mesh.material) ([] as THREE.Material[]).concat(mesh.material).forEach((m) => materials.add(m))
    })
    geometries.forEach((g) => g.dispose())
    materials.forEach((m) => {
      const map = (m as Basic).map
      if (map?.userData.own) map.dispose()
      m.dispose()
    })
    this.composer?.passes.forEach((pass) => pass.dispose())
    Object.values(this.tex).forEach((t) => t.dispose())
    this.environmentTarget?.dispose()
    this.dir.shadow.map?.dispose()
    this.composer?.dispose()
    this.renderer.dispose()
    el.remove()
  }

  /** Shared PBR materials. Also used by the CPU test harness, so keep it side-effect free. */
  createMaterials(tex: Record<string, THREE.CanvasTexture>): Mats {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o)
    return {
      ground: std({ roughness: 1, map: tex.radial }),
      dots: new THREE.MeshBasicMaterial({ map: tex.dots, transparent: true, depthWrite: false }),
      shade: new THREE.MeshBasicMaterial({ map: tex.soft, color: 0x000000, transparent: true, depthWrite: false }),
      bld: std({ roughness: 0.72, map: tex.panel, normalMap: tex.panelN, normalScale: new THREE.Vector2(0.22, 0.22) }),
      bld2: std({ roughness: 0.6 }),
      plinth: std({ roughness: 0.86, map: tex.concrete, normalMap: tex.concreteN, normalScale: new THREE.Vector2(0.18, 0.18) }),
      clad: std({ roughness: 0.45, metalness: 0.55, map: tex.clad, normalMap: tex.cladN, normalScale: new THREE.Vector2(0.8, 0.8) }),
      glass: std({ roughness: 0.18, metalness: 0.28, map: tex.win, normalMap: tex.winN, normalScale: new THREE.Vector2(.14, .14), emissiveMap: tex.winE, emissive: new THREE.Color('#ffd7a1') }),
      glassT: std({ roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      metal: std({ metalness: 0.85, roughness: 0.3 }),
      dark: std({ metalness: 0.35, roughness: 0.5 }),
      floor: std({ roughness: 0.9, map: tex.pave, normalMap: tex.paveN, normalScale: new THREE.Vector2(0.5, 0.5) }),
      walk: std({ roughness: 0.92, map: tex.pave2, normalMap: tex.pave2N, normalScale: new THREE.Vector2(0.4, 0.4) }),
      plate: std({ roughness: 0.7, metalness: 0.05, map: tex.concrete, normalMap: tex.concreteN, normalScale: new THREE.Vector2(0.18, 0.18) }),
      asphalt: std({ roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, map: tex.asphalt, normalMap: tex.asphaltN, normalScale: new THREE.Vector2(0.08, 0.08) }),
      curb: std({ roughness: 0.74, map: tex.concrete }),
      grass: std({ roughness: 1, map: tex.grass, normalMap: tex.grassN, normalScale: new THREE.Vector2(0.35, 0.35) }),
      // Fine leaf-cluster relief on top of the smooth canopy volume.
      leafI: std({ roughness: 0.9, vertexColors: true, normalMap: tex.leafN, normalScale: new THREE.Vector2(0.4, 0.4) }),
      soil: std({ roughness: 0.7, metalness: 0.35, vertexColors: true, color: '#3A322B' }),
      wrap: std({ roughness: 0.24, metalness: 0, vertexColors: true }),
      // Meadow patches fade into the ground instead of ending in a hard edge.
      meadow: std({ roughness: 1, map: tex.grass, alphaMap: tex.fade, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
      trunk: std({ roughness: 1 }),
      water: std({ roughness: 0.05, metalness: 0.5 }),
      white: std({ roughness: 0.45 }),
      box: std({ roughness: .94, vertexColors: true, normalMap: tex.asphaltN, normalScale: new THREE.Vector2(.025,.025) }),
      cont: std({ roughness: 0.62, metalness: 0.25, vertexColors: true, map: tex.cont, normalMap: tex.contN }),
      vc: std({ roughness: 0.50, metalness: 0.08, vertexColors: true }),
      person: std({ roughness: 0.86, vertexColors: true }),
      wood: std({ roughness: 0.84, vertexColors: true, map: tex.wood, normalMap: tex.woodN, normalScale: new THREE.Vector2(0.06, 0.06) }),
      contact: new THREE.MeshBasicMaterial({ color: '#11151A', map: tex.soft, transparent: true, opacity: 0.24, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      skin: std({ roughness: 0.82, vertexColors: true }),
      vehicleMetal: std({ roughness: .32, metalness: .72, vertexColors: true }),
      rubber: std({ roughness: 0.94, vertexColors: true }),
      vehicleGlass: std({ color: '#CBD9E3', roughness: 0.11, metalness: 0.16, vertexColors: true }),
      accent: std({ roughness: 0.35, metalness: 0.2 }),
      mark2: std({ roughness: 0.6 }),
      rackU: std({ color: '#34516C', roughness: 0.5, metalness: 0.55 }),
      rackB: std({ color: '#B8663A', roughness: 0.55, metalness: 0.35 }),
      mark: std({ color: '#E3B23C', roughness: 0.7 }),
      beam: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false }),
      track: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false }),
      glowS: new THREE.PointsMaterial({ size: 0.36, map: tex.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
      glowL: new THREE.PointsMaterial({ size: 0.95, map: tex.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    }
  }

  /** Installs the GLB asset library and upgrades the current world in place. */
  setAssets(lib: AssetLibrary) {
    if (this.disposed) return
    this.assets = new AssetLayer(lib, this)
    if (this.world) {
      this.assets.attach()
      if (this.appliedTheme) this.applyTheme(this.appliedTheme)
    }
  }

  legacyPeopleMeshes(): THREE.InstancedMesh[] {
    return [...this.peopleOutfits, this.peopleHands, this.peopleSkin, this.peopleArms, this.peopleForearms, this.peopleLegs, this.peopleShins, this.peopleHelmets]
  }

  legacyVehicleMeshes(): THREE.InstancedMesh[] {
    return [this.cabMesh, this.trailerMesh, this.truckLivery, this.truckGlass, this.truckWheels, this.truckHubs]
  }

  private debugRead = () => this.diagnostics()

  /** GPU counters are only populated by a browser that actually rendered frames. */
  diagnostics() {
    return {
      organization: this.preset?.id, quality: this.quality, level: this.qLevel,
      pixelRatio: this.renderer.getPixelRatio(), fpsSample: this.measuredFps,
      render: { ...this.renderer.info.render }, memory: { ...this.renderer.info.memory },
      people: this.ppl.length, vehicles: this.trucks.length, reducedMotion: this.reduced,
      assets: { loaded: !!this.assets, people: !!this.assets?.ownsPeople, vehicles: !!this.assets?.ownsVehicles },
    }
  }

  get builtFor() {
    return this.preset?.id
  }

  // ---------- assets ----------

  private makeEnv() {
    const s = new THREE.Scene()
    const geo = new THREE.SphereGeometry(50, 32, 16)
    const cols: number[] = []
    const p = geo.attributes.position
    const top = new THREE.Color('#ffffff'), hor = new THREE.Color('#8b939e'), bot = new THREE.Color('#2a2d33')
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 50
      const c = y > 0 ? hor.clone().lerp(top, y) : hor.clone().lerp(bot, -y)
      cols.push(c.r, c.g, c.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })))
    const pm = new THREE.PMREMGenerator(this.renderer)
    const rt = pm.fromScene(s, 0.035)
    this.environmentTarget = rt
    s.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      if (mesh.material) ([] as THREE.Material[]).concat(mesh.material).forEach((material) => material.dispose())
    })
    pm.dispose()
    return rt.texture
  }

  private makeTextures(): Record<string, THREE.CanvasTexture> {
    const random = rng(48271)
    type Ctx = CanvasRenderingContext2D
    const mk = (w: number, hh: number, fn: (x: Ctx, w: number, h: number) => void) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = hh
      fn(c.getContext('2d')!, w, hh)
      return c
    }
    const tx = (c: HTMLCanvasElement, srgb?: boolean, rep?: number) => {
      const t = new THREE.CanvasTexture(c)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 8
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      if (rep) t.repeat.set(rep, rep)
      return t
    }
    const nrm = (c: HTMLCanvasElement, s: number, rep?: number) => {
      const w = c.width, h = c.height
      const sd = c.getContext('2d')!.getImageData(0, 0, w, h).data
      const o = document.createElement('canvas')
      o.width = w
      o.height = h
      const ox = o.getContext('2d')!
      const od = ox.createImageData(w, h)
      const H = (x: number, y: number) => sd[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const dx = (H(x + 1, y) - H(x - 1, y)) * s, dy = (H(x, y + 1) - H(x, y - 1)) * s
          const nx = -dx, ny = dy, nz = 1
          const l = Math.hypot(nx, ny, nz)
          const i = (y * w + x) * 4
          od.data[i] = (nx / l * 0.5 + 0.5) * 255
          od.data[i + 1] = (ny / l * 0.5 + 0.5) * 255
          od.data[i + 2] = (nz / l * 0.5 + 0.5) * 255
          od.data[i + 3] = 255
        }
      ox.putImageData(od, 0, 0)
      return tx(o, false, rep)
    }
    const noise = (x: Ctx, w: number, h: number, a: number) => {
      for (let i = 0; i < (w * h) / 18; i++) {
        x.fillStyle = 'rgba(0,0,0,' + random() * a + ')'
        x.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2)
      }
    }
    const dots = tx(mk(64, 64, (x) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 2.2, 0, 7); x.fill() }))
    dots.repeat.set(200, 200)
    const radial = tx(mk(512, 512, (x, w) => {
      const g = x.createRadialGradient(256, 256, 10, 256, 256, 256)
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#f0f0f0'); g.addColorStop(1, '#c9c9c9')
      x.fillStyle = g; x.fillRect(0, 0, w, w)
    }), true)
    radial.wrapS = radial.wrapT = THREE.ClampToEdgeWrapping
    radial.repeat.set(2.5, 2.5)
    radial.offset.set(-0.75, -0.75)
    const soft = tx(mk(128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g; x.fillRect(0, 0, 128, 128)
    }))
    const glow = tx(mk(64, 64, (x) => {
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g; x.fillRect(0, 0, 64, 64)
    }))
    const panelC = mk(256, 256, (x) => {
      x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, 256, 256); noise(x, 256, 256, 0.05)
      x.fillStyle = '#b9b9b9'
      for (let j = 0; j < 4; j++) x.fillRect(0, j * 64, 256, 2)
      for (let i = 0; i < 2; i++) x.fillRect(i * 128, 0, 2, 256)
    })
    const winC = mk(256, 256, (x) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256)
      x.fillStyle = '#6f7984'; for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 4, 256)
      x.fillStyle = '#9aa3ad'; for (let j = 0; j < 6; j++) x.fillRect(0, j * 42.67, 256, 7)
    })
    const winH = mk(256, 256, (x) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256)
      x.fillStyle = '#fff'
      for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 4, 256)
      for (let j = 0; j < 6; j++) x.fillRect(0, j * 42.67, 256, 7)
    })
    const winE = tx(mk(256, 256, (x) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 6; j++) {
          if (random() < 0.36) {
            x.fillStyle = random() < 0.72 ? '#ffffff' : '#9fd0ff'
            x.globalAlpha = 0.4 + random() * 0.6
            x.fillRect(i * 32 + 6, j * 42.67 + 9, 24, 30)
          }
        }
      x.globalAlpha = 1
    }), true, 0.5)
    // Large-format stone slabs: per-slab tone shifts, fine aggregate and thin joints.
    const paveC = mk(256, 256, (x) => {
      x.fillStyle = '#f4f4f2'; x.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) {
        const v = random()
        x.fillStyle = v < 0.5 ? 'rgba(0,0,0,' + v * 0.09 + ')' : 'rgba(255,255,255,' + (v - 0.5) * 0.18 + ')'
        x.fillRect(i * 64 + (j % 2) * 32, j * 32, 64, 32)
      }
      noise(x, 256, 256, 0.05)
      x.fillStyle = 'rgba(0,0,0,.11)'
      for (let j = 0; j <= 8; j++) {
        x.fillRect(0, j * 32, 256, 1.5)
        for (let i = 0; i <= 4; i++) x.fillRect(i * 64 + (j % 2) * 32, j * 32, 1.5, 32)
      }
    })
    const pave2C = mk(256, 256, (x) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256); noise(x, 256, 256, 0.06)
      x.fillStyle = 'rgba(0,0,0,.2)'
      for (let j = 0; j < 16; j++) {
        x.fillRect(0, j * 16, 256, 1.5)
        const off = (j % 2) * 16
        for (let i = 0; i < 9; i++) x.fillRect(i * 32 + off, j * 16, 1.5, 16)
      }
    })
    const cladC = mk(128, 128, (x) => {
      const g = x.createLinearGradient(0, 0, 16, 0)
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#c9c9c9'); g.addColorStop(1, '#ffffff')
      x.fillStyle = g
      for (let i = 0; i < 8; i++) { x.save(); x.translate(i * 16, 0); x.fillRect(0, 0, 16, 128); x.restore() }
    })
    const contC = mk(128, 128, (x) => {
      x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128)
      x.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i < 16; i++) x.fillRect(i * 8, 0, 3, 128)
      x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(0, 0, 128, 4); x.fillRect(0, 124, 128, 4)
    })
    const carton = tx(mk(128, 128, (x) => {
      x.fillStyle = '#d2ab74'; x.fillRect(0, 0, 128, 128); noise(x, 128, 128, 0.08)
      x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 0, 128, 3); x.fillRect(0, 125, 128, 3); x.fillRect(0, 0, 3, 128); x.fillRect(125, 0, 3, 128)
      x.fillStyle = 'rgba(255,246,220,.55)'; x.fillRect(54, 0, 20, 128)
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(18, 22, 22, 3); x.fillRect(18, 28, 14, 3)
    }), true)
    const woodC = mk(128, 128, (x) => {
      x.fillStyle = '#f5f1e9'; x.fillRect(0, 0, 128, 128)
      for (let band = 0; band < 32; band++) {
        x.strokeStyle = 'rgba(85,70,45,' + (0.035 + random() * 0.06) + ')'
        x.lineWidth = 0.5 + random()
        x.beginPath()
        for (let y = 0; y <= 128; y += 8) {
          const px = band * 4 + Math.sin(y * 0.045 + band) * 1.5
          if (y) x.lineTo(px, y); else x.moveTo(px, y)
        }
        x.stroke()
      }
    })
    // Asphalt: worn patches plus light and dark aggregate.
    const asphaltC = mk(128, 128, (x) => {
      x.fillStyle = '#ececec'; x.fillRect(0, 0, 128, 128)
      for (let i = 0; i < 9; i++) {
        const g = x.createRadialGradient(random() * 128, random() * 128, 0, random() * 128, random() * 128, 20 + random() * 30)
        g.addColorStop(0, 'rgba(0,0,0,' + random() * 0.07 + ')'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g; x.fillRect(0, 0, 128, 128)
      }
      noise(x, 128, 128, 0.2)
      for (let i = 0; i < 260; i++) { x.fillStyle = 'rgba(255,255,255,' + random() * 0.22 + ')'; x.fillRect(random() * 128, random() * 128, 1, 1) }
    })
    // Fair-faced concrete: fine grain, faint board marks and soft weathering.
    const concreteC = mk(256, 256, (x) => {
      x.fillStyle = '#f1f1ef'; x.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 6; i++) {
        const g = x.createLinearGradient(0, random() * 256, 0, random() * 256)
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,' + random() * 0.05 + ')'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g; x.fillRect(0, 0, 256, 256)
      }
      noise(x, 256, 256, 0.045)
      x.fillStyle = 'rgba(0,0,0,.045)'
      for (let j = 0; j < 8; j++) x.fillRect(0, j * 32, 256, 1)
    })
    // Lawn: tonal patches and short blade strokes (multiplied by the theme grass colour).
    const grassC = mk(128, 128, (x) => {
      x.fillStyle = '#e6e6e6'; x.fillRect(0, 0, 128, 128)
      for (let i = 0; i < 14; i++) {
        const g = x.createRadialGradient(random() * 128, random() * 128, 0, random() * 128, random() * 128, 12 + random() * 26)
        const light = random() < 0.5
        g.addColorStop(0, light ? 'rgba(255,255,230,.18)' : 'rgba(0,30,0,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g; x.fillRect(0, 0, 128, 128)
      }
      for (let i = 0; i < 1600; i++) {
        const l = random() < 0.5
        x.fillStyle = l ? 'rgba(255,255,220,' + random() * 0.25 + ')' : 'rgba(0,20,0,' + random() * 0.2 + ')'
        x.fillRect(random() * 128, random() * 128, 1, 2 + random() * 2)
      }
    })
    // Leaf-cluster height field: overlapping soft discs at two scales.
    const leafC = mk(128, 128, (x) => {
      x.fillStyle = '#808080'; x.fillRect(0, 0, 128, 128)
      for (let i = 0; i < 420; i++) {
        const r = 2 + random() * 5, px = random() * 128, py = random() * 128, v = random() < 0.55
        const g = x.createRadialGradient(px, py, 0, px, py, r)
        g.addColorStop(0, v ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(128,128,128,0)')
        x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2)
      }
    })
    const dash = tx(mk(128, 8, (x) => {
      x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(0, 0, 128, 8)
      const g = x.createLinearGradient(0, 0, 48, 0)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g; x.fillRect(0, 0, 48, 8)
    }))
    const fade = tx(mk(128, 128, (x) => {
      const g = x.createRadialGradient(64, 64, 10, 64, 64, 64)
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#d0d0d0'); g.addColorStop(1, '#000000')
      x.fillStyle = g; x.fillRect(0, 0, 128, 128)
    }))
    fade.wrapS = fade.wrapT = THREE.ClampToEdgeWrapping
    const dashV = tx(mk(8, 64, (x) => { x.clearRect(0, 0, 8, 64); x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(0, 0, 8, 24) }))
    return {
      dots, radial, soft, glow, dash, dashV, carton, fade,
      wood: tx(woodC, true, 3), woodN: nrm(woodC, 0.6, 3),
      asphalt: tx(asphaltC, true, 1.8), asphaltN: nrm(asphaltC, 0.8, 1.8),
      concrete: tx(concreteC, true, 0.9), concreteN: nrm(concreteC, 1.2, 0.9),
      grass: tx(grassC, true, 1.6), grassN: nrm(grassC, 1.4, 1.6),
      leafN: (() => { const t = nrm(leafC, 3.2); t.repeat.set(8, 5); return t })(),
      panel: tx(panelC, true, 0.5), panelN: nrm(panelC, 2.5, 0.5), win: tx(winC, true, 0.5), winN: nrm(winH, 3, 0.5), winE,
      pave: tx(paveC, true, 0.6), paveN: nrm(paveC, 2, 0.6), pave2: tx(pave2C, true, 0.7), pave2N: nrm(pave2C, 1.6, 0.7),
      clad: tx(cladC, true, 1.4), cladN: nrm(cladC, 4, 1.4), cont: tx(contC, true), contN: nrm(contC, 3),
    }
  }

  // ---------- geometry helpers ----------

  private boxUV(g: THREE.BufferGeometry) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
      if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i), p.getZ(i))
      else if (ax >= az) uv.setXY(i, p.getZ(i), p.getY(i))
      else uv.setXY(i, p.getX(i), p.getY(i))
    }
    uv.needsUpdate = true
    return g
  }

  /** Rounded box, base at y=0. Cached. */
  private rb(w: number, h: number, d: number, r: number) {
    const k = 'rb' + [w, h, d, r].map((v) => (+v).toFixed(3)).join('_')
    if (this.GC[k]) return this.GC[k]
    r = Math.max(0.008, Math.min(r, w / 2 - 0.002, d / 2 - 0.002, h / 2 - 0.002))
    const g = r <= .008 || Math.min(w,h,d) <= .026
      ? new THREE.BoxGeometry(w,h,d).translate(0,h/2,0)
      : bevelBox(w,h,d,r)
    this.boxUV(g)
    return (this.GC[k] = keep(g))
  }

  /** Cylinder, base at y=0, with world-scaled UVs. Cached. */
  private cy(rt: number, rb: number, h: number, seg: number) {
    const k = 'cy' + [rt, rb, h, seg].map((v) => (+v).toFixed(3)).join('_')
    if (this.GC[k]) return this.GC[k]
    const g = new THREE.CylinderGeometry(rt, rb, h, seg)
    g.translate(0, h / 2, 0)
    const uv = g.attributes.uv
    const cf = Math.PI * 2 * Math.max(rt, rb)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cf, uv.getY(i) * h)
    return (this.GC[k] = keep(g))
  }

  private hexShape(R: number) {
    const s = new THREE.Shape()
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3
      if (k) s.lineTo(Math.cos(a) * R, Math.sin(a) * R)
      else s.moveTo(Math.cos(a) * R, Math.sin(a) * R)
    }
    s.closePath()
    return s
  }

  private hexPlate(R: number, d = 0.45, t = 0.1) {
    const k = 'hp' + [R, d, t].join('_')
    if (this.GC[k]) return this.GC[k]
    const g = new THREE.ExtrudeGeometry(this.hexShape(R), { depth: d, bevelEnabled: true, bevelThickness: t, bevelSize: t, bevelSegments: 3 })
    g.rotateX(-Math.PI / 2)
    g.translate(0, t, 0)
    return (this.GC[k] = keep(g))
  }

  private hexFlat(R: number, d = 0.02) {
    const k = 'hf' + R + '_' + d
    if (this.GC[k]) return this.GC[k]
    const g = new THREE.ExtrudeGeometry(this.hexShape(R), { depth: d, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return (this.GC[k] = keep(g))
  }

  private hexRing(ro: number, ri: number, d = 0.025) {
    const k = 'hr' + [ro, ri, d].join('_')
    if (this.GC[k]) return this.GC[k]
    const s = this.hexShape(ro)
    const hole = new THREE.Path()
    for (let i = 6; i > 0; i--) {
      const a = ((i % 6) * Math.PI) / 3
      if (i === 6) hole.moveTo(Math.cos(a) * ri, Math.sin(a) * ri)
      else hole.lineTo(Math.cos(a) * ri, Math.sin(a) * ri)
    }
    hole.closePath()
    s.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return (this.GC[k] = keep(g))
  }

  private arcWall(ro: number, ri: number, h: number, a0: number, a1: number) {
    const k = 'aw' + [ro, ri, h, a0, a1].join('_')
    if (this.GC[k]) return this.GC[k]
    const s = new THREE.Shape()
    s.moveTo(Math.cos(a0) * ro, Math.sin(a0) * ro)
    s.absarc(0, 0, ro, a0, a1, false)
    s.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri)
    s.absarc(0, 0, ri, a1, a0, true)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 48 })
    g.rotateX(-Math.PI / 2)
    return (this.GC[k] = keep(g))
  }

  private sawRoof() {
    if (this.GC.saw) return this.GC.saw
    const L = 2.6, w = L / 4, D = 1.3, b = 0.08, th = 0.34
    const s = new THREE.Shape()
    s.moveTo(-L / 2, 0)
    s.lineTo(L / 2, 0)
    for (let i = 0; i < 4; i++) {
      const xr = L / 2 - i * w
      s.lineTo(xr, b + th)
      s.lineTo(xr - w, b)
    }
    s.lineTo(-L / 2, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false })
    g.translate(0, 0, -D / 2)
    return (this.GC.saw = keep(g))
  }

  private mx(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))
  }

  /** Merges geometries into one non-indexed geometry. */
  private mergeNI(geos: THREE.BufferGeometry[], withColor: boolean) {
    const list = geos.map((g) => (g.index ? g.toNonIndexed() : g))
    let n = 0
    list.forEach((g) => (n += g.attributes.position.count))
    const out = new THREE.BufferGeometry()
    const names = ['position', 'normal', 'uv'].concat(withColor ? ['color'] : [])
    names.forEach((nm) => {
      const sz = nm === 'uv' ? 2 : 3
      const arr = new Float32Array(n * sz)
      let o = 0
      list.forEach((g) => {
        const a = g.attributes[nm] as THREE.BufferAttribute | undefined
        const c = g.attributes.position.count
        if (a) arr.set((a.array as Float32Array).subarray(0, c * sz), o * sz)
        else if (nm === 'color') arr.fill(1, o * sz, (o + c) * sz)
        o += c
      })
      out.setAttribute(nm, new THREE.BufferAttribute(arr, sz))
    })
    out.computeBoundingSphere()
    out.computeBoundingBox()
    return out
  }

  /** Vertex-colored merge of [geometry, color, matrix] parts. */
  private vc(parts: [THREE.BufferGeometry, string, THREE.Matrix4?][]) {
    const geos = parts.map(([geo, c, m]) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone()
      if (m) g.applyMatrix4(m)
      const col = new THREE.Color(c)
      const n = g.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = col.r
        arr[i * 3 + 1] = col.g
        arr[i * 3 + 2] = col.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      return g
    })
    const result = keep(this.mergeNI(geos, true))
    geos.forEach((g) => g.dispose())
    return result
  }

  private buildProps() {
    const G = this.G, P = this.P, mx = this.mx.bind(this)
    P.hvac = this.vc([[this.rb(0.36, 0.17, 0.26, 0.03), '#C9CDD2', mx()], [this.cy(0.085, 0.085, 0.012, 18), '#2A2F35', mx(-0.08, 0.17, 0)], [this.cy(0.085, 0.085, 0.012, 18), '#2A2F35', mx(0.09, 0.17, 0)], [G.box, '#8E959D', mx(0, 0.04, 0.131, 0.3, 0.08, 0.004)]])
    Object.assign(P, buildPremiumKit({ rb: this.rb.bind(this), cy: this.cy.bind(this) }))
    for (let variant = 0; variant < 6; variant++) {
      P[`tree${variant}`] = crownGeometry('tree', false, variant)
      P[`tree${variant}Low`] = crownGeometry('tree', true, variant)
    }
    P.tree = P.tree0
    P.cypress = crownGeometry('cypress')
    P.shrub = crownGeometry('shrub')
    P.treeLow = P.tree0Low
    P.cypressLow = crownGeometry('cypress', true)
    P.shrubLow = crownGeometry('shrub', true)
    G.trunk.dispose()
    G.trunk = branchGeometry()
    // Brand band on both trailer flanks, tinted per department at runtime.
    P.livery = this.vc([-1, 1].flatMap((side): [THREE.BufferGeometry, string, THREE.Matrix4][] => [
      [G.box, '#FFFFFF', mx(side * 0.2215, 0.335, -0.02, 0.003, 0.082, 0.92)],
      [G.box, '#FFFFFF', mx(side * 0.2215, 0.432, -0.02, 0.003, 0.01, 0.92)],
    ]))
    // Stretch-wrapped pallet load: glossy film over a slightly irregular block.
    P.wrapped = this.vc([[this.rb(0.97, 0.95, 0.97, 0.07), '#E9EEF1'], [this.rb(0.9, 0.04, 0.9, 0.02), '#D9E0E5', mx(0, 0.95, 0)]])
    // Flush square tree grate with a slim frame.
    P.treePit = this.vc([[this.rb(0.5, 0.012, 0.5, 0.008), '#FFFFFF'], ...[-1, 1].flatMap((d): [THREE.BufferGeometry, string, THREE.Matrix4][] => [[G.box, '#B9BEC2', mx(d * 0.245, 0, 0, 0.012, 0.016, 0.5)], [G.box, '#B9BEC2', mx(0, 0, d * 0.245, 0.5, 0.016, 0.012)]])])
    // Clipped hedge: a soft rounded block shaded darker at the base.
    P.hedge = this.vc([[this.rb(0.22, 0.2, 1, 0.07), '#C9D2C2'], [this.rb(0.2, 0.06, 0.98, 0.025), '#9AA597']])
    for (let i = 0; i < 3; i++) P['meadow' + i] = meadowGeometry(31 + i * 17)
  }

  private makeGlow(parent: THREE.Object3D, list: GlowItem[], mat: THREE.PointsMaterial) {
    if (!list.length) return
    const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3)
    list.forEach((it, i) => {
      pos.set(it.p, i * 3)
      col.set([it.c.r, it.c.g, it.c.b], i * 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const ca = new THREE.BufferAttribute(col, 3)
    g.setAttribute('color', ca)
    const pts = new THREE.Points(g, mat)
    parent.add(pts)
    if (list.some((i) => i.blink)) this.glowSets.push({ list, col: ca })
  }

  /** Merges static meshes in a group by material to cut draw calls. */
  private mergeStatic(group: THREE.Object3D, dept: string) {
    const buckets = new Map<string, { m: THREE.Material; list: { g: THREE.BufferGeometry; o: THREE.Mesh }[] }>()
    group.children.slice().forEach((obj) => {
      const o = obj as THREE.Mesh
      if (!o.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || o.userData.dyn || o.children.length) return
      const m = o.material
      if (Array.isArray(m)) return
      if (!buckets.has(m.uuid)) buckets.set(m.uuid, { m, list: [] })
      o.updateMatrix()
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      g.applyMatrix4(o.matrix)
      buckets.get(m.uuid)!.list.push({ g, o })
    })
    buckets.forEach(({ m, list }) => {
      if (list.length < 2) { list.forEach((x) => x.g.dispose()); return }
      const geo = this.mergeNI(list.map((x) => x.g), !!(m as Std).vertexColors)
      const cast = list.some((x) => x.o.castShadow)
      list.forEach((x) => {
        group.remove(x.o)
        x.g.dispose()
        if (!x.o.geometry.userData.keep) x.o.geometry.dispose()
      })
      const me = new THREE.Mesh(geo, m)
      me.castShadow = cast
      me.receiveShadow = true
      me.userData.dept = dept
      group.add(me)
    })
  }

  // ---------- quality / sizing ----------

  setQuality(q: Quality) {
    this.quality = q
    this.applyQuality()
  }

  private applyQuality() {
    const q = this.quality
    const lv = q === 'alta' ? 2 : q === 'equilibrada' ? 1 : q === 'baja' ? 0 : this.autoLevel
    this.qLevel = lv
    const pr = Math.min(window.devicePixelRatio || 1, [1, 1.3, 1.8][lv])
    this.renderer.setPixelRatio(pr)
    this.composer?.setPixelRatio(pr)
    const sh = lv > 0
    this.renderer.shadowMap.enabled = sh
    this.dir.castShadow = sh
    const ms = lv === 2 ? 2048 : 1024
    this.dir.shadow.mapSize.set(ms, ms)
    if (this.dir.shadow.map) {
      this.dir.shadow.map.dispose()
      this.dir.shadow.map = null
    }
    this.assets?.setQuality(lv)
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      const foliage = mesh.geometry?.userData.foliage as string | undefined
      if (foliage) {
        mesh.geometry = this.P[foliage + (lv < 2 ? 'Low' : '')]
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
          ;(mesh as THREE.InstancedMesh).boundingSphere = null
          ;(mesh as THREE.InstancedMesh).boundingBox = null
        }
      }
      const m = mesh.material
      if (m) ([] as THREE.Material[]).concat(m).forEach((x) => (x.needsUpdate = true))
    })
    this.resize()
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.preset) {
      const r0 = (this.R + 7) * (this.isMobile() ? 4.2 : 3.1)
      if (r0 !== this.r0) {
        this.r0 = r0
        if (this.focusId) this.flyTo(this.focusId)
        else this.flyHome()
      }
    }
  }

  private isMobile() {
    return window.innerWidth < 760
  }

  // ---------- world ----------

  rebuild(preset: Preset, depts: Dept[], theme: Theme) {
    this.build(preset, depts, theme)
  }

  private build(preset: Preset, depts: Dept[], theme: Theme) {
    const random = rng(hash(preset.id + 'world-v2'))
    const G = this.G, M = this.M, PR = this.P
    this.preset = preset
    if (this.world) {
      this.scene.remove(this.world)
      const keepM = new Set<THREE.Material>(Object.values(M))
      this.world.traverse((obj) => {
        const o = obj as THREE.Mesh
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
        if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose()
        if (o.material)
          ([] as THREE.Material[]).concat(o.material).forEach((m) => {
            if (keepM.has(m) || m.userData.keep) return
            const map = (m as Basic).map
            if (map && map.userData.own) map.dispose()
            m.dispose()
          })
      })
    }
    const W = new THREE.Group()
    this.world = W
    this.scene.add(W)
    this.hedges = null
    this.forklifts = []
    this.racks = []
    this.marks = []; this.pickables = []; this.anims = []; this.d3 = []; this.d3map = {}; this.capMats = []; this.arcs = []; this.glowSets = []; this.roadMaps = []
    const ds = depts, n = ds.length
    const R = n <= 5 ? 12.5 : n <= 7 ? 14 : 15.5 + (n - 8) * 1.0
    this.R = R
    const S = SCENE[theme]
    const PT = this.PT
    const shc = this.dir.shadow.camera
    const ext = R + 9
    shc.left = -ext; shc.right = ext; shc.top = ext; shc.bottom = -ext; shc.near = 1; shc.far = 160
    shc.updateProjectionMatrix()
    const fog = this.scene.fog as THREE.Fog
    fog.near = R * 3.4
    fog.far = R * 9.5

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = cast
      m.receiveShadow = true
      parent.add(m)
      return m
    }
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, items: InstItem[], colors?: THREE.Color[]) => {
      if (!items.length) return null
      const foliage = geo.userData.foliage as string | undefined
      const geometry = foliage && this.qLevel < 2 ? PR[foliage + 'Low'] : geo
      const im = new THREE.InstancedMesh(geometry, mat, items.length)
      const D = this.dummy
      items.forEach((it, i) => {
        D.position.set(it[0], it[1], it[2])
        D.rotation.set(0, it[4] || 0, 0)
        D.scale.setScalar(it[3] || 1)
        D.updateMatrix()
        im.setMatrixAt(i, D.matrix)
        if (colors) im.setColorAt(i, colors[i])
      })
      im.castShadow = true
      im.receiveShadow = true
      parent.add(im)
      return im
    }
    ;[R, R * 1.6].forEach((rr) => {
      const tr = new THREE.Mesh(new THREE.RingGeometry(rr - 0.035, rr + 0.035, 180), M.track)
      tr.rotation.x = -Math.PI / 2
      tr.position.y = 0.03
      W.add(tr)
    })
    const podium = (g: THREE.Object3D, Rr: number) => {
      add(new THREE.PlaneGeometry(Rr * 3.8, Rr * 3.8), M.shade, g, 0, 0.015, 0, false).rotation.x = -Math.PI / 2
      const a = add(this.hexPlate(Rr + 0.12, 0.14, 0.03), M.plinth, g)
      const b = add(this.hexPlate(Rr, 0.32, 0.06), M.plate, g, 0, 0.16, 0)
      const c = add(this.hexRing(Rr - 0.06, Rr - 0.55, 0.015), M.walk, g, 0, 0.6, 0, false)
      const d = add(this.hexFlat(Rr - 0.55, 0.03), M.floor, g, 0, 0.6, 0, false)
      return [a, b, c, d]
    }

    // One construction level for the hub, streets and department entrances.
    const ringSlab = (inner: number, outer: number, height: number) => {
      const shape = new THREE.Shape()
      shape.absarc(0, 0, outer, 0, Math.PI * 2, false)
      const hole = new THREE.Path()
      hole.absarc(0, 0, inner, 0, Math.PI * 2, true)
      shape.holes.push(hole)
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 64 })
      geometry.rotateX(-Math.PI / 2)
      return geometry
    }
    add(ringSlab(4.18, 6.13, 0.60), M.plinth, W, 0, 0, 0, false)
    add(ringSlab(4.24, 6.04, 0.03), M.asphalt, W, 0, 0.60, 0, false)
    add(ringSlab(6.04, 6.13, 0.07), M.curb, W, 0, 0.60, 0, false)
    add(ringSlab(6.13, 6.42, 0.65), M.walk, W, 0, 0, 0, false)
    const laneRing = new THREE.Mesh(new THREE.RingGeometry(5.11, 5.14, 128), M.mark2)
    laneRing.rotation.x = -Math.PI / 2
    laneRing.position.y = ROAD_LEVEL + 0.003
    W.add(laneRing)

    // core
    const core = new THREE.Group()
    core.userData.dept = 'core'
    W.add(core)
    podium(core, 4.5).forEach((m) => {
      m.userData.dept = 'core'
      this.pickables.push(m)
    })
    this.coreEdge = new THREE.MeshBasicMaterial({ color: S.accent })
    add(this.hexRing(4.5, 4.44, 0.02), this.coreEdge, core, 0, 0.6, 0, false)
    add(this.cy(2.5, 2.6, 0.1, 64), M.bld2, core, 0, PT, 0)
    add(this.cy(2.2, 2.2, 0.012, 64), M.walk, core, 0, PT + 0.1, 0, false)
    const tower = add(this.cy(0.85, 1.15, 4.6, 48), M.glass, core, 0, PT + 0.1, 0)
    tower.userData.dept = 'core'
    this.pickables.push(tower)
    add(this.cy(1.22, 1.22, 0.14, 48), M.plinth, core, 0, PT + 0.1, 0)
    ;[1.2, 2.4, 3.6].forEach((y) => {
      const r = 1.15 - 0.3 * (y / 4.6) + 0.022
      add(this.cy(r, r, 0.05, 48), M.accent, core, 0, PT + 0.1 + y, 0, false)
    })
    add(this.cy(1.25, 0.85, 0.35, 48), M.bld, core, 0, PT + 4.7, 0)
    add(this.cy(1.27, 1.27, 0.05, 48), M.accent, core, 0, PT + 5.05, 0, false)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      add(PR.hvac, M.vc, core, Math.cos(a) * 0.6, PT + 5.1, Math.sin(a) * 0.6).rotation.y = -a
    }
    ;[[2.0, 2.6, 0.3], [2.6, 3.5, -0.2], [3.2, 4.4, 0.13]].forEach(([rad, y, sp], i) => {
      const ring = add(new THREE.TorusGeometry(rad, 0.035, 8, 128), M.accent, core, 0, PT + y, 0, false)
      ring.rotation.x = Math.PI / 2
      ring.userData.dyn = true
      for (let j = 0; j < 3; j++) {
        const a = (j * Math.PI * 2) / 3
        add(G.sph, M.accent, ring, Math.cos(a) * rad, Math.sin(a) * rad, 0, false).scale.setScalar(0.09)
      }
      this.anims.push((t) => {
        ring.rotation.z = t * sp
        ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.4 + i) * 0.05
      })
    })
    const ico = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.5, 1)), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }))
    ico.position.y = PT + 6.7
    core.add(ico)
    this.icoMat = ico.material
    this.ico = ico
    const orb = add(G.sph, M.accent, core, 0, PT + 6.7, 0, false)
    orb.userData.dyn = true
    orb.scale.setScalar(0.42)
    this.anims.push((t) => {
      ico.rotation.y = t * 0.15
      ico.rotation.x = Math.sin(t * 0.2) * 0.3
      orb.scale.setScalar(0.42 + Math.sin(t * 1.4) * 0.03)
    })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 30, 8), M.beam)
    beam.position.y = PT + 8.4 + 15
    core.add(beam)
    const cTrees: InstItem[] = [], cBench: InstItem[] = [], cLamp: InstItem[] = []
    const cGlow: GlowItem[] = [{ p: [0, PT + 6.7, 0], c: new THREE.Color(S.accent), blink: false }]
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + Math.PI / 6
      cTrees.push([Math.cos(a) * 3.2, PT, Math.sin(a) * 3.2, 0.85])
      const b = a + 0.32
      cBench.push([Math.cos(b) * 3.0, PT, Math.sin(b) * 3.0, 1, -b + Math.PI / 2])
      const la = (k * Math.PI) / 3
      cLamp.push([Math.cos(la) * 3.9, 0.615, Math.sin(la) * 3.9, 1, -la])
      cGlow.push({ p: [Math.cos(la) * 3.9 + Math.cos(-la) * 0.07, 1.53, Math.sin(la) * 3.9 - Math.sin(-la) * 0.07], c: new THREE.Color('#ffe2b8'), blink: false })
    }
    this.coreTrees = inst(PR.tree, M.leafI, core, cTrees, cTrees.map(() => new THREE.Color(S.leaf)))
    inst(G.trunk, M.trunk, core, cTrees)
    inst(PR.treePit, M.soil, core, cTrees.map((t) => [t[0], PT + 0.001, t[2], 1.25, Math.atan2(t[2], t[0])]))
    inst(PR.bench, M.wood, core, cBench)
    inst(PR.lamp, M.vc, core, cLamp)
    this.makeGlow(core, cGlow, M.glowL)
    this.coreLabelY = PT + 8.8

    const hedges: THREE.Matrix4[] = []
    // departments
    ds.forEach((d, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.35
      const rr = n > 7 ? R * (i % 2 ? 1.1 : 0.92) : R
      const pos = new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)
      const g = new THREE.Group()
      g.position.copy(pos)
      W.add(g)
      const col = new THREE.Color(d.color)
      const capMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: S.capGlow, roughness: 0.4, metalness: 0.15 })
      this.capMats.push(capMat)
      const edgeMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75 })
      podium(g, 3.5).forEach((m) => {
        m.userData.dept = d.id
        this.pickables.push(m)
      })
      add(this.hexRing(3.5, 3.44, 0.022), edgeMat, g, 0, 0.6, 0, false)
      const inner = new THREE.Group()
      inner.rotation.y = -a + Math.PI / 2
      g.add(inner)
      const glows: GlowItem[] = []
      const veg: Veg = { trees: [], cyp: [], shrubs: [], benches: [] }
      const top = this.buildKind(d.kind, inner, rng(hash(preset.id + d.id + 'k')), capMat, col, glows, veg)
      this.mergeStatic(inner, d.id)
      const tone = () => new THREE.Color(S.leaf).lerp(new THREE.Color(S.leaf2), random())
      const vt = [inst(PR.tree, M.leafI, inner, veg.trees, veg.trees.map(tone)), inst(PR.cypress, M.leafI, inner, veg.cyp, veg.cyp.map(tone)), inst(PR.shrub, M.leafI, inner, veg.shrubs, veg.shrubs.map(tone))]
      inst(G.trunk, M.trunk, inner, veg.trees.concat(veg.cyp))
      inst(PR.treePit, M.soil, inner, veg.trees.concat(veg.cyp).map((t) => [t[0], t[1] + 0.001, t[2], Math.max(0.75, t[3] * 1.2)]))
      inst(PR.bench, M.wood, inner, veg.benches)
      inner.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.userData.dept = d.id
          this.pickables.push(o)
        }
      })
      this.makeGlow(inner, glows, M.glowS)
      const lamps: InstItem[] = [], lg: GlowItem[] = []
      for (let k = 0; k < 6; k += 2) {
        const la = (k * Math.PI) / 3
        lamps.push([Math.cos(la) * 3.2, 0.615, Math.sin(la) * 3.2, 1, -la + Math.PI])
        lg.push({ p: [Math.cos(la) * 3.13, 1.53, Math.sin(la) * 3.13], c: new THREE.Color('#ffe2b8'), blink: false })
      }
      inst(PR.lamp, M.vc, g, lamps)
      this.makeGlow(g, lg, M.glowS)
      const dirC = pos.clone().normalize().multiplyScalar(-1)
      const toC = dirC.clone().multiplyScalar(2.8)
      const ry = Math.atan2(dirC.x, dirC.z)
      add(this.cy(0.03, 0.045, 1.5, 10), M.metal, g, toC.x, 0.615, toC.z)
      add(this.rb(0.16, 0.08, 0.16, 0.03), M.dark, g, toC.x, 0.615, toC.z)
      add(G.sph, capMat, g, toC.x, 2.1, toC.z, false).scale.setScalar(0.085)
      add(this.cy(0.16, 0.16, 0.02, 24), capMat, g, toC.x, 1.98, toC.z, false)
      this.makeGlow(g, [{ p: [toC.x, 2.1, toC.z], c: col.clone(), blink: false }], M.glowL)
      // A flush, accessible entrance rather than stairs blocking the road.
      const entry = add(this.rb(2.35, 0.03, 1.3, 0.035), M.asphalt, g, dirC.x * 3.15, 0.60, dirC.z * 3.15, false)
      entry.rotation.y = ry
      const entryBase = add(this.rb(2.35, 0.60, 1.3, 0.035), M.plinth, g, dirC.x * 3.15, 0, dirC.z * 3.15, false)
      entryBase.rotation.y = ry
      const pulseMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false })
      const pr = new THREE.Mesh(G.pulse, pulseMat)
      pr.position.y = 0.05
      g.add(pr)
      const hb = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
      const hf = hb.clone()
      const holo = new THREE.Group()
      holo.position.y = top + 0.7
      holo.visible = false
      g.add(holo)
      d.procs.forEach((p, k) => {
        const pct = Math.max(0.05, parseInt(p.pct) / 100)
        const r0 = 0.8 + k * 0.3
        const b = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 0.08, 96), hb)
        b.rotation.x = -Math.PI / 2
        holo.add(b)
        const f = new THREE.Mesh(new THREE.RingGeometry(r0 - 0.01, r0 + 0.09, 96, 1, Math.PI / 2, Math.PI * 2 * pct), hf)
        f.rotation.x = -Math.PI / 2
        f.position.y = 0.01
        holo.add(f)
      })

      // Radial service streets overlap both the central boulevard and the entrance.
      const dist = pos.length()
      const r0 = 5.25, r1 = dist - 4.15
      const len = r1 - r0
      const mid = pos.clone().multiplyScalar((r0 + len / 2) / dist)
      const rot = Math.atan2(pos.x, pos.z)
      const road = new THREE.Group()
      road.position.set(mid.x, 0, mid.z)
      road.rotation.y = rot
      W.add(road)
      const half = len / 2
      add(this.rb(2.5, 0.60, len + 1.5, 0.025), M.plinth, road, 0, 0, 0, false)
      add(this.rb(1.85, 0.03, len + 1.5, 0.015), M.asphalt, road, 0, 0.60, 0, false)
      // Turning courts leave room for the complete vehicle, not just its center.
      for (const end of [-half, half]) {
        add(this.rb(2.7, 0.60, 2.7, 0.22), M.plinth, road, 0, 0, end, false)
        add(this.rb(2.7, 0.03, 2.7, 0.22), M.asphalt, road, 0, 0.60, end, false)
      }
      const vergeLen = Math.max(0.4, len - 2.9)
      for (const side of [-1, 1]) {
        add(this.rb(0.08, 0.09, Math.max(0.1, len - 2.7), 0.015), M.curb, road, side * 0.985, 0.60, 0, false)
        add(this.rb(0.27, 0.65, len + 1.5, 0.02), M.walk, road, side * 1.16, 0, 0, false)
        // Planted verge: street trees grow from a continuous lawn bed, not from pots.
        add(this.rb(1.14, ROAD_LEVEL - 0.02, vergeLen, 0.03), M.plinth, road, side * 1.865, 0, 0, false)
        add(this.rb(1.06, 0.02, vergeLen - 0.06, 0.02), M.grass, road, side * 1.86, ROAD_LEVEL - 0.02, 0, false)
        add(this.rb(0.05, 0.05, vergeLen, 0.012), M.curb, road, side * 2.41, ROAD_LEVEL - 0.03, 0, false)
      }
      road.updateMatrix()
      for (const side of [-1, 1]) {
        const m = road.matrix.clone().multiply(this.mx(side * 2.27, ROAD_LEVEL - 0.005, 0, 1, 0.95, Math.max(0.2, vergeLen - 0.5)))
        hedges.push(m)
      }
      const RM = road.matrix
      const mk = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => this.marks.push(RM.clone().multiply(this.mx(x, y, z, sx, sy, sz)))
      for (let z = -half + 1.4; z < half - 1.0; z += 0.8) mk(0, ROAD_LEVEL + 0.003, z, 0.035, 0.003, 0.32)
      for (const end of [-half - 0.95, half + 0.98]) {
        for (let stripe = 0; stripe < 7; stripe++) mk(-0.72 + stripe * 0.24, ROAD_LEVEL + 0.004, end, 0.13, 0.003, 0.32)
      }
      this.mergeStatic(road, d.id)

      // selection brackets
      const brk = new THREE.Group()
      const bm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false })
      for (let q = 0; q < 6; q++) {
        const ca = (q * Math.PI) / 3, cr = 4.05
        const cx = Math.cos(ca) * cr, cz = Math.sin(ca) * cr
        ;[-1, 1].forEach((sd) => {
          const ea = ca + sd * (Math.PI / 2 + Math.PI / 6)
          const s = new THREE.Mesh(G.box, bm)
          s.scale.set(0.06, 0.012, 0.62)
          s.position.set(cx + Math.cos(ea) * 0.31, 0.02, cz + Math.sin(ea) * 0.31)
          s.rotation.y = -ea + Math.PI / 2
          brk.add(s)
        })
      }
      g.add(brk)
      brk.visible = false

      const rec: District = {
        id: d.id, pos, group: g, angle: a, capMat, edgeMat, color: col, labelY: top + 1.0,
        pulse: { mesh: pr, mat: pulseMat, t: 9 }, holo, holoMats: [hb, hf], hs: 0,
        port: pos.clone().add(toC).setY(2.1), veg: vt, brk, brkMat: bm,
        road: { from: pos.clone().multiplyScalar(r0 / dist), to: pos.clone().multiplyScalar(r1 / dist), dir: pos.clone().normalize(), rot },
      }
      this.d3.push(rec)
      this.d3map[d.id] = rec
    })

    // data-flow arcs
    const mkArc = (p0: THREE.Vector3, p2: THREE.Vector3, color: string, a: string, b: string) => {
      const dd = p0.distanceTo(p2)
      const p1 = p0.clone().add(p2).multiplyScalar(0.5)
      p1.y = Math.max(p0.y, p2.y) + 1.4 + dd * 0.2
      const curve = new THREE.QuadraticBezierCurve3(p0.clone(), p1, p2.clone())
      const map = this.tex.dash.clone()
      map.needsUpdate = true
      map.userData.own = true
      map.repeat.set(Math.max(2, curve.getLength() / 1.4), 1)
      const mat = new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity: S.arcOp, depthWrite: false })
      W.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.028, 6, false), mat))
      this.arcs.push({ curve, mat, map, a, b, color: new THREE.Color(color), base: S.arcOp, sp: 0.35 + random() * 0.2 })
    }
    preset.links.forEach(([a, b]) => {
      const A = this.d3map[a], B = this.d3map[b]
      if (A && B) mkArc(A.port, B.port, DT[a].color, a, b)
    })
    this.d3.forEach((r) => mkArc(r.port, r.pos.clone().setY(0).normalize().multiplyScalar(1.3).setY(PT + 4.0), '#' + r.color.getHexString(), r.id, 'core'))
    const per = 2, cnt = this.arcs.length * per
    const pkm = new THREE.InstancedMesh(G.packet, new THREE.MeshBasicMaterial({ color: 0xffffff }), cnt)
    pkm.frustumCulled = false
    W.add(pkm)
    this.packets = pkm
    this.pkPos = new Float32Array(cnt * 3)
    const pcol = new Float32Array(cnt * 3)
    this.pk = []
    this.arcs.forEach((a, ai) => {
      for (let k = 0; k < per; k++) {
        const i = ai * per + k
        this.pk.push({ arc: a, off: k / per + random() * 0.2, sp: 0.07 + random() * 0.04 })
        pkm.setColorAt(i, a.color)
        pcol.set([a.color.r, a.color.g, a.color.b], i * 3)
      }
    })
    if (pkm.instanceColor) pkm.instanceColor.needsUpdate = true
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(this.pkPos, 3))
    pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3))
    this.pkGlow = new THREE.Points(pg, M.glowL)
    this.pkGlow.frustumCulled = false
    W.add(this.pkGlow)

    // Shared articulated people: body, skin, arms, legs and optional safety helmet.
    const dens = clamp(this.density, 0, 2)
    const ppl: Walker[] = []
    this.d3.forEach((rec, i) => {
      const count = Math.round((3 + Math.min(3, ds[i].head / 18)) * dens)
      const uniform = ds[i].id !== 'leg' && ['hall', 'crates', 'docks', 'lab', 'grid'].includes(ds[i].kind)
      for (let k = 0; k < count; k++) ppl.push({
        rec, a: k % 7 === 1 ? rec.angle + Math.PI / 2 : random() * Math.PI * 2, r: k % 7 < 2 ? 2.47 : 2.71 + random() * 0.06,
        s: (0.16 + random() * 0.12) * (k % 2 ? -1 : 1), ph: random() * Math.PI * 2,
        style: uniform ? [2,3,5][k % 3] : [0,1,4][k % 3], outfitSlot: 0, skinTone: k % 4, width: 0.94 + (k % 4) * .035, height: 0.97 + (k % 3) * .025, pose: k % 3,
        accent: uniform, uniform, role: k % 7 === 0 ? 'stand' : k % 7 === 1 ? 'work' : 'walk',
      })
    })
    for (let k = 0; k < Math.round(8 * dens); k++) ppl.push({ rec: null, a: random() * Math.PI * 2, r: 3.65, s: 0.14, ph: random() * 6, accent: false, uniform: false, style: [0,1,4][k % 3], outfitSlot: 0, skinTone: k % 4, width: 0.96 + k % 3 * .035, height: 0.97 + k % 3 * .025, pose: k % 3, role: k % 4 ? 'walk' : 'stand' })
    this.ppl = ppl
    const peopleBatch = (geometry: THREE.BufferGeometry, count: number, material: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      W.add(mesh)
      return mesh
    }
    const outfitCounts = [0, 0, 0, 0, 0, 0]
    ppl.forEach((person) => { person.outfitSlot = outfitCounts[person.style]++ })
    this.peopleOutfits = [PR.personBody, PR.personBlazer, PR.personVest, PR.personCoat, PR.personCardigan, PR.personCoveralls].map((geometry, style) => peopleBatch(geometry, outfitCounts[style], M.person))
    this.peopleHands = peopleBatch(PR.hand, ppl.length * 2, M.skin)
    this.peopleContact = peopleBatch(G.ao, ppl.length, M.contact)
    this.peopleContact.castShadow = false
    this.peopleContact.receiveShadow = false
    this.peopleSkin = peopleBatch(PR.personSkin, ppl.length, M.skin)
    this.peopleArms = peopleBatch(PR.arm, ppl.length * 2, M.person)
    this.peopleLegs = peopleBatch(PR.leg, ppl.length * 2, M.person)
    this.peopleShins = peopleBatch(PR.shin, ppl.length * 2, M.person)
    this.peopleForearms = peopleBatch(PR.forearm, ppl.length * 2, M.person)
    this.peopleHelmets = peopleBatch(PR.helmet, ppl.length, M.vc)
    const consoles = ppl.filter((person) => person.role === 'work' && person.rec).map((person) => [
      person.rec!.pos.x + Math.cos(person.a) * 2.23, ROAD_LEVEL,
      person.rec!.pos.z + Math.sin(person.a) * 2.23, 1, Math.PI / 2 - person.a,
    ])
    inst(PR.console, M.vc, W, consoles)

    // Delivery vehicles follow closed lanes at constant speed, including both turns.
    this.trucks = []
    this.d3.forEach((rec) => {
      const total = servicePose(0, rec.road.from.distanceTo(rec.road.to)).total
      const speed = 0.52 + random() * 0.12
      for (let k = 0; k < 2; k++) this.trucks.push({ rec, off: k * total / 2, sp: speed, side: k ? 1 : -1 })
    })
    this.cabMesh = peopleBatch(PR.cab, this.trucks.length, M.vc)
    this.trailerMesh = peopleBatch(PR.trailer, this.trucks.length, M.vc)
    this.truckGlass = peopleBatch(PR.cabGlass, this.trucks.length, M.vehicleGlass)
    this.truckWheels = peopleBatch(PR.wheelTyre, this.trucks.length * 6, M.rubber)
    this.truckHubs = peopleBatch(PR.wheelHub, this.trucks.length * 6, M.vehicleMetal)
    this.truckLivery = peopleBatch(PR.livery, this.trucks.length, M.vc)
    this.truckLivery.castShadow = false
    // Fleet: brushed-aluminium bodies with a department livery band; white or graphite cabs.
    const fleet = [new THREE.Color('#FFFFFF'), new THREE.Color('#FFFFFF'), new THREE.Color('#6B7480')]
    this.trucks.forEach((v, i) => {
      this.trailerMesh.setColorAt(i, new THREE.Color('#F4F6F7').lerp(v.rec.color, 0.04))
      this.truckLivery.setColorAt(i, v.rec.color.clone().lerp(new THREE.Color('#3B4249'), 0.18))
      this.cabMesh.setColorAt(i, fleet[i % fleet.length])
    })
    ;[this.trailerMesh, this.truckLivery, this.cabMesh].forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true })
    if (this.marks.length) {
      const im = new THREE.InstancedMesh(G.box, M.mark2, this.marks.length)
      this.marks.forEach((m, i) => im.setMatrixAt(i, m))
      im.receiveShadow = true
      W.add(im)
    }
    this.truckShade = new THREE.InstancedMesh(G.ao, M.shade, this.trucks.length)
    this.truckShade.frustumCulled = false
    W.add(this.truckShade)

    const bollards: InstItem[] = [], signs: InstItem[] = []
    this.d3.forEach((district) => {
      const road = district.road
      const midpoint = road.from.clone().lerp(road.to, .55)
      const lateral = new THREE.Vector3(Math.cos(road.rot), 0, -Math.sin(road.rot))
      for (const side of [-1, 1]) {
        const position = midpoint.clone().addScaledVector(lateral, side * 1.16)
        bollards.push([position.x, 0.65, position.z, 1, road.rot])
      }
      const point = road.from.clone().lerp(road.to, .28).addScaledVector(lateral, 1.16)
      signs.push([point.x, .65, point.z, .82, road.rot])
    })
    inst(PR.bollard, M.vc, W, bollards)
    inst(PR.wayfinding, M.vc, W, signs)

    // landscape
    const tr = rng(hash(preset.id + 'trees'))
    const trees: InstItem[] = [], cyp: InstItem[] = [], shr: InstItem[] = []
    let guard = 0
    const segD = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
      const ab = b.clone().sub(a), ap = p.clone().sub(a)
      const t = clamp(ap.dot(ab) / ab.lengthSq(), 0, 1)
      return a.clone().addScaledVector(ab, t).distanceTo(p)
    }
    const O = new THREE.Vector3()
    const avenueSpecies: number[] = []
    this.d3.forEach((r, ri) => {
      const L0 = r.road
      const pp = new THREE.Vector3(Math.cos(L0.rot), 0, -Math.sin(L0.rot))
      // Fewer, fuller street trees: modelled crowns need room to read.
      const n0 = Math.max(2, Math.floor(L0.from.distanceTo(L0.to) / 2.0))
      for (let k = 1; k < n0; k++) {
        const b = L0.from.clone().lerp(L0.to, k / n0)
        ;[-1, 1].forEach((sd) => {
          const q = b.clone().addScaledVector(pp, sd * 1.86)
          trees.push([q.x, ROAD_LEVEL - 0.01, q.z, 0.72 + tr() * 0.06, tr() * 6])
          avenueSpecies.push(AVENUE_SPECIES[ri % AVENUE_SPECIES.length])
        })
      }
    })
    const nAv = trees.length
    // Landscape groves: 1–3 specimens clustered on an irregular meadow patch.
    const meadows: InstItem[][] = [[], [], []]
    const fits = (p: THREE.Vector3, rad: number) =>
      !this.d3.some((r) => r.pos.distanceTo(p) < 4.6) && !this.d3.some((r) => segD(p, O, r.pos) < 2.7) &&
      ![...trees, ...cyp].some((q) => Math.hypot(q[0] - p.x, q[2] - p.z) < 0.95) &&
      Math.abs(rad - R) >= 0.5 && Math.abs(rad - R * 1.6) >= 0.5
    while (trees.length + cyp.length < nAv + 22 && guard++ < 5000) {
      const ang = tr() * 6.28, rad = R + 4.8 + tr() * 15
      const p = new THREE.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad)
      if (!fits(p, rad)) continue
      const conifer = tr() < 0.25
      ;(conifer ? cyp : trees).push([p.x, 0, p.z, 0.8 + tr() * 0.6, tr() * 6])
      const mates = Math.floor(tr() * 3)
      for (let m = 0; m < mates; m++) {
        const a2 = tr() * 6.28, q = p.clone().add(new THREE.Vector3(Math.cos(a2), 0, Math.sin(a2)).multiplyScalar(0.95 + tr() * 0.4))
        if (fits(q, q.length())) (conifer ? cyp : trees).push([q.x, 0, q.z, 0.7 + tr() * 0.5, tr() * 6])
      }
      if (tr() < 0.7) meadows[Math.floor(tr() * 3)].push([p.x, 0.006, p.z, 1.3 + mates * 0.45 + tr() * 0.5, tr() * 6])
    }
    meadows.forEach((list, k) => {
      const im = inst(PR['meadow' + k], M.meadow, W, list)
      if (im) im.castShadow = false
    })
    this.d3.forEach((r) => {
      const L0 = r.road
      // Understorey shrubs stay inside the verge bed.
      const length = L0.from.distanceTo(L0.to)
      const span = Math.max(0, ((length - 2.9) / 2 - 0.35) / length)
      const pp = new THREE.Vector3(Math.cos(L0.rot), 0, -Math.sin(L0.rot))
      for (let k = 0; k < 6; k++) {
        const b = L0.from.clone().lerp(L0.to, 0.5 + (k / 5 - 0.5) * 2 * span)
        b.addScaledVector(pp, (k % 2 ? 1 : -1) * 1.58)
        shr.push([b.x, ROAD_LEVEL, b.z, 0.62 + tr() * 0.14, tr() * 6])
      }
    })
    if (hedges.length) {
      const hedge = new THREE.InstancedMesh(PR.hedge, M.leafI, hedges.length)
      hedges.forEach((m, i) => hedge.setMatrixAt(i, m))
      hedge.castShadow = true
      hedge.receiveShadow = true
      hedge.userData.hedge = true
      W.add(hedge)
      this.hedges = hedge
    }
    this.landTrees = []
    const mkLand = (geo: THREE.BufferGeometry, list: InstItem[]) => {
      const im = inst(geo, M.leafI, W, list, list.map(() => new THREE.Color('#ffffff')))
      if (im) {
        im.userData.tones = list.map(() => random())
        this.landTrees.push(im)
      }
      return im
    }
    const avenue = mkLand(PR.tree, trees.slice(0, nAv))
    if (avenue) avenue.userData.species = avenueSpecies
    mkLand(PR.tree, trees.slice(nAv))
    mkLand(PR.cypress, cyp)
    mkLand(PR.shrub, shr)
    inst(G.trunk, M.trunk, W, trees.concat(cyp))

    this.r0 = (R + 7) * (this.isMobile() ? 4.2 : 3.1)
    this.goal.r = this.r0
    this.goal.target.set(0, 0, 0)
    this.goal.phi = 0.95
    this.focusId = null
    this.flight = null
    this.foliageBatches = batchVegetation(W, PR, M.leafI)
    this.coreTrees = null; this.landTrees = []
    this.d3.forEach((district) => { district.veg = [] })
    if (this.qLevel < 2) this.foliageBatches.forEach(({ mesh }) => { mesh.geometry = PR[mesh.geometry.userData.foliage + 'Low'] })
    this.mergeStatic(core, 'core')
    this.pickables = []
    W.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && (object.userData.dept || object.userData.instanceDepts?.some(Boolean))) this.pickables.push(object)
    })
    this.assets?.attach()
    this.applyTheme(theme)
  }

  private buildKind(kind: Kind, g: THREE.Group, r: () => number, cap: Std, col: THREE.Color, glows: GlowItem[], veg: Veg) {
    const G = this.G, M = this.M, PR = this.P, PT = this.PT
    let top = PT + 2
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, o: PutOpts = {}) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, PT + y, z)
      if (o.ry) m.rotation.y = o.ry
      if (o.rx) m.rotation.x = o.rx
      if (o.rz) m.rotation.z = o.rz
      if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2])
      m.castShadow = o.cast !== false
      m.receiveShadow = true
      if (o.dyn) m.userData.dyn = true
      ;(o.parent || g).add(m)
      if (o.h !== undefined) top = Math.max(top, PT + y + o.h)
      return m
    }
    const B = (w: number, h: number, dd: number, x: number, z: number, y = 0, mat: THREE.Material = M.bld, rad = 0.04, o: PutOpts = {}) => put(this.rb(w, h, dd, rad), mat, x, y, z, { ...o, h })
    const C = (rad: number, h: number, x: number, z: number, y = 0, mat: THREE.Material = M.bld, seg = 32, rt?: number, o: PutOpts = {}) => put(this.cy(rt === undefined ? rad : rt, rad, h, seg), mat, x, y, z, { ...o, h })
    const I = (geo: THREE.BufferGeometry, mat: THREE.Material, items: number[][], colors?: THREE.Color[]) => {
      const im = new THREE.InstancedMesh(geo, mat, items.length)
      const D = this.dummy
      items.forEach((it, i) => {
        D.position.set(it[0], PT + it[1], it[2])
        D.rotation.set(it[6] || 0, it[7] || 0, it[8] || 0)
        D.scale.set(it[3], it[4], it[5])
        D.updateMatrix()
        im.setMatrixAt(i, D.matrix)
        if (colors) im.setColorAt(i, colors[i])
      })
      im.castShadow = true
      im.receiveShadow = true
      g.add(im)
      return im
    }
    const L = (x: number, y: number, z: number, c: string, blink?: boolean, sp?: number) => glows.push({ p: [x, PT + y, z], c: new THREE.Color(c), blink: !!blink, ph: r() * 6, sp: sp || 1 + r() * 3 })
    const A = (f: Anim) => this.anims.push(f)
    const ao = (w: number, dd: number, x: number, z: number, s = 1) => put(G.ao, M.shade, x, 0.006, z, { s: [w + 0.7 * s, 1, dd + 0.7 * s], cast: false })
    const tree = (x: number, z: number, s = 1) => veg.trees.push([x, PT, z, s, r() * 6])
    const cyp = (x: number, z: number, s = 1) => veg.cyp.push([x, PT, z, s, r() * 6])
    const shrub = (x: number, z: number, s = 1) => veg.shrubs.push([x, PT, z, s, r() * 6])
    const bench = (x: number, z: number, ry = 0) => veg.benches.push([x, PT, z, 1, ry])
    const unit = (x: number, y: number, z: number, ry = 0) => put(PR.hvac, M.vc, x, y, z, { ry, h: 0.2 })
    const P2 = (geo: THREE.BufferGeometry, mat: THREE.Material, par: THREE.Object3D, x: number, y: number, z: number, s?: number[]) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      if (s) m.scale.set(s[0], s[1], s[2])
      m.castShadow = true
      m.receiveShadow = true
      par.add(m)
      return m
    }
    const bld = (w: number, h: number, dd: number, x: number, z: number, o: BldOpts = {}) => {
      const y = o.y || 0, mat = o.mat || M.bld, rad = o.r === undefined ? 0.05 : o.r
      if (y < 0.05) {
        B(w + 0.07, 0.12, dd + 0.07, x, z, y, M.plinth, Math.min(rad + 0.03, 0.1))
        ao(w, dd, x, z)
      }
      const glazed = mat === M.glass || mat === M.glassT
      // Curtain walls stand off a recessed core. Separate panes, floor slabs and
      // opaque spandrels replace the single glazed prism on office buildings.
      const body = B(glazed ? w*.91 : w, h, glazed ? dd*.91 : dd, x, z, y, glazed ? M.dark : mat, Math.min(rad,.035))
      if (w > .5 && dd > .35 && h > .45) {
        const floors = Math.max(1,Math.floor(h/.62)), step=h/floors
        const bays=Math.max(2,Math.round(w/.43)), bw=w/bays
        for(let floor=0;floor<floors;floor++) {
          const yy=y+floor*step
          for(const face of [-1,1]) {
            if(glazed) {
              B(w+.018,.052,dd+.018,x,z,yy,M.bld2,.012)
              B(w,.11,.032,x,z+face*(dd/2),yy+.052,M.clad,.006)
            }
            for(let bay=0;bay<bays;bay++) {
              const xx=x-w/2+(bay+.5)*bw
              const paneH=glazed?step-.19:Math.min(.30,step*.48)
              const paneY=glazed?yy+.17:yy+.18
              B(bw-.042,paneH,.022,xx,z+face*(dd/2+.013),paneY,M.glass,.005)
              B(.022,paneH+.04,.055,xx+bw/2-.012,z+face*(dd/2+.015),paneY-.01,M.metal,.004)
              if(!glazed) B(bw-.016,.025,.075,xx,z+face*(dd/2+.025),paneY-.025,M.bld2,.006)
            }
            // Overhangs shade glazing and visibly separate storeys.
            if(floor>0) B(w+.06,.026,.14,x,z+face*(dd/2+.025),yy+.08,M.clad,.007)
          }
          if(glazed) {
            const sideBays=Math.max(2,Math.round(dd/.43)), sd=dd/sideBays
            for(const face of [-1,1]) for(let bay=0;bay<sideBays;bay++) {
              const zz=z-dd/2+(bay+.5)*sd
              B(.022,step-.19,sd-.035,x+face*(w/2+.008),zz,yy+.17,M.glass,.005)
              B(.05,step-.14,.020,x+face*(w/2+.014),zz+sd/2-.01,yy+.15,M.metal,.004)
            }
          }
        }
        if (y < 0.2) {
          const doorW = Math.min(0.46, w * 0.40), doorH = Math.min(0.60, h * 0.72)
          B(doorW + 0.085, doorH + 0.05, 0.065, x, z + dd / 2 + 0.025, y, M.dark, 0.025)
          B(doorW, doorH, 0.018, x, z + dd / 2 + 0.063, y + 0.018, M.glass, 0.015)
          B(0.015, doorH, 0.023, x, z + dd / 2 + 0.076, y, M.metal, 0.005)
          B(doorW + 0.20, 0.045, 0.32, x, z + dd / 2 + 0.09, y + doorH + 0.06, M.bld2, 0.02)
          if (y > 0.02) {
            const key = `ramp-${doorW.toFixed(3)}-${y.toFixed(3)}`
            this.GC[key] ||= entranceRamp(doorW + 0.22, 0.40, y)
            put(this.GC[key], M.walk, x, 0, z + dd / 2 + 0.20)
          } else B(doorW + 0.22, 0.025, 0.27, x, z + dd / 2 + 0.12, 0, M.walk, 0.018)
        }
      }
      if (o.frames) [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => B(0.055, h, 0.055, x + sx * (w / 2 - 0.015), z + sz * (dd / 2 - 0.015), y, M.metal, 0.012))
      if (o.ribbons) for (let k = 0; k < o.ribbons; k++) B(w + 0.014, 0.14, dd + 0.014, x, z, y + 0.28 + (k * (h - 0.4)) / o.ribbons, M.glass, Math.min(rad + 0.007, 0.1))
      if (o.base !== false && o.frames) B(w + 0.03, 0.1, dd + 0.03, x, z, y, M.bld2, rad + 0.01)
      B(w + 0.05, 0.07, dd + 0.05, x, z, y + h, o.cap || M.bld2, Math.min(rad + 0.025, 0.12))
      if (o.parapet !== false) {
        const t = 0.035, ph = 0.08, yy = y + h + 0.07
        B(w + 0.05, ph, t, x, z - (dd + 0.05) / 2 + t / 2, yy, M.bld2, 0.01)
        B(w + 0.05, ph, t, x, z + (dd + 0.05) / 2 - t / 2, yy, M.bld2, 0.01)
        B(t, ph, dd - 0.02, x - (w + 0.05) / 2 + t / 2, z, yy, M.bld2, 0.01)
        B(t, ph, dd - 0.02, x + (w + 0.05) / 2 - t / 2, z, yy, M.bld2, 0.01)
      }
      for (let k = 0; k < (o.units || 0); k++) unit(x + (r() - 0.5) * (w - 0.5), y + h + 0.07, z + (r() - 0.5) * (dd - 0.4), r() < 0.5 ? 0 : Math.PI / 2)
      top = Math.max(top, PT + y + h + 0.25)
      return body
    }

    if (kind === 'towers') {
      B(3.1, 0.1, 2.5, 0.1, 0.15, 0, M.walk, 0.25); ao(3.1, 2.5, 0.1, 0.15, 0.6)
      bld(1.3, 5.0, 1.3, -0.45, -0.4, { y: 0.1, mat: M.glass, r: 0.14, frames: true, cap, parapet: false })
      B(1.02, 0.5, 1.02, -0.45, -0.4, 5.17, M.bld, 0.08)
      const cf: number[][] = []
      for (let s = 0; s < 4; s++)
        for (let k = 0; k < 6; k++) {
          const off = -0.4 + k * 0.16
          const p = [[off, -0.52], [off, 0.52], [-0.52, off], [0.52, off]][s]
          cf.push([-0.45 + p[0], 5.17, -0.4 + p[1], 0.03, 0.5, 0.07, 0, s > 1 ? Math.PI / 2 : 0])
        }
      I(G.box, M.metal, cf)
      B(1.1, 0.05, 1.1, -0.45, -0.4, 5.67, M.bld2, 0.06); C(0.025, 1.0, -0.45, -0.4, 5.72, M.metal, 8); L(-0.45, 6.75, -0.4, '#ff7a5c', true, 2)
      I(G.box, M.metal, [0, 1, 2, 3, 4].map((k) => [-0.95 + k * 0.25, 0.1, 0.26, 0.03, 5.0, 0.05]))
      bld(1.0, 3.4, 1.5, 0.95, 0.45, { y: 0.1, mat: M.glass, r: 0.12, frames: true, cap, units: 2 })
      bld(0.8, 2.1, 0.8, 0.75, -1.1, { y: 0.1, mat: M.bld, r: 0.06, ribbons: 4, units: 1 })
      B(0.5, 0.04, 0.5, 0.95, 0.55, 3.57, M.dark, 0.2, { cast: false })
      const el = B(0.14, 0.22, 0.18, -1.12, -0.4, 0.3, cap, 0.03, { dyn: true })
      A((t) => { el.position.y = PT + 0.3 + (Math.sin(t * 0.35) * 0.5 + 0.5) * 4.3 })
      B(0.7, 0.16, 0.36, -1.35, 1.05, 0.1, M.bld2, 0.05); shrub(-1.35, 1.05, 0.0001)
      tree(-1.45, 1.25, 0.8); cyp(-0.7, 1.5, 0.8); tree(1.6, -0.5, 0.7); shrub(-1.2, 1.0, 0.9); shrub(-1.55, 0.85, 0.8); bench(-0.2, 1.25, 0); bench(0.5, 1.3, 0)
      L(0.8, 4.0, 0.2, '#9fd0ff', true, 0.8)
    } else if (kind === 'arch') {
      C(1.4, 0.08, 0, 0, 0, M.walk, 64); ao(2.6, 2.6, 0, 0, 0.5)
      C(1.2, 1.0, 0, 0, 0.08, M.glassT, 64, undefined, { cast: false }); C(0.55, 1.0, 0, 0, 0.08, M.bld, 40); C(0.8, 0.32, 0, 0, 0.08, M.bld2, 40)
      I(this.cy(0.022, 0.022, 1, 8), M.metal, Array.from({ length: 24 }, (_, k) => {
        const a = (k / 24) * Math.PI * 2
        return [Math.cos(a) * 1.21, 0.08, Math.sin(a) * 1.21, 1, 1, 1]
      }))
      C(1.72, 0.12, 0, 0, 1.08, M.bld, 72); C(1.74, 0.04, 0, 0, 1.2, cap, 72, undefined, { cast: false }); C(0.62, 0.04, 0, 0, 1.2, M.glass, 40, undefined, { cast: false })
      const N = 16
      const bars = new THREE.InstancedMesh(this.rb(0.14, 1, 0.1, 0.03), cap, N)
      bars.castShadow = true
      g.add(bars)
      A((t) => {
        const D = this.dummy
        for (let k = 0; k < N; k++) {
          const a = (k / N) * Math.PI * 2
          D.position.set(Math.cos(a) * 1.12, PT + 1.24, Math.sin(a) * 1.12)
          D.rotation.set(0, -a, 0)
          const hh = 0.25 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.1 + k * 0.8)) * (0.6 + 0.4 * Math.sin(k * 1.7))
          D.scale.set(1, hh, 1)
          D.updateMatrix()
          bars.setMatrixAt(k, D.matrix)
        }
        bars.instanceMatrix.needsUpdate = true
      })
      top = Math.max(top, PT + 2.5)
      const ring = put(new THREE.TorusGeometry(1.5, 0.018, 8, 128), cap, 0, 2.6, 0, { rx: Math.PI / 2, cast: false, dyn: true })
      A((t) => {
        ring.rotation.z = t * 0.25
        ring.position.y = PT + 2.6 + Math.sin(t * 0.9) * 0.08
      })
      bld(0.7, 0.72, 0.55, 1.45, 1.0, { r: 0.06 }); B(0.8, 0.03, 0.32, 1.45, 1.38, 0.58, cap, 0.015)
      bld(0.6, 0.6, 0.6, -1.45, 0.95, { r: 0.06, units: 1 })
      tree(-1.0, -1.55, 0.8); cyp(1.25, -1.35, 0.8); shrub(-1.6, -0.6, 0.8); shrub(1.75, -0.4, 0.7); bench(0, -1.65, 0)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        L(Math.cos(a) * 1.74, 1.15, Math.sin(a) * 1.74, '#ffffff', false)
      }
    } else if (kind === 'hall') {
      B(2.66, 0.12, 1.36, -0.25, -0.55, 0, M.plinth, 0.03); ao(2.6, 1.3, -0.25, -0.55)
      B(2.6, 0.72, 1.3, -0.25, -0.55, 0, M.clad, 0.03); B(2.64, 0.06, 1.34, -0.25, -0.55, 0.72, M.bld2, 0.02)
      put(this.sawRoof(), M.bld2, -0.25, 0.78, -0.55, { h: 1.2 })
      for (let i = 0; i < 4; i++) {
        const xr = -0.25 + 1.3 - i * 0.65
        B(0.025, 0.32, 1.24, xr - 0.015, -0.55, 0.87, M.glass, 0.01)
      }
      ;[-1.0, -0.35].forEach((x) => {
        B(0.44, 0.5, 0.02, x, 0.105, 0.0, M.dark, 0.01)
        B(0.5, 0.05, 0.05, x, 0.11, 0.52, cap, 0.01)
      })
      B(0.9, 0.03, 0.4, -0.67, 0.3, 0.6, M.bld2, 0.01)
      bld(1.2, 0.6, 0.8, -0.9, 0.85, { units: 2, ribbons: 1 })
      ;[[1.48, -0.4], [1.48, 0.4]].forEach(([x, z]) => {
        C(0.34, 1.4, x, z, 0, M.metal, 32); put(G.hemi, M.metal, x, 1.4, z, { s: [0.34, 0.2, 0.34] })
        C(0.352, 0.04, x, z, 0.45, cap, 32); C(0.352, 0.04, x, z, 0.95, cap, 32)
        B(0.04, 1.4, 0.06, x - 0.35, z, 0, M.dark, 0.01); C(0.12, 0.06, x, z, 1.58, M.dark, 16)
      })
      put(this.cy(0.035, 0.035, 0.42, 10), M.metal, 1.14, 1.2, -0.4, { rz: Math.PI / 2 }); put(this.cy(0.035, 0.035, 0.42, 10), M.metal, 1.14, 1.05, 0.4, { rz: Math.PI / 2 }); B(0.06, 0.06, 0.85, 1.06, 0, 1.17, M.metal, 0.01)
      C(0.13, 2.0, -1.8, -0.2, 0, M.bld2, 20, 0.095); C(0.14, 0.06, -1.8, -0.2, 1.2, cap, 20); C(0.14, 0.06, -1.8, -0.2, 1.75, cap, 20); L(-1.8, 2.06, -0.2, '#ff7a5c', true, 1.2)
      B(1.8, 0.05, 0.26, 0.6, 1.15, 0.3, M.dark, 0.015)
      ;[-0.12, 0.12].forEach((dz) => B(1.8, 0.04, 0.02, 0.6, 1.15 + dz, 0.35, M.metal, 0.008))
      I(G.box, M.metal, [-0.2, 0.4, 1.0, 1.4].map((x) => [x, 0, 1.15, 0.035, 0.3, 0.2]))
      const boxes = new THREE.InstancedMesh(PR.carton, M.box, 6)
      boxes.castShadow = true
      g.add(boxes)
      A((t) => {
        const D = this.dummy
        D.rotation.set(0, 0, 0)
        for (let k = 0; k < 6; k++) {
          const u = (t * 0.12 + k / 6) % 1
          D.position.set(-0.25 + u * 1.75, PT + 0.35, 1.15)
          D.scale.set(0.16, 0.13, 0.16)
          D.updateMatrix()
          boxes.setMatrixAt(k, D.matrix)
        }
        boxes.instanceMatrix.needsUpdate = true
      })
      C(0.1, 0.12, 0.55, 0.7, 0, M.dark, 20); C(0.12, 0.03, 0.55, 0.7, 0, M.mark, 20)
      // robot arm
      const yaw = new THREE.Group()
      yaw.position.set(0.55, PT + 0.12, 0.7)
      g.add(yaw)
      const sh = new THREE.Group()
      sh.position.y = 0.04
      yaw.add(sh)
      P2(this.rb(0.08, 0.42, 0.08, 0.03), M.rackB, sh, 0, 0, 0)
      const elb = new THREE.Group()
      elb.position.y = 0.42
      sh.add(elb)
      P2(this.rb(0.065, 0.34, 0.065, 0.025), M.rackB, elb, 0, 0, 0); P2(G.sph, M.dark, elb, 0, 0, 0, [0.055, 0.055, 0.055]); P2(G.sph, M.dark, sh, 0, 0, 0, [0.06, 0.06, 0.06])
      A((t) => {
        yaw.rotation.y = Math.sin(t * 0.8) * 1.1
        sh.rotation.z = 0.35 + Math.sin(t * 1.6) * 0.2
        elb.rotation.z = 1.1 + Math.sin(t * 1.6 + 1) * 0.3
      })
      const fans: THREE.Group[] = []
      ;[[-1.2, 0.85], [-0.6, 0.85]].forEach(([x, z]) => {
        C(0.15, 0.05, x, z, 0.67, M.metal, 20)
        const f = new THREE.Group()
        f.position.set(x, PT + 0.73, z)
        g.add(f)
        ;[0, Math.PI / 2].forEach((ro) => { P2(G.box, M.dark, f, 0, 0, 0, [0.26, 0.01, 0.05]).rotation.y = ro })
        fans.push(f)
      })
      A((_t, dt) => fans.forEach((f) => (f.rotation.y += dt * 3)))
      if (!this.reduced) {
        const sm: THREE.Sprite[] = []
        for (let k = 0; k < 4; k++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.soft, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }))
          g.add(sp)
          sm.push(sp)
        }
        A((t) =>
          sm.forEach((sp, k) => {
            const u = (t * 0.16 + k / 4) % 1
            sp.position.set(-1.8 + u * 0.4, PT + 2.1 + u * 1.5, -0.2)
            sp.scale.setScalar(0.3 + u * 0.9)
            sp.material.opacity = (1 - u) * u * 1.0
          }),
        )
      }
      shrub(-1.75, 0.5, 0.8); shrub(-1.65, 1.3, 0.7)
      top = Math.max(top, PT + 2.2)
    } else if (kind === 'crates') {
      B(3.4, 0.02, 2.6, 0, -0.1, 0, M.bld2, 0.05, { cast: false })
      I(G.box, M.mark, [[0, 0.02, -0.47, 3.1, 0.004, 0.03], [0, 0.02, 0.53, 3.1, 0.004, 0.03], [-1.62, 0.02, 0.03, 0.03, 0.004, 1.0]])
      bld(3.3, 1.25, 0.14, 0, -1.6, { r: 0.025, parapet: false }); bld(0.14, 1.25, 1.5, -1.62, -0.78, { r: 0.025, parapet: false })
      ;[-1.62, 1.62].forEach((x) => B(0.09, 1.34, 0.09, x, -1.6, 0, cap, 0.02))
      B(3.4, 0.08, 0.1, 0, -1.6, 1.32, cap, 0.02)
      ;[-1.05, 0, 1.05].forEach((x) => {
        B(0.6, 0.75, 0.02, x, -1.53, 0, M.clad, 0.008)
        B(0.68, 0.05, 0.06, x, -1.52, 0.78, cap, 0.01)
        L(x, 0.95, -1.48, '#ffe2b8', false)
      })
      const rows = [-0.95, 0.05, 1.05], xs = [-1.5, -0.5, 0.5, 1.5], lv = [0.06, 0.62, 1.18]
      const ups: number[][] = [], beams: number[][] = [], pals: number[][] = [], loads: number[][] = [], lc: THREE.Color[] = [], wraps: number[][] = [], wc: THREE.Color[] = []
      const pal = [new THREE.Color('#ffffff'), new THREE.Color('#F2E9DA'), new THREE.Color('#E4D6BF'), new THREE.Color('#D6C7AE')]
      const film = [new THREE.Color('#FFFFFF'), new THREE.Color('#EEF3F6'), new THREE.Color('#E2EAF0')]
      rows.forEach((z) => {
        // Slender steel uprights with base plates; beams sit just under each level.
        xs.forEach((x) => [-0.2, 0.2].forEach((dz) => {
          ups.push([x, 0.02, z + dz, 0.034, 1.72, 0.04])
          ups.push([x, 0.0, z + dz, 0.07, 0.02, 0.07])
        }))
        lv.forEach((y) => [-0.2, 0.2].forEach((dz) => beams.push([0, y + 0.01, z + dz, 3.0, 0.04, 0.026])))
        ;[-1, 0, 1].forEach((bx) =>
          lv.forEach((y) =>
            [-0.24, 0.24].forEach((sx) => {
              if (r() < 0.8) {
                pals.push([bx + sx, y + 0.05, z, 1, 1, 1])
                if (r() < 0.35) {
                  // One tall stretch-wrapped unit load.
                  wraps.push([bx + sx, y + 0.145, z, 0.36, 0.33 + r() * 0.06, 0.31, 0, (r() - 0.5) * 0.04, 0])
                  wc.push(film[Math.floor(r() * film.length)])
                } else {
                  const st = 1 + (r() < 0.45 ? 1 : 0)
                  for (let s = 0; s < st; s++) {
                    const small = s > 0 && r() < 0.5
                    loads.push([bx + sx + (r() - 0.5) * 0.012, y + 0.144 + s * 0.191, z + (r() - 0.5) * 0.012, small ? 0.26 : 0.35 + r() * 0.025, small ? 0.15 : 0.19, small ? 0.24 : 0.30 + r() * 0.015, 0, (r() - 0.5) * 0.08, 0])
                    lc.push(pal[Math.floor(r() * pal.length)])
                  }
                }
              }
            }),
          ),
        )
      })
      const upright = I(G.box, M.rackU, ups), beam = I(G.box, M.rackB, beams)
      this.racks.push({ group: g, rows, xs, levels: lv, base: PT, legacy: [upright, beam] })
      I(PR.pallet, M.wood, pals); I(PR.carton, M.box, loads, lc)
      if (wraps.length) I(PR.wrapped, M.wrap, wraps, wc)
      top = Math.max(top, PT + 1.85)
      ;[[-0.47, 0], [0.53, 2.4]].forEach(([z, ph]) => {
        const fk = new THREE.Group()
        fk.position.set(0, PT, z)
        g.add(fk)
        P2(PR.forkBody, M.vc, fk, 0, 0, 0); P2(PR.forkMast, M.vc, fk, 0, 0, 0)
        const car = new THREE.Group()
        fk.add(car)
        this.forklifts.push({ fk, car })
        P2(PR.forkCar, M.vc, car, 0, 0, 0); P2(PR.pallet, M.wood, car, 0.398, 0.01, 0, [0.6, 0.6, 0.6]); P2(PR.carton, M.box, car, 0.398, 0.0664, 0, [0.22, 0.16, 0.2])
        A((t) => {
          const s = t * 0.45 + ph
          fk.position.x = Math.sin(s) * 1.15
          fk.rotation.y = 0 // Shunting in a warehouse aisle: reverse without flipping the load.
          car.position.y = 0.05 + (0.5 + 0.5 * Math.sin(t * 0.8 + ph)) * 0.42
        })
      })
      L(-1.6, 1.85, -0.95, '#ffe2b8', false); L(1.6, 1.85, 1.05, '#ffe2b8', false)
    } else if (kind === 'docks') {
      B(3.6, 0.14, 2.7, 0, -0.1, 0, M.bld2, 0.06); ao(3.6, 2.7, 0, -0.1, 0.4); B(3.6, 0.006, 0.05, 0, 1.2, 0.14, M.mark, 0.002, { cast: false })
      I(this.cy(0.035, 0.045, 0.08, 10), M.dark, [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5].map((x) => [x, 0.14, 1.13, 1, 1, 1]))
      // Shipping-line colours, weathered and desaturated; one in the department hue.
      const pal = [col.clone().lerp(new THREE.Color('#70787E'), 0.45), new THREE.Color('#8F4E3F'), new THREE.Color('#3F5F7A'), new THREE.Color('#CFC8B8'), new THREE.Color('#58705C'), new THREE.Color('#545B62')]
      const it: number[][] = [], cs: THREE.Color[] = []
      ;[-1.15, -0.2, 0.75].forEach((x) =>
        [-0.85, -0.4, 0.05].forEach((z) => {
          const st = 1 + Math.floor(r() * 3)
          for (let l = 0; l < st; l++) {
            it.push([x, 0.14 + l * 0.381, z, 0.88, 0.38, 0.4])
            cs.push(pal[Math.floor(r() * pal.length)])
          }
        }),
      )
      I(PR.container, M.cont, it, cs)
      // gantry crane
      const gan = new THREE.Group()
      g.add(gan)
      // Rail-mounted gantry: slender legs with sill beams and X-bracing, truss girders.
      // All bracing members share one instanced draw.
      const braces: THREE.Matrix4[] = []
      const brace = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
        const d = b.clone().sub(a)
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
        braces.push(new THREE.Matrix4().compose(a, q, new THREE.Vector3(t, d.length(), t)))
      }
      ;[-1.62, 1.62].forEach((sx) => {
        ;[-0.32, 0.32].forEach((sz) => P2(this.rb(0.065, 2.3, 0.065, 0.012), M.dark, gan, sx, PT + 0.14, sz))
        P2(this.rb(0.1, 0.09, 0.82, 0.02), M.dark, gan, sx, PT + 0.14, 0)
        for (const y0 of [0.3, 1.2]) {
          brace(new THREE.Vector3(sx, PT + y0, -0.3), new THREE.Vector3(sx, PT + y0 + 0.85, 0.3), 0.022)
          brace(new THREE.Vector3(sx, PT + y0, 0.3), new THREE.Vector3(sx, PT + y0 + 0.85, -0.3), 0.022)
        }
        P2(G.box, M.metal, gan, sx, PT + 2.1, 0, [0.035, 0.035, 0.64])
      })
      ;[-0.32, 0.32].forEach((sz) => {
        P2(this.rb(3.42, 0.04, 0.07, 0.01), M.dark, gan, 0, PT + 2.36, sz)
        P2(this.rb(3.42, 0.04, 0.07, 0.01), M.dark, gan, 0, PT + 2.58, sz)
        for (let k = 0; k < 12; k++) {
          const x0 = -1.62 + k * 0.27
          brace(new THREE.Vector3(x0, PT + 2.39, sz), new THREE.Vector3(x0 + 0.27, PT + 2.58, sz), 0.018)
        }
      })
      const braceMesh = new THREE.InstancedMesh(G.box, M.metal, braces.length)
      braces.forEach((m, i) => braceMesh.setMatrixAt(i, m))
      braceMesh.castShadow = true
      gan.add(braceMesh)
      P2(this.rb(0.34, 0.2, 0.42, 0.02), M.white, gan, 1.32, PT + 2.62, 0)
      for (let k = 0; k < 4; k++) P2(G.box, M.dark, gan, 1.32, PT + 2.66 + k * 0.035, 0.212, [0.26, 0.012, 0.004])
      P2(G.box, cap, gan, 1.32, PT + 2.62, 0, [0.345, 0.025, 0.425])
      const trl = new THREE.Group()
      trl.position.y = PT + 2.36
      gan.add(trl)
      P2(this.rb(0.34, 0.1, 0.76, 0.02), M.dark, trl, 0, 0, 0)
      const cable = P2(G.box, M.metal, trl, 0, -1, 0, [0.015, 1, 0.015])
      const hc = P2(PR.container, M.cont, trl, 0, -1.4, 0, [0.86, 0.36, 0.4])
      A((t) => {
        gan.position.z = Math.sin(t * 0.16) * 0.45
        trl.position.x = Math.sin(t * 0.42) * 1.15
        const Lc = 0.30 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.84))
        cable.scale.y = Lc
        cable.position.y = -Lc
        hc.position.y = -Lc - 0.36
      })
      top = Math.max(top, PT + 2.8)
      put(PR.cabStatic, M.vc, -1.12, 0.0, 1.64, { ry: -Math.PI / 2 }); put(PR.trailerStatic, M.vc, -0.38, 0.0, 1.64, { ry: -Math.PI / 2 })
      B(2.8, 0.05, 0.25, -0.25, 1.33, 0.14, M.metal, 0.01)
      L(-1.62, 2.6, 0, '#ffb648', true, 1.6); L(1.62, 2.6, 0, '#ffb648', true, 1.6)
    } else if (kind === 'dome') {
      put(this.arcWall(2.12, 1.48, 0.12, Math.PI * 0.95, Math.PI * 1.95), M.plinth, 0, 0, 0, { h: 0.12 })
      put(this.arcWall(2.05, 1.55, 0.25, Math.PI * 0.95, Math.PI * 1.95), M.bld, 0, 0.12, 0, { h: 0.37 })
      put(this.arcWall(2.04, 1.56, 0.36, Math.PI * 0.95, Math.PI * 1.95), M.glass, 0, 0.37, 0, { h: 0.73 })
      put(this.arcWall(2.08, 1.52, 0.05, Math.PI * 0.95, Math.PI * 1.95), cap, 0, 0.73, 0, { h: 0.78, cast: false })
      put(this.arcWall(2.08, 2.04, 0.07, Math.PI * 0.95, Math.PI * 1.95), M.bld2, 0, 0.78, 0, { h: 0.85 })
      put(G.hemi, M.glassT, 0, 0.08, 0, { s: [1.2, 1.15, 1.2], cast: false, h: 1.23 })
      const rib = new THREE.TorusGeometry(1, 0.012, 6, 48, Math.PI)
      for (let i = 0; i < 6; i++) put(rib, M.metal, 0, 0.08, 0, { ry: (i * Math.PI) / 6, s: [1.2, 1.15, 1.2] })
      put(new THREE.TorusGeometry(1.2, 0.012, 6, 72), M.metal, 0, 0.6, 0, { rx: Math.PI / 2, s: [0.88, 0.88, 1] })
      C(1.26, 0.08, 0, 0, 0, M.bld2, 64); C(1.27, 0.03, 0, 0, 0.08, cap, 64); C(0.2, 0.05, 0, 0, 1.2, cap, 24)
      tree(0, 0, 0.58); shrub(0.55, 0.3, 0.7); shrub(-0.5, -0.35, 0.6); put(new THREE.TorusGeometry(0.72, 0.045, 8, 48), M.bld2, 0, 0.12, 0, { rx: Math.PI / 2 })
      C(0.47, 0.04, 0.95, -1.4, 0, M.bld2, 40); C(0.42, 0.03, 0.95, -1.4, 0.02, M.water, 40)
      tree(-1.35, -1.25, 0.85); cyp(1.7, -0.45, 0.8); tree(-0.25, -1.85, 0.6); bench(0.1, -1.25, 0.4); shrub(1.55, -1.15, 0.7)
      L(0, 1.3, 0, '#ffe2b8', false)
    } else if (kind === 'grid') {
      bld(2.4, 0.95, 1.7, -0.25, -0.35, { r: 0.04, units: 0 })
      I(G.box, M.metal, Array.from({ length: 18 }, (_, k) => [-1.35 + k * 0.128, 0.12, 0.515, 0.028, 0.78, 0.06]))
      B(2.2, 0.025, 0.02, -0.25, 0.53, 0.9, cap, 0.008, { cast: false })
      const hv: number[][] = []
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) hv.push([-1.05 + i * 0.52, 1.02, -0.68 + j * 0.6, 1, 1, 1])
      I(PR.hvac, M.vc, hv)
      ;[0.65, 1.15].forEach((z) => {
        bld(0.7, 0.36, 0.34, 1.35, z, { r: 0.04, mat: M.white, parapet: false, cap: M.dark })
        C(0.03, 0.26, 1.6, z, 0.43, M.dark, 8)
      })
      ;[-1.0, -0.3].forEach((x) => B(0.1, 0.12, 0.36, x, 1.1, 0, M.dark, 0.02))
      put(this.cy(0.16, 0.16, 0.9, 20), M.white, -0.2, 0.3, 1.1, { rz: Math.PI / 2, h: 0.32 })
      C(0.05, 0.55, 1.48, -1.25, 0, M.metal, 10)
      const dish = new THREE.Group()
      dish.position.set(1.48, PT + 0.62, -1.25)
      g.add(dish)
      const tilt = new THREE.Group()
      tilt.rotation.x = 0.6
      dish.add(tilt)
      P2(G.hemi, M.white, tilt, 0, 0, 0, [0.38, 0.14, 0.38]).rotation.x = Math.PI
      P2(this.cy(0.012, 0.012, 0.3, 6), M.metal, tilt, 0, -0.02, 0)
      A((t) => { dish.rotation.y = t * 0.25 })
      top = Math.max(top, PT + 1.4)
      for (let k = 0; k < 6; k++) L(-1.25 + k * 0.36, 0.4, 0.56, ['#5FB9E6', '#8CF5B0', '#' + col.getHexString()][k % 3], true, 2 + r() * 3)
      shrub(-1.55, 0.75, 0.7); shrub(0.3, 1.55, 0.6)
    } else if (kind === 'lab') {
      C(1.08, 0.12, 0, -0.25, 0, M.plinth, 48); ao(2.2, 2.2, 0, -0.25); C(1.0, 1.75, 0, -0.25, 0, M.bld, 48); C(1.02, 0.32, 0, -0.25, 0.75, M.glass, 48); C(1.02, 0.2, 0, -0.25, 1.3, M.glass, 48)
      I(G.box, M.metal, Array.from({ length: 32 }, (_, k) => {
        const a = (k / 32) * Math.PI * 2
        return [Math.cos(a) * 1.08, 0.12, -0.25 + Math.sin(a) * 1.08, 0.035, 1.63, 0.14, 0, -a]
      }))
      C(1.13, 0.06, 0, -0.25, 1.75, cap, 48); C(1.13, 0.08, 0, -0.25, 1.81, M.bld2, 48); put(G.hemi, M.metal, 0, 1.87, -0.25, { s: [0.45, 0.4, 0.45], h: 0.45 })
      unit(0.55, 1.87, 0.2, 0); unit(-0.6, 1.87, -0.6, Math.PI / 2); C(0.015, 0.8, 0.55, -0.65, 1.87, M.metal, 6); L(0.55, 2.68, -0.65, '#ff7a5c', true, 1.5)
      ;[-0.28, 0.28].forEach((dz) => B(0.12, 0.72, 0.12, 0, 1.35 + dz, 0, M.bld2, 0.03))
      B(0.2, 0.1, 0.72, 0, 1.35, 0.72, M.bld2, 0.03)
      const scan = B(0.05, 0.03, 0.5, 0, 1.35, 0.4, cap, 0.01, { cast: false, dyn: true })
      A((t) => { scan.position.y = PT + 0.12 + (0.5 + 0.5 * Math.sin(t * 1.6)) * 0.55 })
      B(2.4, 0.05, 0.24, 0, 1.35, 0.25, M.dark, 0.015)
      ;[-0.11, 0.11].forEach((dz) => B(2.4, 0.04, 0.02, 0, 1.35 + dz, 0.3, M.metal, 0.008))
      const items = new THREE.InstancedMesh(PR.carton, M.box, 5)
      items.castShadow = true
      g.add(items)
      A((t) => {
        const D = this.dummy
        D.rotation.set(0, 0, 0)
        for (let k = 0; k < 5; k++) {
          const u = (t * 0.1 + k / 5) % 1
          D.position.set(-1.15 + u * 2.3, PT + 0.3, 1.35)
          D.scale.set(0.14, 0.1, 0.14)
          D.updateMatrix()
          items.setMatrixAt(k, D.matrix)
        }
        items.instanceMatrix.needsUpdate = true
      })
      tree(-1.55, 0.55, 0.75); cyp(1.55, 0.4, 0.7); shrub(-1.2, -1.5, 0.7); bench(-1.0, 0.75, 0)
    } else {
      // campus
      bld(2.3, 1.1, 0.85, -0.1, -0.95, { mat: M.glass, r: 0.1, frames: true, cap, parapet: false })
      B(2.12, 0.06, 0.68, -0.1, -0.95, 1.17, M.grass, 0.08)
      ;[-0.8, -0.1, 0.6].forEach((x) => put(PR.shrub, M.leafI, x, 1.2, -0.95, { s: [0.8, 0.8, 0.8] }))
      bld(0.85, 1.5, 1.5, -1.0, 0.35, { mat: M.glass, r: 0.1, frames: true, cap, parapet: true })
      I(G.box, M.dark, [[-1.18, 1.62, -0.15], [-0.82, 1.62, -0.15], [-1.18, 1.62, 0.35], [-0.82, 1.62, 0.35], [-1.18, 1.62, 0.85], [-0.82, 1.62, 0.85]].map((p) => [p[0], p[1], p[2], 0.3, 0.015, 0.4, -0.35, 0]))
      bld(1.0, 0.75, 1.0, 0.85, 0.65, { r: 0.1, units: 1 }); B(1.04, 0.03, 0.36, 0.85, 1.3, 0.55, cap, 0.015); B(0.6, 0.42, 0.03, 0.85, 1.16, 0.02, M.glass, 0.01)
      ;[0.5, 1.2].forEach((x) => C(0.025, 0.55, x, 1.43, 0, M.metal, 8))
      tree(1.55, -0.45, 0.8); cyp(0.7, -0.15, 0.7); shrub(1.5, 0.0, 0.7); bench(1.4, 1.55, 0); L(0.6, 0.6, 1.35, '#ffe2b8', false); L(1.1, 0.6, 1.35, '#ffe2b8', false)
    }
    if (kind === 'grid') {
      for (const x of [-0.85, -0.30, 0.25]) put(PR.server, M.vc, x, 0, 1.05)
    } else if (kind === 'dome' || kind === 'campus' || kind === 'arch') {
      put(PR.desk, M.vc, kind === 'campus' ? 0.8 : -0.5, 0, kind === 'campus' ? -0.10 : 1.65)
    } else if (kind === 'hall' || kind === 'lab') {
      put(PR.console, M.vc, kind === 'hall' ? 1.5 : -1.65, 0, kind === 'hall' ? 1.25 : -0.45)
    }
    return top
  }

  // ---------- theme ----------

  applyTheme(theme: Theme) {
    if (!this.world) return
    this.appliedTheme = theme
    const dk = theme === 'dark'
    const S = SCENE[theme], M = this.M
    ;(this.scene.background as THREE.Color).set(S.bg)
    ;(this.scene.fog as THREE.Fog).color.set(S.bg)
    this.renderer.toneMappingExposure = S.exposure
    M.ground.color.set(S.ground); M.dots.color.set(S.dots); M.dots.opacity = S.dotsOp; M.shade.opacity = S.shade
    M.bld.color.set(S.bld); M.bld2.color.set(S.bld2); M.plinth.color.set(S.plinth); M.clad.color.set(S.clad); M.glass.color.set(S.glass); M.glass.emissiveIntensity = S.win; M.glassT.color.set(S.glassT); M.glassT.opacity = S.glassTOp
    M.metal.color.set(S.metal); M.dark.color.set(S.dark); M.floor.color.set(S.floor); M.walk.color.set(S.walk); M.plate.color.set(S.plateSide); M.asphalt.color.set(S.asphalt); M.curb.color.set(S.curb); M.mark2.color.set(S.mark); M.grass.color.set(S.grass)
    M.leafI.color.set('#ffffff'); M.trunk.color.set(S.trunk); M.water.color.set(S.water); M.white.color.set(S.white); M.box.color.set('#ffffff'); M.cont.color.set('#ffffff'); M.person.color.set('#ffffff'); M.vc.color.set(dk ? '#c9ccd1' : '#ffffff')
    M.accent.color.set(S.accent); M.accent.emissive.set(S.accent); M.accent.emissiveIntensity = dk ? 0.6 : 0.16
    M.beam.color.set(S.accent); M.beam.opacity = dk ? 0.2 : 0.3; M.track.color.set(S.accent); M.track.opacity = dk ? 0.14 : 0.32
    this.coreEdge?.color.set(S.accent)
    if (this.ico) this.ico.visible = dk
    if (this.icoMat) {
      this.icoMat.color.set(S.accent)
      this.icoMat.opacity = dk ? 0.45 : 0.7
    }
    ;[M.ground, M.bld, M.bld2, M.plinth, M.dark, M.floor, M.walk, M.plate, M.white, M.cont, M.box, M.vc, M.curb, M.asphalt, M.mark2, M.grass, M.leafI, M.trunk, M.person, M.accent, M.rackU, M.rackB, M.mark].forEach((m) => (m.envMapIntensity = S.env))
    M.glass.roughness = dk ? 0.26 : 0.30
    M.metal.roughness = dk ? 0.32 : 0.38
    M.glass.envMapIntensity = S.env * 2.2; M.metal.envMapIntensity = S.env * 2.4; M.clad.envMapIntensity = S.env * 2; M.glassT.envMapIntensity = S.env * 3; M.water.envMapIntensity = S.env * 3.4
    this.capMats.forEach((m) => {
      m.envMapIntensity = S.env * 1.2
      m.emissiveIntensity = S.capGlow
    })
    M.glowS.opacity = S.glowOp; M.glowL.opacity = S.glowOp
    this.arcs.forEach((a) => (a.base = S.arcOp))
    this.hemi.color.set(S.hemiSky); this.hemi.groundColor.set(S.hemiGround); this.hemi.intensity = S.hemi
    this.dir.color.set(S.dirColor); this.dir.intensity = S.dir; this.rim.color.set(S.rimColor); this.rim.intensity = S.rim
    // Office wear: navy, charcoal, stone, olive, camel, wine. Operators wear hi-vis,
    // lab coats or navy coveralls, never the department colour.
    const pp = (dk
      ? ['#60738A', '#70767F', '#B2AB9C', '#7C8A73', '#A88F6E', '#8A5B61', '#56667A', '#C8C3B8']
      : ['#2E3D52', '#424850', '#9A9282', '#5C6B56', '#8D7457', '#6E3E45', '#34465C', '#B8B1A3']).map((c) => new THREE.Color(c))
    const uniformColor: Record<number, THREE.Color> = { 2: new THREE.Color(dk ? '#E9C64A' : '#E5B935'), 3: new THREE.Color('#ECEFEF'), 5: new THREE.Color(dk ? '#4F6680' : '#34485E') }
    const workShirt = new THREE.Color(dk ? '#56677A' : '#3E4C5A')
    this.ppl.forEach((p, i) => {
      const clothing = p.uniform && uniformColor[p.style] ? uniformColor[p.style] : pp[(i * 5 + p.skinTone) % pp.length]
      const sleeves = p.uniform && p.style === 2 ? workShirt : clothing
      this.peopleOutfits[p.style].setColorAt(p.outfitSlot, clothing)
      const skin = new THREE.Color(['#FFFFFF', '#DDCCBA', '#B39A85', '#8C7160'][p.skinTone])
      this.peopleSkin.setColorAt(i, skin)
      this.peopleHands.setColorAt(i * 2, skin)
      this.peopleHands.setColorAt(i * 2 + 1, skin)
      this.peopleArms.setColorAt(i * 2, sleeves)
      this.peopleArms.setColorAt(i * 2 + 1, sleeves)
      this.peopleForearms.setColorAt(i * 2, sleeves)
      this.peopleForearms.setColorAt(i * 2 + 1, sleeves)
    })
    if (this.peopleArms.instanceColor) this.peopleArms.instanceColor.needsUpdate = true
    if (this.peopleForearms.instanceColor) this.peopleForearms.instanceColor.needsUpdate = true
    M.skin.envMapIntensity = S.env * 0.4
    M.rubber.envMapIntensity = S.env * 0.25
    M.vehicleMetal.envMapIntensity = S.env * 1.8
    M.vehicleGlass.envMapIntensity = S.env * 2.2
    ;[...this.peopleOutfits, this.peopleSkin, this.peopleHands].forEach((mesh) => { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true })
    M.wood.envMapIntensity = S.env * 0.5
    M.contact.opacity = dk ? 0.26 : 0.18
    const la = new THREE.Color(S.leaf), lb = new THREE.Color(S.leaf2)
    this.foliageBatches.forEach(({ mesh, tones }) => {
      tones.forEach((tone, i) => mesh.setColorAt(i, la.clone().lerp(lb, tone)))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
    this.landTrees.forEach((im) => {
      ;(im.userData.tones as number[]).forEach((t, i) => im.setColorAt(i, la.clone().lerp(lb, t)))
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    })
    const recolor = (im: THREE.InstancedMesh | null) => {
      if (!im || !im.instanceColor) return
      for (let i = 0; i < im.count; i++) im.setColorAt(i, la.clone().lerp(lb, (i * 0.37) % 1))
      im.instanceColor.needsUpdate = true
    }
    this.d3.forEach((r) => r.veg.forEach(recolor))
    recolor(this.coreTrees)
    if (this.hedges) {
      const hedgeTone = la.clone().lerp(lb, 0.35).multiplyScalar(dk ? 0.95 : 0.9)
      for (let i = 0; i < this.hedges.count; i++) this.hedges.setColorAt(i, hedgeTone)
      if (this.hedges.instanceColor) this.hedges.instanceColor.needsUpdate = true
    }
    M.soil.color.set(dk ? '#2A2F35' : '#6E7276')
    M.meadow.color.set(S.grass).multiplyScalar(dk ? 0.9 : 0.97)
    M.meadow.envMapIntensity = S.env * 0.4
    M.wrap.envMapIntensity = S.env * 1.6
    M.wrap.color.set(dk ? '#9EA7AF' : '#FFFFFF')
    if (this.bloom) this.bloom.strength = S.bloom
    this.assets?.applyTheme(theme, S.env)
    this.applyCursor()
  }

  private applyCursor() {
    this.renderer.domElement.style.cursor = this.drag && this.drag.moved > 6 ? 'grabbing' : this.hoverId ? 'pointer' : 'grab'
  }

  // ---------- interaction ----------

  /** Ripple under a district; optionally flash its floating label. */
  pulse(id: string, flash?: boolean) {
    const r = this.d3map[id]
    if (r) r.pulse.t = 0
    if (flash && !this.reduced) {
      const el = this.labelsHost.querySelector<HTMLElement>('[data-dept-label="' + id + '"] button')
      if (el?.animate) {
        const c = DT[id] ? DT[id].color : '#CFF56A'
        el.animate([{ boxShadow: '0 0 0 0 ' + c + 'aa' }, { boxShadow: '0 0 0 9px ' + c + '00' }], { duration: 900, easing: 'ease-out' })
      }
    }
  }

  private pick(e: PointerEvent) {
    const rc = this.renderer.domElement.getBoundingClientRect()
    this.ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    const h = this.ray.intersectObjects(this.pickables, false)[0]
    return h ? (h.instanceId !== undefined && h.object.userData.instanceDepts ? h.object.userData.instanceDepts[h.instanceId] || null : h.object.userData.dept as string) : null
  }

  private setHover(id: string | null) {
    if (id === this.hoverId) return
    this.hoverId = id
    this.applyCursor()
  }

  private cancelFlight() {
    if (!this.flight) return
    const c = this.cam, g = this.goal
    g.theta = c.theta; g.phi = c.phi; g.r = c.r; g.target.copy(c.target)
    this.flight = null
  }

  private onDown = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(e.pointerId)
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.drag = { moved: 0, btn: e.button, shift: e.shiftKey }
    this.interact = performance.now()
    this.cancelFlight()
    if (this.ptrs.size === 2) {
      // A pinch is never a click, even if both fingers barely move.
      this.drag.moved = 6
      const [a, b] = [...this.ptrs.values()]
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y)
    }
    this.cb.onCanvasPointer()
  }

  private onMove = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId)
    if (!p || !this.drag) {
      if (performance.now() - this.hoverAt > 40) {
        this.hoverAt = performance.now()
        this.setHover(this.pick(e))
      }
      return
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    this.drag.moved += Math.abs(dx) + Math.abs(dy)
    this.interact = performance.now()
    if (this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinch) this.goal.r = clamp((this.goal.r * this.pinch) / d, 14, this.r0 * 1.7)
      this.pinch = d
      return
    }
    if (this.drag.moved < 5) return
    const g = this.goal
    if (this.drag.btn === 2 || this.drag.shift) {
      const k = g.r * 0.0016
      const right = new THREE.Vector3(Math.cos(g.theta), 0, -Math.sin(g.theta))
      const fwd = new THREE.Vector3(-Math.sin(g.theta), 0, -Math.cos(g.theta))
      g.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k)
      g.target.x = clamp(g.target.x, -45, 45)
      g.target.z = clamp(g.target.z, -45, 45)
      this.focusId = null
    } else {
      g.theta -= dx * 0.006
      g.phi = clamp(g.phi - dy * 0.004, 0.35, 1.28)
    }
    this.applyCursor()
  }

  private onUp = (e: PointerEvent) => {
    const wasDrag = this.drag
    this.ptrs.delete(e.pointerId)
    if (this.ptrs.size < 2) this.pinch = 0
    if (this.ptrs.size === 0) {
      if (wasDrag && wasDrag.moved < 6 && wasDrag.btn === 0) {
        const id = this.pick(e)
        if (id && id !== 'core') this.cb.onSelect(id)
        else if (this.cb.getView().selected) this.cb.onDeselect()
      }
      this.drag = null
      this.applyCursor()
    }
  }

  private onCancel = (e: PointerEvent) => {
    if (this.drag) this.drag.moved = Math.max(6, this.drag.moved)
    this.onUp(e)
  }

  private onLeave = () => {
    if (!this.drag) this.setHover(null)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.interact = performance.now()
    this.cancelFlight()
    this.goal.r = clamp(this.goal.r * (1 + clamp(e.deltaY, -100, 100) * 0.0012), 12, this.r0 * 1.7)
  }

  private onContext = (e: Event) => e.preventDefault()

  zoom(factor: number) {
    this.cancelFlight()
    this.interact = performance.now()
    this.goal.r = clamp(this.goal.r * factor, 14, this.r0 * 1.7)
  }

  private focusTarget(id: string, theta: number, r: number) {
    const v = this.d3map[id].pos.clone()
    // offset so the district sits clear of the side panel (desktop) or bottom sheet (mobile)
    if (this.isMobile()) v.addScaledVector(new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta)), -r * 0.17)
    else v.addScaledVector(new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)), r * 0.16)
    return v
  }

  private startFlight(b: CamState, dur: number) {
    const c = this.cam
    const a = { theta: c.theta, phi: c.phi, r: c.r, target: c.target.clone() }
    let d = b.theta - a.theta
    d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    b.theta = a.theta + d
    const lift = Math.min(10, a.target.distanceTo(b.target) * 0.3)
    this.flight = { a, b, t: 0, dur: this.reduced ? 0.22 : dur, lift: this.reduced ? 0 : lift }
  }

  /** Flies the camera to a district. */
  flyTo(id: string) {
    const rec = this.d3map[id]
    if (!rec) return
    this.focusId = id
    const p = rec.pos, c = this.cam
    let th = Math.atan2(p.x, p.z) + 0.55
    let d = th - c.theta
    d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    th = c.theta + d
    const r = this.isMobile() ? 40 : 26
    this.startFlight({ theta: th, phi: 0.84, r, target: this.focusTarget(id, th, r) }, 1.9)
    this.pulse(id)
  }

  /** Flies back to the overview. */
  flyHome() {
    this.focusId = null
    this.startFlight({ theta: this.cam.theta + 0.3, phi: 0.95, r: this.r0, target: new THREE.Vector3() }, 1.7)
  }

  private onMotionPreference = () => {
    this.reduced = !!this.motionQuery?.matches
  }

  // ---------- frame loop ----------

  private tick = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const frameSeconds = Math.max(0, (now - (this.last || now)) / 1000)
    const dt = Math.min(0.1, frameSeconds)
    this.last = now
    const rm = this.reduced
    const t = (this.time += rm ? 0 : dt)
    const s = this.cb.getView()
    const c = this.cam, g = this.goal
    if (s.theme !== this.appliedTheme) this.applyTheme(s.theme)

    // adaptive quality: step down when fps stays low
    if (this.quality === 'auto') {
      this.fpsN++
      this.fpsT += frameSeconds
      if (this.fpsT > 2.5) {
        const fps = this.fpsN / this.fpsT
        this.measuredFps = fps
        this.fpsN = 0
        this.fpsT = 0
        if (fps < 38 && this.autoLevel > 0 && !document.hidden && now > 6000) {
          this.autoLevel--
          this.applyQuality()
        }
      }
    }

    const idle = !this.drag && now - this.interact > 2600 && !this.flight
    const want = s.autoRotate && !rm && idle ? (s.selected ? 0.016 : 0.05) : 0
    this.autoV += (want - this.autoV) * (1 - Math.exp(-dt * (want > this.autoV ? 0.6 : 4)))
    g.theta += this.autoV * dt
    if (this.flight) {
      const f = this.flight
      f.t += dt / f.dur
      const u = Math.min(1, f.t)
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
      const bump = Math.sin(u * Math.PI)
      c.theta = f.a.theta + (f.b.theta - f.a.theta) * e
      c.phi = f.a.phi + (f.b.phi - f.a.phi) * e - (f.lift > 0 ? bump * 0.07 : 0)
      c.r = f.a.r + (f.b.r - f.a.r) * e + bump * f.lift
      c.target.lerpVectors(f.a.target, f.b.target, e)
      if (u >= 1) {
        this.flight = null
        g.theta = c.theta; g.phi = c.phi; g.r = c.r; g.target.copy(c.target)
      }
    } else {
      if (this.focusId && this.d3map[this.focusId]) g.target.copy(this.focusTarget(this.focusId, g.theta, g.r))
      const k = 1 - Math.exp(-dt * (rm ? 10 : 4.5))
      c.theta += (g.theta - c.theta) * k
      c.phi += (g.phi - c.phi) * k
      c.r += (g.r - c.r) * k
      c.target.lerp(g.target, k)
    }
    const sp = Math.sin(c.phi)
    this.camera.position.set(c.target.x + c.r * sp * Math.sin(c.theta), c.target.y + c.r * Math.cos(c.phi), c.target.z + c.r * sp * Math.cos(c.theta))
    this.camera.lookAt(c.target)
    const R = this.R
    this.dir.position.set(c.target.x + R * 1.4, R * 2.6, c.target.z + R * 0.9)
    this.dir.target.position.copy(c.target)

    for (const a of this.anims) a(t, dt * (rm ? 0 : 1))
    for (const gs of this.glowSets) {
      const arr = gs.col.array as Float32Array
      gs.list.forEach((it, i) => {
        if (!it.blink) return
        const f = Math.sin(t * (it.sp || 1) + (it.ph || 0)) > 0.2 ? 1 : 0.15
        arr[i * 3] = it.c.r * f
        arr[i * 3 + 1] = it.c.g * f
        arr[i * 3 + 2] = it.c.b * f
      })
      gs.col.needsUpdate = true
    }

    const sel = s.selected, hov = this.hoverId
    const k2 = 1 - Math.exp(-dt * 5)
    for (const r of this.d3) {
      const isS = r.id === sel, isH = r.id === hov
      const bt = isS ? 1 : isH ? 0.7 : 0
      r.brkMat.opacity += (bt - r.brkMat.opacity) * k2
      r.brk.visible = r.brkMat.opacity > 0.01
      r.brk.scale.setScalar(1 + (1 - r.brkMat.opacity) * 0.06 + (isS ? Math.sin(t * 2.4) * 0.008 : 0))
      r.edgeMat.opacity += ((isS || isH ? 1 : sel ? 0.3 : 0.75) - r.edgeMat.opacity) * k2
      r.hs += ((isS ? 1 : 0) - r.hs) * (1 - Math.exp(-dt * 3))
      r.holo.visible = r.hs > 0.01
      if (r.holo.visible) {
        r.holo.scale.setScalar(0.6 + 0.4 * r.hs)
        r.holo.rotation.y = t * 0.2
        r.holoMats[0].opacity = 0.14 * r.hs
        r.holoMats[1].opacity = 0.85 * r.hs
      }
      if (isS && r.pulse.t > 2.2) r.pulse.t = 0
      if (isH && !isS && r.pulse.t > 1.6) r.pulse.t = 0
      r.pulse.t += dt
      const pt = r.pulse.t
      r.pulse.mesh.scale.setScalar(1 + pt * 0.3)
      r.pulse.mat.opacity = Math.max(0, 0.7 - pt * 0.5)
      r.pulse.mesh.visible = !rm && pt < 1.5
    }

    const fl = s.flows
    for (const a of this.arcs) {
      const rel = !sel || a.a === sel || a.b === sel
      const to = fl ? (rel ? (sel ? 1 : a.base) : 0.07) : 0
      a.mat.opacity += (to - a.mat.opacity) * k2
      a.mat.visible = a.mat.opacity > 0.01
      a.map.offset.x -= dt * a.sp * (rm ? 0 : 1)
    }
    for (const m of this.roadMaps) m.offset.y -= dt * 0.35 * (rm ? 0 : 1)
    this.packets.visible = fl
    this.pkGlow.visible = fl
    if (fl) {
      const D = this.dummy
      D.rotation.set(0, 0, 0)
      this.pk.forEach((p, i) => {
        const u = (t * p.sp + p.off) % 1
        p.arc.curve.getPoint(u, D.position)
        const rel = !sel || p.arc.a === sel || p.arc.b === sel
        D.scale.setScalar(rel ? 1 : 0.4)
        D.updateMatrix()
        this.packets.setMatrixAt(i, D.matrix)
        this.pkPos[i * 3] = D.position.x
        this.pkPos[i * 3 + 1] = rel ? D.position.y : -50
        this.pkPos[i * 3 + 2] = D.position.z
      })
      this.packets.instanceMatrix.needsUpdate = true
      this.pkGlow.geometry.attributes.position.needsUpdate = true
    }

    const pv = s.people
    const legacyPeople = !this.assets?.ownsPeople, legacyVehicles = !this.assets?.ownsVehicles
    const population = [
      ...(legacyPeople ? [...this.legacyPeopleMeshes(), this.peopleContact] : []),
      ...(legacyVehicles ? [...this.legacyVehicleMeshes(), this.truckShade] : []),
    ]
    population.forEach((mesh) => { mesh.visible = pv })
    this.assets?.tick(t, dt, pv, rm, this.camera)
    if (pv && legacyPeople) {
      const D = this.dummy, local = this.actorLocal, actor = this.actorMatrix
      this.ppl.forEach((p, i) => {
        const walking = p.role === 'walk'
        if (walking && !rm) p.a += p.s * dt / p.r
        const center = p.rec?.pos
        const stride = walking && !rm ? Math.sin(t * (Math.abs(p.s) / 0.24) * 7 + p.ph) * 0.38 : 0
        // Lift root only enough to keep the lowest sole on the pavement.
        const knee = (sign: number) => walking && !rm ? Math.max(0, -stride * sign) * 1.15 : .045
        const sole = (sign: number) => .212 - .100 * Math.cos(stride*sign) - .112 * Math.cos(stride*sign+knee(sign)) - .053 * Math.abs(Math.sin(stride*sign+knee(sign)))
        const footLift = Math.max(0, -sole(-1), -sole(1))
        D.position.set((center?.x || 0) + Math.cos(p.a) * p.r, ROAD_LEVEL + footLift * p.height * PERSON_SCALE, (center?.z || 0) + Math.sin(p.a) * p.r)
        D.rotation.set(0, p.role === 'work' ? -p.a - Math.PI / 2 : -p.a + (p.s > 0 ? 0 : Math.PI), 0)
        D.scale.set(p.width * PERSON_SCALE, p.height * PERSON_SCALE, PERSON_SCALE)
        D.updateMatrix()
        actor.copy(D.matrix)
        this.peopleOutfits[p.style].setMatrixAt(p.outfitSlot, actor)
        this.peopleSkin.setMatrixAt(i, actor)
        local.position.set(0, 0, 0)
        local.rotation.set(0, 0, 0)
        local.scale.setScalar(p.uniform && p.style!==3 ? 1 : 0)
        local.updateMatrix()
        this.peopleHelmets.setMatrixAt(i, this.partMatrix.multiplyMatrices(actor, local.matrix))
        for (let side = 0; side < 2; side++) {
          const sign = side ? 1 : -1
          local.scale.setScalar(1)
          local.position.set(sign * 0.045, 0.212, 0)
          local.rotation.set(stride * sign, 0, 0)
          local.updateMatrix()
          this.peopleLegs.setMatrixAt(i * 2 + side, this.partMatrix.multiplyMatrices(actor, local.matrix))
          local.position.set(sign * .045, .212-.100*Math.cos(stride*sign), -.100*Math.sin(stride*sign))
          local.rotation.set(stride*sign + knee(sign), 0, 0)
          local.updateMatrix()
          this.peopleShins.setMatrixAt(i*2+side, this.partMatrix.multiplyMatrices(actor,local.matrix))
          local.position.set(sign * 0.072, 0.379, 0)
          local.rotation.set(p.role === 'work' ? -0.8 + (rm ? 0 : Math.sin(t * 1.1 + p.ph) * 0.12) : p.role === 'stand' && p.pose === 1 ? -0.55 : -stride * sign * 0.72, p.role === 'stand' && p.pose === 1 ? sign * 0.24 : 0, sign * -0.07)
          local.updateMatrix()
          this.partMatrix.multiplyMatrices(actor, local.matrix)
          this.peopleArms.setMatrixAt(i * 2 + side, this.partMatrix)
          // Forearm pivots at the elbow, with a small bend during the gait.
          const shoulder = local.rotation.x
          const elbow = p.role === 'work' ? -.75 : p.role === 'stand' && p.pose===1 ? -1.1 : -.18 - Math.max(0,stride*sign)*.35
          local.position.y -= .095*Math.cos(shoulder)
          local.position.z -= .095*Math.sin(shoulder)
          local.position.x += sign*.006
          local.rotation.x += elbow
          local.updateMatrix()
          this.partMatrix.multiplyMatrices(actor,local.matrix)
          this.peopleForearms.setMatrixAt(i*2+side,this.partMatrix)
          this.peopleHands.setMatrixAt(i * 2 + side, this.partMatrix)
        }
      })
      this.ppl.forEach((_person, i) => {
        this.peopleSkin.getMatrixAt(i, actor)
        D.position.set(actor.elements[12], ROAD_LEVEL + 0.003, actor.elements[14])
        D.rotation.set(0, 0, 0)
        D.scale.set(.19 * PERSON_SCALE, 1, .13 * PERSON_SCALE)
        D.updateMatrix()
        this.peopleContact.setMatrixAt(i, D.matrix)
      })
    }
    if (pv && legacyVehicles) {
      const D = this.dummy, local = this.actorLocal, actor = this.actorMatrix
      this.trucks.forEach((truck, i) => {
        const road = truck.rec.road
        const pose = servicePose(t * truck.sp + truck.off, road.from.distanceTo(road.to))
        const cos = Math.cos(road.rot), sin = Math.sin(road.rot)
        D.position.set(road.from.x + cos * pose.x + sin * pose.z, ROAD_LEVEL, road.from.z - sin * pose.x + cos * pose.z)
        D.rotation.set(0, road.rot + pose.yaw, 0)
        D.scale.setScalar(TRUCK_SCALE)
        D.updateMatrix()
        actor.copy(D.matrix)
        this.trailerMesh.setMatrixAt(i, actor)
        this.truckLivery.setMatrixAt(i, actor)
        local.position.set(0, 0, 0.74)
        local.rotation.set(0, 0, 0)
        local.scale.setScalar(1)
        local.updateMatrix()
        this.partMatrix.multiplyMatrices(actor, local.matrix)
        this.cabMesh.setMatrixAt(i, this.partMatrix)
        this.truckGlass.setMatrixAt(i, this.partMatrix)
        for (let wheel = 0; wheel < 6; wheel++) {
          const side = wheel % 2 ? 1 : -1
          local.position.set(side * 0.208, 0.087, wheel < 2 ? 0.78 : wheel < 4 ? -0.28 : -0.43)
          local.rotation.set(side * (t * truck.sp + truck.off) / (0.087 * TRUCK_SCALE), side < 0 ? Math.PI : 0, 0)
          local.updateMatrix()
          this.partMatrix.multiplyMatrices(actor, local.matrix)
          this.truckWheels.setMatrixAt(i * 6 + wheel, this.partMatrix)
          this.truckHubs.setMatrixAt(i * 6 + wheel, this.partMatrix)
        }
        const shadow = this.dummy
        shadow.position.set(actor.elements[12], ROAD_LEVEL + 0.003, actor.elements[14])
        shadow.rotation.set(0, road.rot + pose.yaw, 0)
        shadow.scale.set(0.59 * TRUCK_SCALE, 1, 1.62 * TRUCK_SCALE)
        shadow.updateMatrix()
        this.truckShade.setMatrixAt(i, shadow.matrix)
      })
    }
    if (pv) population.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true })

    const dkT = s.theme === 'dark'
    if (this.bloom) this.bloom.enabled = dkT
    if (this.gtao) this.gtao.enabled = this.qLevel >= 2
    const usePost = this.composer && ((this.gtao && this.qLevel >= 2) || (dkT && this.qLevel >= 1))
    this.renderer.info.reset()
    try {
      if (usePost) this.composer!.render(dt)
      else this.renderer.render(this.scene, this.camera)
    } catch (err) {
      console.warn('arx post off', err)
      this.composer?.passes.forEach((pass) => pass.dispose())
      this.composer?.dispose()
      this.composer = null
      this.renderer.render(this.scene, this.camera)
    }

    this.projectLabels(s, sel, hov)
  }

  /** Positions the HTML district labels over their 3D anchors. */
  private projectLabels(s: WorldView, sel: string | null, hov: string | null) {
    const host = this.labelsHost
    const w = host.clientWidth, h = host.clientHeight
    host.querySelectorAll<HTMLElement>('[data-dept-label]').forEach((el) => {
      const id = el.getAttribute('data-dept-label')!
      let hide: boolean
      if (id === 'core') {
        this.tmpV.set(0, this.coreLabelY, 0)
        hide = !!sel
      } else {
        const r = this.d3map[id]
        if (!r) {
          el.style.opacity = '0'
          return
        }
        this.tmpV.set(r.pos.x, r.labelY, r.pos.z)
        hide = id === sel || (!s.labels && id !== hov)
      }
      this.tmpV.project(this.camera)
      if (this.tmpV.z > 1) hide = true
      el.style.transform = 'translate(' + (((this.tmpV.x + 1) / 2) * w).toFixed(1) + 'px,' + (((1 - this.tmpV.y) / 2) * h).toFixed(1) + 'px) translate(-50%,-100%)'
      el.style.opacity = hide ? '0' : sel ? '.55' : '1'
      // The button enables pointer events itself; opacity alone leaves it clickable.
      el.style.visibility = hide ? 'hidden' : 'visible'
      el.inert = hide
      el.style.pointerEvents = hide ? 'none' : ''
      el.style.transition = 'opacity .3s'
    })
  }
}
