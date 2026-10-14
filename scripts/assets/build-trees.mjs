// Bake tree species to GLB using the vendored ez-tree generator (MIT).
// Each species has two levels of detail in one file:
//   bark / leaves            – near view
//   bark_lod1 / leaves_lod1  – far view (fewer branch levels, sections and leaves)
// Trees are normalised to unit height with the trunk base at the origin.
// Leaf cards get a baked colour: darker inside and low in the crown.
//
//   node scripts/assets/build-trees.mjs <out_dir>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { Document, NodeIO } from '@gltf-transform/core'
import { Tree } from './vendor/ez-tree/tree.js'

const out = process.argv[2]
const preset = (name) => JSON.parse(readFileSync(new URL(`./vendor/ez-tree/presets/${name}.json`, import.meta.url)))

// Species: preset, seed, leaf texture, bark texture and detail overrides.
const SPECIES = {
  oak: { preset: 'oak_medium', seed: 41, leaf: 'oak', bark: 'oak', leaves: 0.2, size: 1.9 },
  ash: { preset: 'ash_medium', seed: 7, leaf: 'ash', bark: 'oak', leaves: 0.2, size: 1.9 },
  aspen: { preset: 'aspen_small', seed: 23, leaf: 'aspen', bark: 'plane', leaves: 0.5, size: 1.5 },
  pine: { preset: 'pine_medium', seed: 5, leaf: 'pine', bark: 'oak', leaves: 0.3, size: 1.7, farLeaves: 0.4 },
  street: { preset: 'ash_small', seed: 91, leaf: 'oak', bark: 'plane', leaves: 0.3, size: 1.7 },
  shrub: { preset: 'bush_1', seed: 3, leaf: 'aspen', bark: 'oak', leaves: 0.5, size: 1.0, farLeaves: 0.3 },
}

function generate(spec, lod) {
  const tree = new Tree()
  tree.options.copy(preset(spec.preset))
  const o = tree.options
  o.seed = spec.seed
  o.bark.textured = false
  // Web budget: fewer radial segments and sections; LOD1 drops the finest branch level.
  for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.min(o.branch.segments[k], [7, 5, 3, 3][k] ?? 3) - (lod ? 1 : 0))
  for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * (lod ? 0.45 : 0.7)))
  if (lod && o.branch.levels > 2) o.branch.levels -= 1
  // Each card carries a whole twig of leaves, so far fewer, larger cards are needed.
  o.leaves.count = Math.max(1, Math.round(o.leaves.count * spec.leaves * (lod ? spec.farLeaves ?? 0.65 : 1)))
  o.leaves.size *= spec.size * (lod ? 1.3 : 1)
  tree.generate()
  return { bark: tree.branchesMesh.geometry, leaves: tree.leavesMesh.geometry }
}

/** Darker inside and at the base of the crown; slight random variation per card. */
function bakeLeafColour(geometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const centre = box.getCenter(new THREE.Vector3())
  const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 || 1
  const pos = geometry.attributes.position
  const colours = new Float32Array(pos.count * 3)
  let seed = 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let card = 1
  for (let i = 0; i < pos.count; i++) {
    if (i % 4 === 0) card = 0.86 + rand() * 0.22
    const h = (pos.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y)
    const r = Math.hypot(pos.getX(i) - centre.x, pos.getZ(i) - centre.z) / radius
    const v = Math.min(1.05, (0.5 + 0.35 * h + 0.25 * r) * card)
    colours.set([v, v, v * 0.97], i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  // Foliage normals point away from the crown centre, so the canopy shades as a volume
  // instead of as many flat, randomly oriented cards.
  const normal = geometry.attributes.normal
  const crown = new THREE.Vector3(centre.x, box.min.y + (box.max.y - box.min.y) * 0.55, centre.z)
  const n = new THREE.Vector3(), radial = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    radial.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(crown).normalize()
    n.fromBufferAttribute(normal, i).lerp(radial, 0.75).normalize()
    normal.setXYZ(i, n.x, n.y, n.z)
  }
}

function addMesh(doc, buffer, name, geometry, material) {
  const prim = doc.createPrimitive().setMaterial(material)
  const attr = (key, a, type) => prim.setAttribute(key, doc.createAccessor().setArray(new Float32Array(a.array)).setType(type).setBuffer(buffer))
  attr('POSITION', geometry.attributes.position, 'VEC3')
  attr('NORMAL', geometry.attributes.normal, 'VEC3')
  attr('TEXCOORD_0', geometry.attributes.uv, 'VEC2')
  if (geometry.attributes.color) attr('COLOR_0', geometry.attributes.color, 'VEC3')
  const index = geometry.index.array
  prim.setIndices(doc.createAccessor().setArray(index.length > 65535 || Math.max(...index) > 65535 ? new Uint32Array(index) : new Uint16Array(index)).setType('SCALAR').setBuffer(buffer))
  const mesh = doc.createMesh(name).addPrimitive(prim)
  return doc.createNode(name).setMesh(mesh)
}

const io = new NodeIO()
for (const [name, spec] of Object.entries(SPECIES)) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene(name)
  const bark = doc.createMaterial(`bark_${spec.bark}`).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.95)
  const leaf = doc.createMaterial(`leaf_${spec.leaf}`).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true)
  let scale = 1, report = []
  for (const lod of [0, 1]) {
    const g = generate(spec, lod)
    if (lod === 0) {
      const box = new THREE.Box3().setFromBufferAttribute(g.bark.attributes.position).union(new THREE.Box3().setFromBufferAttribute(g.leaves.attributes.position))
      scale = 1 / (box.max.y - box.min.y)
    }
    for (const geo of [g.bark, g.leaves]) geo.scale(scale, scale, scale)
    // Shrub cards can hang below the stem base: lift so nothing sinks into the ground.
    const minY = Math.min(new THREE.Box3().setFromBufferAttribute(g.bark.attributes.position).min.y, new THREE.Box3().setFromBufferAttribute(g.leaves.attributes.position).min.y)
    if (minY < 0) for (const geo of [g.bark, g.leaves]) geo.translate(0, -minY, 0)
    bakeLeafColour(g.leaves)
    const suffix = lod ? '_lod1' : ''
    scene.addChild(addMesh(doc, buffer, 'bark' + suffix, g.bark, bark))
    scene.addChild(addMesh(doc, buffer, 'leaves' + suffix, g.leaves, leaf))
    report.push(`lod${lod}: ${g.bark.index.count / 3 + g.leaves.index.count / 3} tris (${g.leaves.index.count / 6 | 0} leaf cards)`)
  }
  await io.write(join(out, `tree_${name}.glb`), doc)
  console.log(name, report.join(' | '))
}
