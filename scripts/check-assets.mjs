import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, statSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { registerSourceLoader, createCpuWorld } from './world-harness.mjs'
registerSourceLoader()
const { ArxWorld } = await import('../src/arxnet/world.ts')
const { PRESETS, buildDepts } = await import('../src/arxnet/data.ts')
const { MODEL_NAMES, TEXTURE_NAMES } = await import('../src/arxnet/assets.ts')

const dir = new URL('../public/assets/world/', import.meta.url)
// Node has no image decoder: embedded palette textures become placeholders; geometry,
// structure and runtime behaviour are what these tests cover.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
loader.register(() => ({ name: 'test-texture-stub', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
const models = {}
for (const name of MODEL_NAMES) {
  const buf = readFileSync(new URL(`${name}.glb`, dir))
  models[name] = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
}

const tris = (root) => {
  let n = 0
  root.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 })
  return n
}

test('every model and texture ships within the web budget', () => {
  let total = 0
  for (const name of MODEL_NAMES) {
    const size = statSync(new URL(`${name}.glb`, dir)).size
    assert.ok(size < 300 * 1024, `${name} is ${size} bytes`)
    total += size
  }
  for (const name of TEXTURE_NAMES) {
    const size = statSync(new URL(`textures/${name}.webp`, dir)).size
    assert.ok(size < 128 * 1024, `${name} is ${size} bytes`)
    total += size
  }
  assert.ok(total < 3.5 * 1024 * 1024, `total ${total} bytes`)
})

test('trees ship near and far levels of detail at unit height', () => {
  for (const name of MODEL_NAMES.filter((n) => n.startsWith('tree_'))) {
    const scene = models[name].scene
    const [bark, leaves, bark1, leaves1] = ['bark', 'leaves', 'bark_lod1', 'leaves_lod1'].map((n) => scene.getObjectByName(n))
    assert.ok(bark && leaves && bark1 && leaves1, name)
    assert.ok(tris(bark1) + tris(leaves1) < tris(bark) + tris(leaves), `${name} far LOD is lighter`)
    assert.ok(tris(bark) + tris(leaves) < 10000, `${name} near LOD budget`)
    const box = new THREE.Box3().setFromObject(scene)
    assert.ok(Math.abs(box.min.y) < 0.03 && box.max.y > 0.9 && box.max.y < 1.12, `${name} unit height`)
  }
})

test('people are single skinned meshes with walk, idle and interact clips', () => {
  for (const name of MODEL_NAMES.filter((n) => n.startsWith('person_'))) {
    const gltf = models[name]
    let skinned = 0
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++ })
    assert.equal(skinned, 1, name)
    assert.deepEqual(gltf.animations.map((a) => a.name).sort(), ['idle', 'interact', 'walk'])
    assert.ok(tris(gltf.scene) < 4000, `${name} crowd budget`)
  }
})

test('vehicles expose wheel mounts, a livery panel and one palette material', () => {
  for (const name of ['vehicle_truck', 'vehicle_van']) {
    const scene = models[name].scene
    for (let i = 0; i < 4; i++) assert.ok(scene.getObjectByName(`wheel_${i}`), `${name} wheel_${i}`)
    assert.ok(scene.getObjectByName('livery') && scene.getObjectByName('wheel'))
    const materials = new Set()
    scene.traverse((o) => { if (o.isMesh) materials.add(o.material.name) })
    assert.equal(materials.size, 1, `${name} materials ${[...materials]}`)
  }
  for (const n of ['forklift_body', 'forklift_mast', 'forklift_carriage']) assert.ok(models.forklift.scene.getObjectByName(n), n)
})

// ---------------------------------------------------------------- asset layer on the CPU world
const blank = () => { const t = new THREE.Texture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t }
const lib = { models, textures: Object.fromEntries(TEXTURE_NAMES.map((n) => [n, blank()])) }
const { world, view } = createCpuWorld(ArxWorld)
world.build(PRESETS[0], buildDepts(PRESETS[0]), 'dark')
const foliageInstances = world.foliageBatches.reduce((n, { mesh }) => n + mesh.count, 0)
world.setAssets(lib)
const layer = world.assets
function frame(time) {
  world.time = time
  world.last = 900 // 0.1 s step, so walkers advance
  world.tick(1000)
  world.world.updateMatrixWorld(true)
}

test('every procedural tree is replaced by a modelled one, instance for instance', () => {
  assert.equal(world.foliageBatches.length, 0)
  const replaced = layer.trees.reduce((n, set) => n + set.matrices.length, 0)
  const hedgeShrubs = layer.trees.find((t) => t.species === 'shrub').matrices.length
  // Every procedural canopy is replaced; hedges add shrub rows on top.
  assert.ok(replaced >= foliageInstances && replaced - foliageInstances <= hedgeShrubs)
  world.world.traverse((o) => { if (o.userData.hedge) assert.equal(o.visible, false) })
  let trunks = 0
  world.world.traverse((o) => { if (o.geometry === world.G.trunk) trunks++ })
  assert.equal(trunks, 0)
})

test('the layer owns people and vehicles and hides their stand-ins', () => {
  assert.equal(layer.ownsPeople, true)
  assert.equal(layer.ownsVehicles, true)
  assert.equal(layer.people.length, world.ppl.length)
  frame(1)
  for (const mesh of [...world.legacyPeopleMeshes(), ...world.legacyVehicleMeshes()]) assert.equal(mesh.visible, false)
})

test('animated assets stay finite; wheels roll and walkers move', () => {
  const wheels = layer.fleets[0].wheels
  frame(3)
  const before = Array.from(wheels.instanceMatrix.array)
  const walker = layer.people.find((p) => p.walker.role === 'walk')
  const start = walker.root.position.clone()
  frame(5)
  assert.notDeepEqual(Array.from(wheels.instanceMatrix.array), before)
  assert.ok(walker.root.position.distanceTo(start) > 1e-3)
  world.world.traverse((o) => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite), o.name)
    if (o.isInstancedMesh) assert.ok(Array.from(o.instanceMatrix.array).every(Number.isFinite), o.name)
  })
})

test('warehouse equipment is modelled: forklifts and racking', () => {
  for (const { fk, car } of world.forklifts) {
    assert.ok(fk.children.some((c) => c.isGroup && c !== car), 'forklift body holder')
    assert.ok(car.children.some((c) => c.isGroup), 'carriage holder')
  }
  for (const rack of world.racks) assert.ok(rack.legacy.every((m) => !m.visible))
})

test('switching organisation rebuilds and re-attaches the asset layer', () => {
  world.build(PRESETS[1], buildDepts(PRESETS[1]), 'light')
  assert.equal(world.foliageBatches.length, 0)
  assert.equal(layer.people.length, world.ppl.length)
  assert.equal(layer.ownsVehicles, true)
  view.people = false
  frame(2)
  assert.ok(layer.people.every((p) => !p.root.visible))
  view.people = true
})

test('low quality culls half the crowd and drops vehicle shadow maps', () => {
  layer.setQuality(0)
  frame(4)
  assert.equal(layer.people.filter((p) => p.root.visible).length, Math.ceil(layer.people.length / 2))
  assert.ok(layer.fleets.every((f) => f.body.every((m) => !m.castShadow)))
  layer.setQuality(2)
  assert.ok(layer.fleets.every((f) => f.body.every((m) => m.castShadow)))
})
