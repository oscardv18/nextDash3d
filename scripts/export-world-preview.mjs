import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import * as THREE from 'three'
import { registerSourceLoader, createCpuWorld, restoreBaseline } from './world-harness.mjs'
registerSourceLoader()
const objectsBefore = process.argv.includes('--objects-before')
const before = process.argv.includes('--before') || objectsBefore
if (before) restoreBaseline(objectsBefore ? 'object-pass-baseline' : 'world-baseline')
const base = before ? 'file:///tmp/arxnet-premium-before/' : new URL('../src/arxnet/', import.meta.url).href
const { ArxWorld } = await import(`${base}world.ts`)
const { PRESETS, buildDepts } = await import(`${base}data.ts`)
const { world, view } = createCpuWorld(ArxWorld)
world.build(PRESETS[0], buildDepts(PRESETS[0]), 'dark')
world.time = 10
world.tick(1000)
world.world.updateMatrixWorld(true)
const geometries = [], ids = new Map(), meshes = []
function geo(g) {
 if (ids.has(g.uuid)) return ids.get(g.uuid)
 const id = geometries.length
 const rounded = (array) => Array.from(array, (v) => Math.round(v * 100000) / 100000)
 geometries.push({ position: rounded(g.attributes.position.array), normal: rounded(g.attributes.normal.array), color: g.attributes.color ? rounded(g.attributes.color.array) : null, index: g.index ? Array.from(g.index.array) : null })
 ids.set(g.uuid, id)
 return id
}
const instance = new THREE.Matrix4(), transform = new THREE.Matrix4(), tint = new THREE.Color()
function exportMesh(o, materials) {
 if (!o.isMesh || Array.isArray(o.material) || !o.visible) return
 const mat = o.material
 if (mat.opacity < 0.06 || mat === world.M.shade || mat === world.M.contact || mat === world.M.beam || o.parent?.visible === false) return
 const transforms = [], colors = []
 for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) {
  if (o.isInstancedMesh) { o.getMatrixAt(i, instance); transform.multiplyMatrices(o.matrixWorld, instance) } else transform.copy(o.matrixWorld)
  if (Math.abs(transform.determinant()) < 1e-8) continue
  transforms.push(transform.toArray())
  tint.set('#ffffff')
  if (o.isInstancedMesh && o.instanceColor) o.getColorAt(i, tint)
  colors.push(tint.toArray())
 }
 meshes.push({ geometry: geo(o.geometry), matrix: transforms, tint: colors, color: materials[mat.uuid] ?? mat.color.toArray(), opacity: mat.opacity, emissive: mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity).toArray() ?? [0,0,0] })
}
const themes = {}
for (const theme of ['dark','light']) {
 view.theme = theme
 world.applyTheme(theme)
 const materials = {}
 world.world.traverse((o) => { if (o.material && !Array.isArray(o.material)) materials[o.material.uuid] = o.material.color.toArray() })
 meshes.length = 0
 world.world.traverse((o) => exportMesh(o, materials))
 themes[theme] = { background: world.scene.background.toArray(), meshes: structuredClone(meshes) }
}
// Isolated asset comparisons use the same real source geometries.
const assets = {}
for (const key of ['cab','cabStatic','cabGlass','trailer','trailerStatic','person','personBody','personSkin','personBlazer','personVest','helmet','arm','hand','leg','wheel','tree','tree0','tree1','tree2','tree3','tree4','tree5','personCoat','personCardigan','personCoveralls','forearm','shin','forkMast','forkCar','bench','lamp','bollard','wayfinding','pallet','carton','server','forkBody']) {
 const geometry = world.P[key]
 if (geometry) assets[key] = geo(geometry)
}
assets.trunk = geo(world.G.trunk)
assets.plainBox = geo(world.G.box)
const data = { version: before ? 'before' : 'after', note: 'CPU geometry preview; approximate lighting, no texture maps, no WebGL or shell screenshot', geometries, themes, assets }
const output = `/tmp/arxnet-${before ? 'before' : 'after'}-preview.json.gz`
writeFileSync(output, gzipSync(JSON.stringify(data)))
process.stdout.write(output + '\n')
