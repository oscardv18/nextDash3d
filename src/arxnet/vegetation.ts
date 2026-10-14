import * as THREE from 'three'
import { hash } from './data'

export interface FoliageBatch { mesh: THREE.InstancedMesh; tones: Float32Array }

/** Consolidate static foliage globally: six tree species, one cypress, one shrub batch. */
export function batchVegetation(root: THREE.Group, geometries: Record<string, THREE.BufferGeometry>, material: THREE.Material): FoliageBatch[] {
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert()
  const sources: THREE.InstancedMesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.InstancedMesh
    if (mesh.isInstancedMesh && mesh.geometry.userData.foliage) sources.push(mesh)
  })
  const buckets = new Map<string, { matrices: THREE.Matrix4[]; owners: string[]; tones: number[] }>()
  const local = new THREE.Matrix4(), world = new THREE.Matrix4()
  for (const source of sources) {
    let ancestor: THREE.Object3D | null = source
    let owner = ''
    while (ancestor && !owner) { owner = ancestor.userData.dept || ''; ancestor = ancestor.parent }
    const kind = source.geometry.userData.foliageKind as string
    for (let i = 0; i < source.count; i++) {
      source.getMatrixAt(i, local)
      world.multiplyMatrices(source.matrixWorld, local).premultiply(inverse)
      const seed = hash(world.elements[12].toFixed(3) + ':' + world.elements[14].toFixed(3))
      // Small interior specimens retain the compact form that fits their enclosure.
      const scale = Math.hypot(world.elements[0], world.elements[1], world.elements[2])
      // Avenues pass an explicit species per instance so a street reads as one planting.
      const forced = source.userData.species as number[] | undefined
      const variant = kind !== 'tree' ? 0 : forced ? forced[i] : scale >= .65 ? seed % 6 : 5
      const key = kind === 'tree' ? `tree${variant}` : kind
      if (!buckets.has(key)) buckets.set(key, { matrices: [], owners: [], tones: [] })
      const bucket = buckets.get(key)!
      const variation = .96 + (seed % 9) / 100
      // Keep root positions; only change the foliage silhouette and scale.
      world.scale(new THREE.Vector3(variation, 1 + (seed % 5 - 2) / 100, variation))
      bucket.matrices.push(world.clone())
      bucket.owners.push(owner)
      bucket.tones.push((seed % 101) / 100)
    }
    source.removeFromParent()
    source.dispose()
  }
  return [...buckets].map(([key, bucket]) => {
    const mesh = new THREE.InstancedMesh(geometries[key], material, bucket.matrices.length)
    bucket.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
    mesh.userData.instanceDepts = bucket.owners
    mesh.userData.foliageBatch = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
    return { mesh, tones: new Float32Array(bucket.tones) }
  })
}
