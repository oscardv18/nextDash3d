import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Volumetric stylised canopies.
 *
 * Each crown is a cluster of smooth, noise-displaced clumps merged into one mesh.
 * Normals are bent toward the crown's centre-out direction so light wraps the whole
 * canopy like a single soft volume (no faceted low-poly look), and vertex colours
 * bake self-shadowing: darker underneath and inside, brighter on the sunlit crown.
 * Species are tinted relative to white; the per-instance colour sets the final hue.
 */

/** [x, y, z, radius, verticalSquash] in a unit tree whose trunk top sits near y = 1. */
type Clump = [number, number, number, number, number]
type Kind = 'tree' | 'cypress' | 'shrub'

export const TREE_SPECIES = 6
/** Street-tree species used for avenues (no conifers or airy birches in a row). */
export const AVENUE_SPECIES = [1, 3, 5, 0]

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Cheap smooth pseudo-noise, roughly in [-1, 1]. */
const lump = (x: number, y: number, z: number) =>
  0.55 * Math.sin(x * 1.9 + y * 3.1 + z * 2.3) * Math.sin(x * 3.7 - y * 1.3 + z * 2.9) +
  0.30 * Math.sin(x * 7.1 + y * 5.3 - z * 6.7) +
  0.15 * Math.sin(-x * 13.7 + y * 11.1 + z * 12.9)

function speciesClumps(kind: Kind, variant: number, rand: () => number): { clumps: Clump[]; tint: [number, number, number]; amp: number } {
  const c: Clump[] = []
  const ring = (n: number, radius: number, y: number, r: number, sy: number, jitter = 0.25, phase = rand() * 6) => {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2 + (rand() - 0.5) * jitter
      const rr = radius * (0.85 + rand() * 0.3)
      c.push([Math.cos(a) * rr, y + (rand() - 0.5) * 0.1, Math.sin(a) * rr, r * (0.85 + rand() * 0.3), sy])
    }
  }
  if (kind === 'shrub') {
    c.push([0, 0.17, 0, 0.2, 0.78])
    ring(5, 0.17, 0.13, 0.15, 0.75)
    return { clumps: c, tint: [0.96, 1, 0.92], amp: 0.14 }
  }
  if (kind === 'cypress') {
    // Flame-shaped column: stacked clumps tapering to a soft point.
    for (let i = 0; i < 7; i++) {
      const t = i / 6
      const r = 0.24 * (1 - t * 0.72)
      c.push([(rand() - 0.5) * 0.05, 0.5 + t * 1.38, (rand() - 0.5) * 0.05, r, 1.35])
      if (i < 5) ring(3, r * 0.45, 0.5 + t * 1.38, r * 0.72, 1.2, 0.4)
    }
    return { clumps: c, tint: [0.78, 0.9, 0.86], amp: 0.12 }
  }
  switch (variant % TREE_SPECIES) {
    case 0: // Broad oak: wide dome built from many overlapping lobes.
      c.push([0, 1.2, 0, 0.34, 0.85])
      ring(8, 0.38, 1.04, 0.23, 0.8)
      ring(6, 0.26, 1.3, 0.22, 0.82)
      ring(3, 0.1, 1.46, 0.2, 0.85)
      return { clumps: c, tint: [0.95, 1, 0.9], amp: 0.13 }
    case 1: // Linden: tall upright oval, dense.
      for (let i = 0; i < 4; i++) c.push([0, 0.98 + i * 0.2, 0, 0.3 - i * 0.03, 0.95])
      ring(6, 0.22, 1.02, 0.21, 0.9)
      ring(6, 0.2, 1.3, 0.2, 0.9)
      ring(4, 0.13, 1.55, 0.17, 0.9)
      return { clumps: c, tint: [0.92, 1, 0.88], amp: 0.11 }
    case 2: // Pine: tiered, slightly drooping layers with a narrow spire.
      for (let i = 0; i < 6; i++) {
        const t = i / 5
        const spread = 0.46 * (1 - t * 0.78)
        c.push([0, 0.62 + i * 0.24, 0, spread * 0.6, 0.5])
        ring(6, spread * 0.72, 0.6 + i * 0.24, spread * 0.38, 0.45, 0.5)
      }
      c.push([0, 2.02, 0, 0.09, 1.6])
      return { clumps: c, tint: [0.72, 0.86, 0.84], amp: 0.18 }
    case 3: // Plane tree: broad, irregular and asymmetric.
      for (let i = 0; i < 14; i++) {
        const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 0.46
        c.push([Math.cos(a) * rr + 0.06, 1.1 + (rand() - 0.35) * 0.36 + (0.46 - rr) * 0.25, Math.sin(a) * rr * 0.82, 0.19 + rand() * 0.1, 0.82])
      }
      return { clumps: c, tint: [1, 1.02, 0.86], amp: 0.14 }
    case 4: // Birch: light, airy and open; gaps read as an open canopy.
      for (let i = 0; i < 11; i++) {
        const a = rand() * Math.PI * 2, rr = 0.08 + rand() * 0.28
        c.push([Math.cos(a) * rr, 0.98 + rand() * 0.66, Math.sin(a) * rr, 0.12 + rand() * 0.07, 1.05])
      }
      return { clumps: c, tint: [1.1, 1.08, 0.78], amp: 0.18 }
    default: // Ornamental: compact, rounded street tree.
      c.push([0, 1.16, 0, 0.3, 0.92])
      ring(7, 0.24, 1.08, 0.2, 0.9)
      ring(5, 0.17, 1.32, 0.18, 0.9)
      return { clumps: c, tint: [0.98, 1, 0.94], amp: 0.1 }
  }
}

/**
 * Builds one canopy mesh. `low` lowers the clump tessellation for weak GPUs
 * (silhouette is kept; only smoothness changes).
 */
export function crownGeometry(kind: Kind, low = false, variant = 0) {
  const rand = seeded(911 + variant * 7919 + (kind === 'shrub' ? 101 : kind === 'cypress' ? 503 : 0))
  const { clumps, tint, amp } = speciesClumps(kind, variant, rand)
  const [ws, hs] = low ? [7, 5] : [10, 7]
  let yMin = Infinity, yMax = -Infinity
  const centre = new THREE.Vector3()
  for (const [x, y, z, r] of clumps) {
    yMin = Math.min(yMin, y - r)
    yMax = Math.max(yMax, y + r)
    centre.add(new THREE.Vector3(x, y, z))
  }
  centre.divideScalar(clumps.length)
  const spread = Math.max(...clumps.map(([x, , z, r]) => Math.hypot(x, z) + r), 0.2)
  const offset = rand() * 20
  const p = new THREE.Vector3(), n = new THREE.Vector3(), radial = new THREE.Vector3()
  const parts = clumps.map(([x, y, z, r, sy]) => {
    const g = new THREE.SphereGeometry(r, ws, hs)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      const d = p.clone().normalize()
      const k = 1 + amp * lump(d.x * 2.2 + x * 3 + offset, d.y * 2.2 + y * 3, d.z * 2.2 + z * 3)
      pos.setXYZ(i, d.x * r * k + x, d.y * r * k * sy + y, d.z * r * k + z)
    }
    g.computeVertexNormals()
    const nor = g.attributes.normal
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(nor, i)
      radial.copy(p).sub(centre)
      radial.y *= 0.7
      radial.normalize()
      // Bend normals outward from the crown so the canopy shades as one soft mass.
      n.lerp(radial, 0.72).normalize()
      nor.setXYZ(i, n.x, n.y, n.z)
      const h = (p.y - yMin) / Math.max(0.001, yMax - yMin)
      const outer = Math.min(1, Math.hypot(p.x - centre.x, p.z - centre.z) / spread)
      const facing = Math.max(0, radial.dot(n))
      const ao = Math.min(1, 0.34 + 0.4 * h + 0.14 * outer + 0.1 * facing)
      const sun = Math.max(0, n.y) * 0.06 + Math.max(0, n.x * 0.5 + n.z * 0.3) * 0.04
      colors[i * 3] = (ao + sun) * tint[0]
      colors[i * 3 + 1] = (ao + sun) * tint[1]
      colors[i * 3 + 2] = (ao + sun * 0.6) * tint[2]
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  })
  const g = mergeGeometries(parts)!
  parts.forEach((part) => part.dispose())
  g.computeBoundingSphere()
  g.userData.keep = true
  g.userData.foliage = kind === 'tree' ? `tree${variant}` : kind
  g.userData.foliageKind = kind
  return g
}

/** Irregular, slightly domed meadow patch used to ground groves into the terrain. */
export function meadowGeometry(seed: number) {
  const rand = seeded(seed)
  const g = new THREE.CircleGeometry(1, 28, 0, Math.PI * 2)
  const pos = g.attributes.position
  const o = rand() * 10
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    const a = Math.atan2(y, x)
    const k = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(a * 3 + o)) + 0.1 * Math.sin(a * 7 + o * 2)
    pos.setXY(i, x * k, y * k)
  }
  g.rotateX(-Math.PI / 2)
  g.computeVertexNormals()
  g.userData.keep = true
  return g
}
