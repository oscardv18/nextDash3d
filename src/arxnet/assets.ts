import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * Optimised world assets (GLB + small WebP textures) served from /public/assets/world.
 * Built by scripts/assets/* — see docs/ASSETS.md for sources and licences.
 */
export const MODEL_NAMES = [
  'tree_oak', 'tree_ash', 'tree_aspen', 'tree_pine', 'tree_street', 'tree_shrub',
  'vehicle_truck', 'vehicle_van', 'forklift',
  'pallet', 'carton', 'container', 'rack', 'street_lamp', 'bench', 'bollard',
  'person_business_man', 'person_worker', 'person_casual', 'person_woman_a', 'person_woman_b',
] as const
export type ModelName = (typeof MODEL_NAMES)[number]

export const TEXTURE_NAMES = [
  'leaf_oak', 'leaf_ash', 'leaf_aspen', 'leaf_pine',
  'bark_oak_diff', 'bark_oak_nor', 'bark_plane_diff', 'bark_plane_nor',
  'asphalt_diff', 'asphalt_nor', 'asphalt_rough', 'pavers_diff', 'pavers_nor', 'pavers_rough',
  'concrete_diff', 'concrete_nor', 'concrete_rough',
] as const
export type TextureName = (typeof TEXTURE_NAMES)[number]

export interface AssetLibrary {
  models: Record<ModelName, GLTF>
  textures: Record<TextureName, THREE.Texture>
}

/** A mesh part of a model, flattened into model space. */
export interface ModelPart {
  name: string
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

const base = () => `${import.meta.env?.BASE_URL ?? '/'}assets/world/`

let pending: Promise<AssetLibrary> | null = null

/** Loads every model and texture in parallel (once per page). Rejects if any file fails. */
export function loadAssets(): Promise<AssetLibrary> {
  pending ??= fetchAssets().catch((error) => {
    pending = null
    throw error
  })
  return pending
}

async function fetchAssets(): Promise<AssetLibrary> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const texLoader = new THREE.TextureLoader()
  const root = base()
  const models = await Promise.all(MODEL_NAMES.map((name) => loader.loadAsync(`${root}${name}.glb`)))
  const textures = await Promise.all(TEXTURE_NAMES.map(async (name) => {
    const t = await texLoader.loadAsync(`${root}textures/${name}.webp`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 4
    if (name.endsWith('_diff') || name.startsWith('leaf_')) t.colorSpace = THREE.SRGBColorSpace
    return t
  }))
  return {
    models: Object.fromEntries(MODEL_NAMES.map((n, i) => [n, models[i]])) as AssetLibrary['models'],
    textures: Object.fromEntries(TEXTURE_NAMES.map((n, i) => [n, textures[i]])) as AssetLibrary['textures'],
  }
}

/**
 * Mesh parts under `node` (or the whole scene) with transforms baked into cloned
 * geometry, so each part can drive its own InstancedMesh.
 */
export function modelParts(gltf: GLTF, nodeName?: string): ModelPart[] {
  const root = nodeName ? gltf.scene.getObjectByName(nodeName) : gltf.scene
  if (!root) throw new Error(`asset node not found: ${nodeName}`)
  root.updateWorldMatrix(true, true)
  // Express parts in the frame the node is placed in. The node's own transform must be
  // kept: KHR_mesh_quantization stores the de-quantisation scale/offset there.
  const inverse = root.parent ? root.parent.matrixWorld.clone().invert() : new THREE.Matrix4()
  const parts: ModelPart[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
    const g = dequantize(mesh.geometry)
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    parts.push({ name: mesh.name, geometry: g, material: mesh.material as THREE.Material })
  })
  return parts
}

/** Float copy of a (possibly quantised, normalised-integer) geometry. */
function dequantize(source: THREE.BufferGeometry) {
  const g = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as THREE.BufferAttribute
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c)
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
  }
  if (source.index) g.setIndex(source.index.clone())
  g.groups = source.groups.map((x) => ({ ...x }))
  return g
}

/** World position of a named empty, in model space. */
export function nodePosition(gltf: GLTF, name: string) {
  const node = gltf.scene.getObjectByName(name)
  if (!node) throw new Error(`asset node not found: ${name}`)
  gltf.scene.updateWorldMatrix(true, true)
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld)
}

/** Union bounding box of a set of parts. */
export function partsBox(parts: ModelPart[]) {
  const box = new THREE.Box3()
  for (const p of parts) box.union(p.geometry.boundingBox!)
  return box
}
