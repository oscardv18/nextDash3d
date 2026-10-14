import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { modelParts, nodePosition, partsBox, type AssetLibrary, type ModelName, type ModelPart } from './assets'
import { servicePose, ROAD_LEVEL } from './premium'
import type { Theme } from './data'
import type { ArxWorld } from './world'

/**
 * Upgrades a procedurally built world with the GLB asset library:
 * trees (distance LOD), skinned people, vehicles, forklifts, racking, cargo,
 * street furniture and PBR ground textures. The procedural meshes remain the
 * fallback; this layer only swaps or hides them once assets are ready.
 */

/** World units per metre: a 1.75 m person is ~0.43 units tall. */
const STREET_M = 0.246
/** The warehouse interiors use a slightly larger scale (a 1.2 m pallet is ~0.42 units). */
const RACK_M = 0.3636
const FORK_M = 0.3
const NEAR_TREE = 26

const SPECIES = ['oak', 'street', 'pine', 'ash', 'aspen', 'shrub'] as const
type Species = (typeof SPECIES)[number]
/** Height in world units of a unit-scale tree instance. */
const SPECIES_HEIGHT: Record<Species, number> = { oak: 1.85, street: 1.75, pine: 2.25, ash: 1.95, aspen: 1.95, shrub: 0.55 }
/** Legacy canopy variant -> species. */
const VARIANT_SPECIES: Record<string, Species> = { tree0: 'oak', tree1: 'street', tree2: 'pine', tree3: 'ash', tree4: 'aspen', tree5: 'oak', cypress: 'pine', shrub: 'shrub' }

interface TreeSet {
  species: Species
  matrices: THREE.Matrix4[]
  positions: THREE.Vector3[]
  tints: THREE.Color[]
  near: THREE.InstancedMesh[]
  far: THREE.InstancedMesh[]
}

interface Person {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  walker: ArxWorld['ppl'][number]
}

interface Fleet {
  indices: number[]
  body: THREE.InstancedMesh[]
  livery: THREE.InstancedMesh
  wheels: THREE.InstancedMesh
  wheelExtras: THREE.InstancedMesh[]
  wheelPos: THREE.Vector3[]
  radius: number
  length: number
}

interface Synced { primary: THREE.InstancedMesh; siblings: THREE.InstancedMesh[]; version: number }

/** Materials owned by the asset layer (survive world rebuilds; themed together). */
const assetMaterials = new Set<THREE.MeshStandardMaterial>()
const keepMaterial = <M extends THREE.Material>(m: M) => {
  m.userData.keep = true
  if ((m as unknown as THREE.MeshStandardMaterial).isMeshStandardMaterial) assetMaterials.add(m as unknown as THREE.MeshStandardMaterial)
  return m
}

export class AssetLayer {
  ownsPeople = false
  ownsVehicles = false
  private readonly lib: AssetLibrary
  private readonly w: ArxWorld
  private readonly barkMats: Record<string, THREE.MeshStandardMaterial> = {}
  private readonly leafMats: Record<string, THREE.MeshStandardMaterial> = {}
  private readonly personMat: THREE.MeshStandardMaterial
  private readonly treeParts: Record<Species, { near: ModelPart[]; far: ModelPart[] }>
  private readonly fitCache = new Map<string, ModelPart[]>()
  private trees: TreeSet[] = []
  private people: Person[] = []
  private fleets: Fleet[] = []
  private synced: Synced[] = []
  private lodClock = 1
  private camPos = new THREE.Vector3()
  private readonly m4 = new THREE.Matrix4()
  private readonly m4b = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly e = new THREE.Euler()

  constructor(lib: AssetLibrary, world: ArxWorld) {
    this.lib = lib
    this.w = world
    const T = lib.textures
    for (const kind of ['oak', 'plane'] as const) {
      const map = T[`bark_${kind}_diff`].clone()
      const normalMap = T[`bark_${kind}_nor`].clone()
      for (const t of [map, normalMap]) t.repeat.set(1, 3)
      this.barkMats[`bark_${kind}`] = keepMaterial(new THREE.MeshStandardMaterial({ name: `bark_${kind}`, map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95 }))
    }
    for (const kind of ['oak', 'ash', 'aspen', 'pine'] as const) {
      const map = T[`leaf_${kind}`]
      const mat = keepMaterial(new THREE.MeshStandardMaterial({ name: `leaf_${kind}`, map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82 }))
      this.leafMats[`leaf_${kind}`] = mat
    }
    this.personMat = keepMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 }))
    const treeParts = {} as AssetLayer['treeParts']
    for (const species of SPECIES) {
      const gltf = lib.models[`tree_${species}` as ModelName]
      const take = (names: string[]) => names.flatMap((n) => modelParts(gltf, n)).map((p) => this.treeMaterial(p))
      treeParts[species] = { near: take(['bark', 'leaves']), far: take(['bark_lod1', 'leaves_lod1']) }
    }
    this.treeParts = treeParts
    this.applyGroundTextures()
  }

  private treeMaterial(part: ModelPart): ModelPart {
    const name = part.material.name
    part.geometry.userData.keep = true
    const material = name.startsWith('leaf_') ? this.leafMats[name] : this.barkMats[name] ?? this.barkMats.bark_oak
    return { ...part, material }
  }

  // ---------------------------------------------------------------- ground

  /** CC0 detail maps (neutral grey) multiplied by each theme's surface colours. */
  private applyGroundTextures() {
    const T = this.lib.textures, M = this.w.M
    const set = (mat: THREE.MeshStandardMaterial, name: 'asphalt' | 'pavers' | 'concrete', repeat: number, normal = 1) => {
      const map = T[`${name}_diff`].clone(), normalMap = T[`${name}_nor`].clone(), roughnessMap = T[`${name}_rough`].clone()
      for (const t of [map, normalMap, roughnessMap]) t.repeat.set(repeat, repeat)
      Object.assign(mat, { map, normalMap, roughnessMap })
      mat.normalScale.set(normal, normal)
      mat.roughness = 1
      mat.needsUpdate = true
    }
    set(M.asphalt, 'asphalt', 1.4, 0.6)
    set(M.floor, 'pavers', 0.9, 0.7)
    set(M.plinth, 'concrete', 0.8, 0.5)
    set(M.plate, 'concrete', 0.8, 0.5)
  }

  // ---------------------------------------------------------------- attach

  /** Called after every world build. */
  attach() {
    const W = this.w.world
    if (!W) return
    this.trees = []
    this.people = []
    this.fleets = []
    this.synced = []
    this.lodClock = 1
    const removed = new Set<THREE.Object3D>()
    // Each upgrade is independent: a faulty asset leaves only its own stand-ins in place.
    const steps: [string, () => void][] = [
      ['trees', () => this.replaceTrees(W, removed)],
      ['props', () => this.swapProps(W)],
      ['racks', () => this.upgradeRacks()],
      ['forklifts', () => this.upgradeForklifts()],
      ['people', () => this.buildPeople(W)],
      ['vehicles', () => this.buildFleet(W)],
    ]
    for (const [name, step] of steps) {
      try {
        step()
      } catch (error) {
        console.warn(`arx assets: ${name} kept procedural`, error)
      }
    }
    this.w.pickables = this.w.pickables.filter((o) => !removed.has(o))
    this.setQuality(this.w.qLevel)
  }

  // ---------------------------------------------------------------- trees

  private replaceTrees(W: THREE.Group, removed: Set<THREE.Object3D>) {
    const bySpecies = new Map<Species, TreeSet>()
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3()
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (const { mesh } of this.w.foliageBatches) {
      const species = VARIANT_SPECIES[mesh.geometry.userData.foliage as string] ?? 'oak'
      if (!bySpecies.has(species)) bySpecies.set(species, { species, matrices: [], positions: [], tints: [], near: [], far: [] })
      const set = bySpecies.get(species)!
      mesh.updateWorldMatrix(true, false)
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix)
        matrix.premultiply(mesh.matrixWorld).premultiply(this.m4.copy(W.matrixWorld).invert())
        matrix.decompose(pos, quat, scale)
        const h = SPECIES_HEIGHT[species] * scale.y * (0.92 + rand() * 0.16)
        // Real trees: random yaw and a slight lean keep repeated species from reading as clones.
        quat.setFromEuler(this.e.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06))
        set.matrices.push(new THREE.Matrix4().compose(pos.clone(), quat.clone(), new THREE.Vector3(h, h, h)))
        set.positions.push(pos.clone())
        set.tints.push(new THREE.Color().setScalar(0.86 + rand() * 0.2))
      }
      mesh.removeFromParent()
      mesh.dispose()
      removed.add(mesh)
    }
    // Clipped capsule hedges become informal rows of the modelled shrub.
    W.traverse((o) => {
      const hedge = o as THREE.InstancedMesh
      if (!hedge.isInstancedMesh || !hedge.userData.hedge || !hedge.visible) return
      if (!bySpecies.has('shrub')) bySpecies.set('shrub', { species: 'shrub', matrices: [], positions: [], tints: [], near: [], far: [] })
      const set = bySpecies.get('shrub')!
      const axis = new THREE.Vector3()
      for (let i = 0; i < hedge.count; i++) {
        hedge.getMatrixAt(i, matrix)
        matrix.decompose(pos, quat, scale)
        axis.set(0, 0, 1).applyQuaternion(quat)
        const length = scale.z
        for (let d = -length / 2 + 0.25; d <= length / 2 - 0.25; d += 0.52 + rand() * 0.16) {
          const p = pos.clone().addScaledVector(axis, d)
          p.x += (rand() - 0.5) * 0.06
          p.z += (rand() - 0.5) * 0.06
          const h = SPECIES_HEIGHT.shrub * (0.7 + rand() * 0.25)
          set.matrices.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2), new THREE.Vector3(h, h, h)))
          set.positions.push(p)
          set.tints.push(new THREE.Color().setScalar(0.8 + rand() * 0.2))
        }
      }
      hedge.visible = false
    })
    // Procedural trunks are superseded by real branch structures.
    const trunks: THREE.Object3D[] = []
    W.traverse((o) => { if ((o as THREE.Mesh).geometry === this.w.G.trunk) trunks.push(o) })
    trunks.forEach((o) => { o.removeFromParent(); (o as THREE.InstancedMesh).dispose?.(); removed.add(o) })
    this.w.foliageBatches = []

    for (const set of bySpecies.values()) {
      const make = (parts: ModelPart[]) => parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, set.matrices.length)
        im.castShadow = true
        im.receiveShadow = true
        im.frustumCulled = false
        im.count = 0
        if (p.material === this.leafMats[p.material.name]) {
          im.customDepthMaterial = this.depthFor(p.material as THREE.MeshStandardMaterial)
          set.tints.forEach((c, i) => im.setColorAt(i, c))
        }
        W.add(im)
        return im
      })
      set.near = make(this.treeParts[set.species].near)
      set.far = make(this.treeParts[set.species].far)
      this.trees.push(set)
    }
  }

  private depthCache = new Map<THREE.Material, THREE.MeshDepthMaterial>()
  /** Shadow depth honours the leaf alpha so canopies cast dappled shadows. */
  private depthFor(mat: THREE.MeshStandardMaterial) {
    if (!this.depthCache.has(mat)) {
      this.depthCache.set(mat, keepMaterial(new THREE.MeshDepthMaterial({ map: mat.map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })))
    }
    return this.depthCache.get(mat)!
  }

  /** Distance LOD: near instances get full branching and foliage, far ones the light model. */
  private updateTreeLod(camera: THREE.Camera) {
    camera.getWorldPosition(this.camPos)
    const highQuality = this.w.qLevel >= 2
    for (const set of this.trees) {
      let n = 0, f = 0
      set.matrices.forEach((m, i) => {
        const near = highQuality && set.positions[i].distanceTo(this.camPos) < NEAR_TREE
        const targets = near ? set.near : set.far
        const slot = near ? n++ : f++
        for (const im of targets) {
          im.setMatrixAt(slot, m)
          if (im.instanceColor) im.setColorAt(slot, set.tints[i])
        }
      })
      for (const im of set.near) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true }
      for (const im of set.far) { im.count = f; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true }
    }
  }

  // ---------------------------------------------------------------- props

  /**
   * Fit model parts into the bounding box of the procedural stand-in they replace.
   * `uniform` keeps proportions (scaled by height) and aligns the base.
   */
  private fitted(model: ModelName, legacy: THREE.BufferGeometry, mode: 'box' | 'height' | 'width', node?: string) {
    const key = `${model}:${node ?? ''}:${legacy.uuid}:${mode}`
    if (this.fitCache.has(key)) return this.fitCache.get(key)!
    const parts = modelParts(this.lib.models[model], node)
    legacy.computeBoundingBox()
    const target = legacy.boundingBox!, src = partsBox(parts)
    const ts = target.getSize(new THREE.Vector3()), ss = src.getSize(new THREE.Vector3())
    const k = mode === 'box' ? new THREE.Vector3(ts.x / ss.x, ts.y / ss.y, ts.z / ss.z)
      : new THREE.Vector3().setScalar(mode === 'height' ? ts.y / ss.y : ts.x / ss.x)
    const tc = target.getCenter(new THREE.Vector3()), sc = src.getCenter(new THREE.Vector3())
    const m = new THREE.Matrix4().makeTranslation(tc.x, target.min.y, tc.z)
      .multiply(new THREE.Matrix4().makeScale(k.x, k.y, k.z))
      .multiply(new THREE.Matrix4().makeTranslation(-sc.x, -src.min.y, -sc.z))
    const out = parts.map((p) => {
      const g = p.geometry.clone().applyMatrix4(m)
      g.userData.keep = true
      keepMaterial(p.material)
      return { ...p, geometry: g }
    })
    this.fitCache.set(key, out)
    return out
  }

  /** Replace stand-in geometry everywhere it appears (instanced or not). */
  private swapProps(W: THREE.Group) {
    const PR = this.w.P
    // Models are palette-merged (one material each), so stand-in tints apply to the whole model.
    const swaps: [THREE.BufferGeometry, ModelName, 'box' | 'height' | 'width'][] = [
      [PR.pallet, 'pallet', 'box'],
      [PR.carton, 'carton', 'box'],
      [PR.container, 'container', 'box'],
      [PR.lamp, 'street_lamp', 'height'],
      [PR.bench, 'bench', 'width'],
      [PR.bollard, 'bollard', 'height'],
    ]
    const targets: THREE.Mesh[] = []
    W.traverse((o) => { if ((o as THREE.Mesh).isMesh) targets.push(o as THREE.Mesh) })
    for (const mesh of targets) {
      const swap = swaps.find(([geo]) => mesh.geometry === geo)
      if (!swap) continue
      const [, model, mode] = swap
      const parts = this.fitted(model, mesh.geometry, mode)
      const inst = mesh as THREE.InstancedMesh
      const colours = inst.isInstancedMesh ? inst.instanceColor : null
      const [first, ...rest] = parts
      mesh.geometry = first.geometry
      mesh.material = first.material
      if (inst.isInstancedMesh) {
        const siblings = rest.map((p) => {
          const s = new THREE.InstancedMesh(p.geometry, p.material, inst.count)
          s.instanceMatrix.array.set(inst.instanceMatrix.array)
          if (colours) s.instanceColor = new THREE.InstancedBufferAttribute((colours.array as Float32Array).slice(), 3)
          s.castShadow = inst.castShadow
          s.receiveShadow = true
          s.position.copy(inst.position); s.quaternion.copy(inst.quaternion); s.scale.copy(inst.scale)
          inst.parent!.add(s)
          return s
        })
        this.synced.push({ primary: inst, siblings, version: inst.instanceMatrix.version })
      } else {
        for (const p of rest) {
          const child = new THREE.Mesh(p.geometry, p.material)
          child.castShadow = mesh.castShadow
          child.receiveShadow = true
          mesh.add(child)
        }
      }
    }
  }

  /** Replace scaled-box racking with modelled upright frames and step beams. */
  private upgradeRacks() {
    const frame = modelParts(this.lib.models.rack, 'rack_frame'), beam = modelParts(this.lib.models.rack, 'rack_beam')
    ;[...frame, ...beam].forEach((p) => { p.geometry.userData.keep = true; keepMaterial(p.material) })
    for (const rack of this.w.racks) {
      rack.legacy.forEach((m) => { m.visible = false })
      const frames: THREE.Matrix4[] = [], beams: THREE.Matrix4[] = []
      for (const z of rack.rows) {
        for (const x of rack.xs) frames.push(new THREE.Matrix4().compose(new THREE.Vector3(x, rack.base, z), new THREE.Quaternion(), new THREE.Vector3().setScalar(RACK_M)))
        for (let b = 0; b < rack.xs.length - 1; b++) {
          const cx = (rack.xs[b] + rack.xs[b + 1]) / 2
          for (const y of rack.levels) for (const dz of [-0.2, 0.2]) {
            beams.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, rack.base + y + 0.006, z + dz), new THREE.Quaternion(), new THREE.Vector3().setScalar(RACK_M)))
          }
        }
      }
      for (const [parts, list] of [[frame, frames], [beam, beams]] as const) {
        for (const p of parts) {
          const im = new THREE.InstancedMesh(p.geometry, p.material, list.length)
          list.forEach((m, i) => im.setMatrixAt(i, m))
          im.castShadow = true
          im.receiveShadow = true
          rack.group.add(im)
        }
      }
    }
  }

  /** Real forklift body, mast and carriage on the existing shuttle animation. */
  private upgradeForklifts() {
    const parts = (node: string) => modelParts(this.lib.models.forklift, node).map((p) => {
      p.geometry.userData.keep = true
      keepMaterial(p.material)
      return p
    })
    const body = [...parts('forklift_body'), ...parts('forklift_mast')], carriage = parts('forklift_carriage')
    const place = (parent: THREE.Object3D, list: ModelPart[]) => {
      const holder = new THREE.Group()
      // Model faces +Z; the warehouse shuttle runs along +X.
      holder.rotation.y = Math.PI / 2
      holder.scale.setScalar(FORK_M)
      for (const p of list) {
        const m = new THREE.Mesh(p.geometry, p.material)
        m.castShadow = true
        m.receiveShadow = true
        holder.add(m)
      }
      parent.add(holder)
    }
    for (const { fk, car } of this.w.forklifts) {
      for (const child of [...fk.children]) if (child !== car) child.removeFromParent()
      for (const child of [...car.children]) {
        const mesh = child as THREE.Mesh
        if (mesh.geometry === this.w.P.forkCar) child.removeFromParent()
        // Load sits on the forks: forks run from 1.08 m to 2.23 m ahead of the mast.
        else child.position.x = 1.65 * FORK_M
      }
      place(fk, body)
      place(car, carriage)
    }
  }

  // ---------------------------------------------------------------- people

  private buildPeople(W: THREE.Group) {
    const office: ModelName[] = ['person_business_man', 'person_woman_a', 'person_casual', 'person_woman_b']
    const group = new THREE.Group()
    group.name = 'people'
    W.add(group)
    this.w.ppl.forEach((walker, i) => {
      const model: ModelName = walker.uniform ? (walker.style === 3 ? 'person_woman_b' : 'person_worker') : office[(i * 3 + walker.skinTone) % office.length]
      const gltf = this.lib.models[model]
      const root = cloneSkinned(gltf.scene)
      root.traverse((o) => {
        const m = o as THREE.SkinnedMesh
        if (m.isSkinnedMesh) {
          m.material = this.personMat
          // A contact blob grounds each person; a shadow-map pass per skinned figure costs more than it shows.
          m.castShadow = false
          m.receiveShadow = true
          m.frustumCulled = false
        }
      })
      const s = STREET_M * walker.height
      root.scale.set(s * walker.width, s, s)
      group.add(root)
      const mixer = new THREE.AnimationMixer(root)
      const clipName = walker.role === 'walk' ? 'walk' : walker.role === 'work' ? 'interact' : 'idle'
      const clip = THREE.AnimationClip.findByName(gltf.animations, clipName)
      if (clip) {
        const action = mixer.clipAction(clip)
        action.play()
        action.time = (walker.ph / (Math.PI * 2)) * clip.duration
        // Match stride to ground speed (the clip covers ~1.3 m/s).
        if (walker.role === 'walk') action.timeScale = Math.max(0.5, Math.abs(walker.s) / STREET_M / 1.3)
      }
      this.people.push({ root, mixer, walker })
    })
    this.ownsPeople = this.people.length > 0
    if (this.ownsPeople) this.w.legacyPeopleMeshes().forEach((m) => { m.visible = false })
  }

  // ---------------------------------------------------------------- vehicles

  private buildFleet(W: THREE.Group) {
    const types: ('vehicle_truck' | 'vehicle_van')[] = ['vehicle_truck', 'vehicle_van']
    for (const model of types) {
      const indices = this.w.trucks.map((_, i) => i).filter((i) => types[i % 2] === model)
      if (!indices.length) continue
      const gltf = this.lib.models[model]
      const n = indices.length
      const bodyParts = modelParts(gltf, model === 'vehicle_truck' ? 'truck_body' : 'van_body')
      const inst = (p: ModelPart, count: number) => {
        p.geometry.userData.keep = true
        keepMaterial(p.material)
        const im = new THREE.InstancedMesh(p.geometry, p.material, count)
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        im.castShadow = true
        im.receiveShadow = true
        im.frustumCulled = false
        W.add(im)
        return im
      }
      const body = bodyParts.map((p) => inst(p, n))
      const livery = inst(modelParts(gltf, 'livery')[0], n)
      livery.castShadow = false
      const wheelPart = modelParts(gltf, 'wheel')
      const wheels = inst(wheelPart[0], n * 4)
      const wheelExtras = wheelPart.slice(1).map((p) => inst(p, n * 4))
      const wheelPos = [0, 1, 2, 3].map((i) => nodePosition(gltf, `wheel_${i}`))
      const box = partsBox(bodyParts)
      const fleet: Fleet = { indices, body, livery, wheels, wheelExtras, wheelPos, radius: wheelPos[0].y, length: box.max.z - box.min.z }
      // Department livery; white and graphite cabs for a mixed fleet.
      const fleetPaint = [new THREE.Color('#FFFFFF'), new THREE.Color('#FFFFFF'), new THREE.Color('#5E6670')]
      indices.forEach((ti, k) => {
        livery.setColorAt(k, this.w.trucks[ti].rec.color.clone().lerp(new THREE.Color('#3B4249'), 0.15))
        for (const im of body) im.setColorAt(k, fleetPaint[(ti + k) % fleetPaint.length])
      })
      this.fleets.push(fleet)
    }
    this.ownsVehicles = this.fleets.length > 0
    if (this.ownsVehicles) this.w.legacyVehicleMeshes().forEach((m) => { m.visible = false })
  }

  // ---------------------------------------------------------------- quality

  /**
   * 2 (alta): full shadows. 1 (equilibrada): vehicles drop to their ground blob.
   * 0 (baja): additionally only every other person is animated and drawn.
   */
  setQuality(level: number) {
    for (const fleet of this.fleets) for (const im of [...fleet.body, ...fleet.wheelExtras, fleet.wheels]) im.castShadow = level >= 2
    this.people.forEach((p, i) => { p.root.userData.culled = level === 0 && i % 2 === 1 })
  }

  // ---------------------------------------------------------------- per frame

  tick(t: number, dt: number, peopleVisible: boolean, reduced: boolean, camera: THREE.Camera) {
    this.lodClock += dt
    if (this.lodClock > 0.35) {
      this.lodClock = 0
      this.updateTreeLod(camera)
    }
    for (const s of this.synced) {
      if (s.primary.instanceMatrix.version !== s.version) {
        s.version = s.primary.instanceMatrix.version
        for (const sib of s.siblings) { sib.instanceMatrix.array.set(s.primary.instanceMatrix.array); sib.instanceMatrix.needsUpdate = true; sib.count = s.primary.count }
      }
    }
    this.tickPeople(dt, peopleVisible, reduced)
    this.tickFleet(t, peopleVisible)
  }

  private tickPeople(dt: number, visible: boolean, reduced: boolean) {
    const contact = this.w.peopleContact
    for (let i = 0; i < this.people.length; i++) {
      const { root, mixer, walker: p } = this.people[i]
      root.visible = visible && !root.userData.culled
      if (!root.visible) continue
      if (p.role === 'walk' && !reduced) p.a += p.s * dt / p.r
      const c = p.rec?.pos
      root.position.set((c?.x || 0) + Math.cos(p.a) * p.r, ROAD_LEVEL, (c?.z || 0) + Math.sin(p.a) * p.r)
      root.rotation.y = p.role === 'work' ? -p.a - Math.PI / 2 : -p.a + (p.s > 0 ? 0 : Math.PI)
      if (!reduced) mixer.update(dt)
      this.m4.compose(this.v.set(root.position.x, ROAD_LEVEL + 0.003, root.position.z), this.q.identity(), this.s.set(0.16, 1, 0.11))
      contact.setMatrixAt(i, this.m4)
    }
    contact.visible = visible
    contact.instanceMatrix.needsUpdate = true
  }

  private tickFleet(t: number, visible: boolean) {
    const shade = this.w.truckShade
    for (const fleet of this.fleets) {
      const extras = fleet.wheelExtras
      for (const im of [...fleet.body, fleet.livery, fleet.wheels, ...extras]) im.visible = visible
      if (!visible) continue
      fleet.indices.forEach((ti, k) => {
        const truck = this.w.trucks[ti]
        const road = truck.rec.road
        const dist = t * truck.sp + truck.off
        const pose = servicePose(dist, road.from.distanceTo(road.to))
        const cos = Math.cos(road.rot), sin = Math.sin(road.rot)
        const yaw = road.rot + pose.yaw
        this.m4.compose(
          this.v.set(road.from.x + cos * pose.x + sin * pose.z, ROAD_LEVEL, road.from.z - sin * pose.x + cos * pose.z),
          this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
          this.s.setScalar(STREET_M),
        )
        for (const im of fleet.body) im.setMatrixAt(k, this.m4)
        fleet.livery.setMatrixAt(k, this.m4)
        // Wheels roll by distance travelled. Left wheels are mirrored about Y; the spin is
        // applied afterwards in the vehicle frame, so both sides turn the same way.
        const spin = dist / (fleet.radius * STREET_M)
        fleet.wheelPos.forEach((wp, w) => {
          const left = wp.x < 0
          this.m4b.compose(wp, this.q.setFromEuler(this.e.set(spin, left ? Math.PI : 0, 0, 'XYZ')), this.s.set(1, 1, 1))
          const slot = k * 4 + w
          const m = this.m4b.premultiply(this.m4)
          fleet.wheels.setMatrixAt(slot, m)
          for (const im of extras) im.setMatrixAt(slot, m)
        })
        this.m4b.compose(this.v.set(this.m4.elements[12], ROAD_LEVEL + 0.003, this.m4.elements[14]), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), this.s.set(0.7, 1, fleet.length * STREET_M * 1.05))
        shade.setMatrixAt(ti, this.m4b)
      })
      for (const im of [...fleet.body, fleet.livery, fleet.wheels, ...extras]) {
        im.instanceMatrix.needsUpdate = true
        if (im.instanceColor) im.instanceColor.needsUpdate = true
      }
    }
    shade.visible = visible
    shade.instanceMatrix.needsUpdate = true
  }

  // ---------------------------------------------------------------- theme

  applyTheme(theme: Theme, env: number) {
    const dark = theme === 'dark'
    for (const m of Object.values(this.leafMats)) {
      m.color.set(dark ? '#9AA992' : '#F2F5EA')
      m.envMapIntensity = env * 0.5
    }
    for (const m of Object.values(this.barkMats)) {
      m.color.set(dark ? '#8C8378' : '#E6DED4')
      m.envMapIntensity = env * 0.4
    }
    this.personMat.color.set(dark ? '#D4D8DE' : '#FFFFFF')
    this.personMat.envMapIntensity = env * 0.5
    // Modelled assets: albedo follows the theme (night scenes must not bloom white
    // vehicles); lamps and vehicle lights get a soft glow at night only.
    for (const m of assetMaterials) {
      if (m === this.personMat || Object.values(this.leafMats).includes(m) || Object.values(this.barkMats).includes(m)) continue
      m.userData.baseColor ??= m.color.clone()
      m.color.copy(m.userData.baseColor).multiplyScalar(dark ? 0.58 : 1)
      const lit = m.emissive.r + m.emissive.g + m.emissive.b > 0
      if (lit) m.emissiveIntensity = dark ? 0.35 : 0.06
      m.envMapIntensity = env * (m.metalness > 0.5 ? 1.6 : 0.9)
    }
  }
}
