import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { registerSourceLoader, createCpuWorld, sceneMetrics } from './world-harness.mjs'
registerSourceLoader()
const { ArxWorld } = await import('../src/arxnet/world.ts')
const { PRESETS, buildDepts, SCENE } = await import('../src/arxnet/data.ts')
const { servicePose, ROAD_LEVEL, coloredGeometry, entranceRamp } = await import('../src/arxnet/premium.ts')

const finite = (array) => Array.from(array).every(Number.isFinite)
const fixtures = PRESETS.map((preset) => {
 const fixture = createCpuWorld(ArxWorld)
 fixture.world.build(preset, buildDepts(preset), 'dark')
 return { ...fixture, preset }
})
function frame(fixture, time) {
 fixture.world.time = time
 fixture.world.last = 0
 fixture.world.tick(1000)
 fixture.world.world.updateMatrixWorld(true)
}

for (const fixture of fixtures) {
 test(`${fixture.preset.id}: all scene and animation matrices remain finite`, () => {
  for (const t of [0, 8, 37, 120]) {
   frame(fixture, t)
   fixture.world.world.traverse((object) => {
    assert.ok(finite(object.matrixWorld.elements), object.name)
    if (object.isInstancedMesh) assert.ok(finite(object.instanceMatrix.array))
   })
  }
 })
 test(`${fixture.preset.id}: streets have positive length and connected endpoints`, () => {
  const world = fixture.world
  assert.equal(world.d3.length, fixture.preset.depts.length)
  for (const district of world.d3) {
   const inner = district.road.from.length(), outer = district.road.to.length()
   assert.ok(outer > inner + 1)
   assert.ok(inner >= 4.24 && inner <= 6.04, 'street joins the central boulevard')
   assert.ok(district.pos.length() - outer === 4.15 || Math.abs(district.pos.length() - outer - 4.15) < 1e-8)
   assert.ok(district.pos.length() - (outer + 1.35) < 3.03, 'turning court overlaps the platform apothem')
  }
 })
 test(`${fixture.preset.id}: both themes change world materials and preserve department identities`, () => {
  for (const theme of ['light', 'dark']) {
   fixture.view.theme = theme
   fixture.world.applyTheme(theme)
   assert.equal(fixture.world.M.bld.color.getHexString(), new THREE.Color(SCENE[theme].bld).getHexString())
   assert.equal(fixture.world.M.asphalt.color.getHexString(), new THREE.Color(SCENE[theme].asphalt).getHexString())
   for (const department of fixture.world.d3) {
    assert.equal(department.capMat.color.getHexString(), buildDepts(fixture.preset).find((d) => d.id === department.id).color.slice(1).toLowerCase())
   }
  }
 })
 test(`${fixture.preset.id}: low quality uses fewer foliage triangles; high quality restores them`, () => {
  const world = fixture.world
  world.setQuality('alta')
  const high = sceneMetrics(world).triangleInstances
  assert.equal(world.renderer.shadowMap.enabled, true)
  assert.equal(world.dir.shadow.mapSize.x, 2048)
  world.setQuality('baja')
  assert.ok(sceneMetrics(world).triangleInstances < high)
  assert.equal(world.renderer.shadowMap.enabled, false)
  world.setQuality('equilibrada')
  assert.equal(world.dir.shadow.mapSize.x, 1024)
  world.setQuality('alta')
  assert.equal(sceneMetrics(world).triangleInstances, high)
 })
 test(`${fixture.preset.id}: vehicle wheels stay on the road surface`, () => {
  for (const t of [0, 4, 13, 80]) {
   frame(fixture, t)
   const wheels = fixture.world.truckWheels, matrix = new THREE.Matrix4()
   wheels.geometry.computeBoundingBox()
   for (let i = 0; i < wheels.count; i++) {
    wheels.getMatrixAt(i, matrix)
    const position = wheels.geometry.attributes.position, point = new THREE.Vector3()
    let lowest = Infinity
    for (let vertex = 0; vertex < position.count; vertex++) {
     point.fromBufferAttribute(position, vertex).applyMatrix4(matrix)
     lowest = Math.min(lowest, point.y)
    }
    assert.ok(Math.abs(lowest - ROAD_LEVEL) < 0.003, `wheel ${i}: ${lowest}`)
   }
  }
 })
}

test('service lanes are continuous in position and tangent through every turn', () => {
 const length = 7, lane = .57, turn = Math.PI * lane
 for (const boundary of [length, length + turn, length * 2 + turn, length * 2 + turn * 2]) {
  const a = servicePose(boundary - 1e-6, length), b = servicePose(boundary + 1e-6, length)
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 3e-6)
  assert.ok(Math.abs(Math.sin(a.yaw - b.yaw)) < 1e-5)
 }
})

test('reduced motion freezes actors and flow textures while camera navigation stays available', () => {
 const fixture = fixtures[0]
 fixture.world.reduced = true
 fixture.world.time = 0
 fixture.world.last = 0
 fixture.world.tick(1000)
 const previous = Array.from(fixture.world.peopleLegs.instanceMatrix.array)
 const offset = fixture.world.arcs[0].map.offset.x
 fixture.world.tick(1016)
 assert.equal(fixture.world.time, 0)
 assert.deepEqual(Array.from(fixture.world.peopleLegs.instanceMatrix.array), previous)
 assert.equal(fixture.world.arcs[0].map.offset.x, offset)
 fixture.world.flyTo(fixture.preset.depts[0])
 assert.equal(fixture.world.flight.dur, .22)
 fixture.world.reduced = false
})

test('composite assets preserve existing vertex colors, including glass and rubber', () => {
 const geometry = fixtures[0].world.P.cabStatic
 const colors = geometry.attributes.color
 let dark = 0, light = 0
 for (let i = 0; i < colors.count; i++) {
  if (colors.getX(i) < .1) dark++
  if (colors.getX(i) > .7) light++
 }
 assert.ok(dark > 0 && light > 0)
 const recolored = coloredGeometry([{ geometry, color: '#FFFFFF', matrix: new THREE.Matrix4() }])
 assert.deepEqual(Array.from(recolored.attributes.color.array), Array.from(colors.array))
 recolored.dispose()
})

test('articulated people have grounded soles at sampled walking phases', () => {
 const fixture = fixtures[0]
 const matrix = new THREE.Matrix4()
 fixture.world.peopleShins.geometry.computeBoundingBox()
 for (const t of [0, .2, .4, .8, 1.2]) {
  frame(fixture, t)
  for (let i = 0; i < fixture.world.peopleShins.count; i++) {
   fixture.world.peopleShins.getMatrixAt(i, matrix)
   const bounds = fixture.world.peopleShins.geometry.boundingBox.clone().applyMatrix4(matrix)
   assert.ok(bounds.min.y >= ROAD_LEVEL - .001, `${i}: ${bounds.min.y}`)
   assert.ok(bounds.min.y < ROAD_LEVEL + .05)
  }
 }
})

test('rebuilding organizations removes old objects and keeps shared geometry usable', () => {
 const fixture = fixtures[0], world = fixture.world
 const old = world.world, tree = world.P.tree
 let disposed = 0
 const onDispose = () => disposed++
 tree.addEventListener('dispose', onDispose)
 world.build(PRESETS[2], buildDepts(PRESETS[2]), 'light')
 assert.equal(old.parent, null)
 assert.equal(world.preset.id, 'srv')
 assert.equal(world.d3.length, 5)
 assert.equal(world.P.tree, tree)
 assert.equal(disposed, 0)
 tree.removeEventListener('dispose', onDispose)
 assert.ok(tree.attributes.position.count > 0)
 assert.ok(world.pickables.every((o) => o.parent))
})


test('unmount disposes shared and unused cached resources exactly once', () => {
 const world = fixtures[0].world
 let canopyDisposals = 0, variantDisposals = 0, rendererDisposals = 0
 world.P.tree.addEventListener('dispose', () => canopyDisposals++)
 world.P.cabStatic.addEventListener('dispose', () => variantDisposals++)
 world.ro = { disconnect() {} }
 world.renderer.dispose = () => rendererDisposals++
 world.renderer.domElement.removeEventListener = () => {}
 world.renderer.domElement.remove = () => {}
 globalThis.cancelAnimationFrame = () => {}
 world.dispose()
 world.dispose()
 assert.equal(canopyDisposals, 1)
 assert.equal(variantDisposals, 1)
 assert.equal(rendererDisposals, 1)
})

test('complete vehicle wheel footprints stay inside paved streets and turning courts', () => {
 const length = 7, total = servicePose(0, length).total
 for (let distance = 0; distance < total; distance += .07) {
  const pose = servicePose(distance, length)
  for (const z of [.78, -.28, -.43]) for (const side of [-1, 1]) {
   const x = pose.x + Math.cos(pose.yaw) * side * .208 * 1.12 + Math.sin(pose.yaw) * z * 1.12
   const y = pose.z - Math.sin(pose.yaw) * side * .208 * 1.12 + Math.cos(pose.yaw) * z * 1.12
   const onStreet = Math.abs(x) < .925 && y > -.75 && y < length + .75
   const inCourt = Math.abs(x) < 1.35 && (Math.abs(y) < 1.35 || Math.abs(y - length) < 1.35)
   assert.ok(onStreet || inCourt, `${distance}: ${x}, ${y}`)
  }
 }
})


test('entrance ramps meet the ground and the raised landing without a gap', () => {
 const ramp = entranceRamp(.6, .4, .1)
 const position = ramp.attributes.position
 let low = false, high = false
 for (let vertex = 0; vertex < position.count; vertex++) {
  assert.ok(position.getY(vertex) >= 0)
  if (Math.abs(position.getZ(vertex) - .2) < 1e-6 && Math.abs(position.getY(vertex)) < 1e-6) low = true
  if (Math.abs(position.getZ(vertex) + .2) < 1e-6 && Math.abs(position.getY(vertex) - .1) < 1e-6) high = true
 }
 assert.ok(low && high)
 ramp.dispose()
})
