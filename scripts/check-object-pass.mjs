import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { registerSourceLoader, createCpuWorld } from './world-harness.mjs'
registerSourceLoader()
const { ArxWorld } = await import('../src/arxnet/world.ts')
const { PRESETS, buildDepts } = await import('../src/arxnet/data.ts')
const { crownGeometry } = await import('../src/arxnet/foliage.ts')
const { world, view } = createCpuWorld(ArxWorld)
world.build(PRESETS[0], buildDepts(PRESETS[0]), 'dark')

function frame(time = 1) { world.time = time; world.last = 0; world.tick(1000) }

test('six tree silhouettes are distinct and retain a cheap low-quality counterpart', () => {
 const silhouettes = []
 for (let i = 0; i < 6; i++) {
  const high = crownGeometry('tree', false, i), low = crownGeometry('tree', true, i)
  high.computeBoundingBox()
  silhouettes.push(high.boundingBox.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join(':'))
  assert.ok(low.attributes.position.count < high.attributes.position.count * 0.65)
  assert.equal(high.userData.foliage, low.userData.foliage)
  high.dispose(); low.dispose()
 }
 assert.equal(new Set(silhouettes).size, 6)
})

test('all foliage shares at most eight global batches with varied rotations and owners', () => {
 assert.ok(world.foliageBatches.length <= 8)
 assert.equal(world.foliageBatches.filter(({ mesh }) => mesh.geometry.userData.foliageKind === 'tree').length, 6)
 const owners = new Set()
 for (const { mesh, tones } of world.foliageBatches) {
  assert.equal(mesh.count, mesh.userData.instanceDepts.length)
  assert.equal(mesh.count, tones.length)
  mesh.userData.instanceDepts.forEach((id) => { if (id) owners.add(id) })
 }
 assert.ok(owners.has('core'))
 assert.ok(owners.has('fin'))
 assert.ok(owners.has('pro'))
})

test('picking a batched canopy still selects the department of the hit instance', () => {
 const mesh = world.foliageBatches.find(({ mesh }) => mesh.userData.instanceDepts.includes('fin')).mesh
 const instanceId = mesh.userData.instanceDepts.indexOf('fin')
 const intersect = world.ray.intersectObjects
 world.ray.intersectObjects = () => [{ object: mesh, instanceId }]
 world.renderer.domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1440, height: 900 })
 assert.equal(world.pick({ clientX: 500, clientY: 400 }), 'fin')
 world.ray.intersectObjects = intersect
})

test('outfit buffers use every person once; skin and hands have matching tints', () => {
 frame()
 assert.equal(world.peopleOutfits.reduce((sum, mesh) => sum + mesh.count, 0), world.ppl.length)
 assert.equal(world.peopleOutfits.length, 6)
 assert.equal(new Set(world.ppl.map((p) => p.style)).size, 6)
 assert.equal(world.peopleForearms.count, world.ppl.length*2)
 assert.equal(world.peopleShins.count, world.ppl.length*2)
 assert.equal(world.peopleHands.count, world.ppl.length * 2)
 const head = new THREE.Color(), hand = new THREE.Color()
 for (let i = 0; i < world.ppl.length; i++) {
  world.peopleSkin.getColorAt(i, head)
  world.peopleHands.getColorAt(i * 2, hand)
  assert.deepEqual(head.toArray(), hand.toArray())
 }
 assert.equal(new Set(world.ppl.map((person) => person.skinTone)).size, 4)
})

test('contact shadows remain on the floor and follow actors without casting more shadows', () => {
 const body = new THREE.Matrix4(), contact = new THREE.Matrix4()
 for (const time of [0, 5, 20]) {
  frame(time)
  for (let i = 0; i < world.ppl.length; i++) {
   world.peopleSkin.getMatrixAt(i, body)
   world.peopleContact.getMatrixAt(i, contact)
   assert.ok(Math.abs(body.elements[12] - contact.elements[12]) < 1e-5)
   assert.ok(Math.abs(body.elements[14] - contact.elements[14]) < 1e-5)
   assert.ok(Math.abs(contact.elements[13] - .633) < 1e-5)
  }
 }
 assert.equal(world.peopleContact.castShadow, false)
 view.people = false; frame()
 assert.equal(world.peopleContact.visible, false)
 view.people = true
})

test('pallet silhouette retains bearing height and open forklift access', () => {
 const geometry = world.P.pallet
 geometry.computeBoundingBox()
 assert.ok(Math.abs(geometry.boundingBox.max.y - .094) < 1e-6)
 assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-6)
 const ray = new THREE.Raycaster(new THREE.Vector3(.085, .047, .4), new THREE.Vector3(0,0,-1))
 const pallet = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
 pallet.updateMatrixWorld()
 assert.equal(ray.intersectObject(pallet).length, 0)
 pallet.material.dispose()
})

test('fallback canopy shades as one soft volume, darker underneath', () => {
 const g = crownGeometry('tree', false, 0)
 g.computeBoundingBox()
 const box = g.boundingBox, centre = box.getCenter(new THREE.Vector3())
 const p = new THREE.Vector3(), n = new THREE.Vector3()
 let outward = 0, low = 0, lowN = 0, high = 0, highN = 0
 const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color
 for (let i = 0; i < pos.count; i++) {
  p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i)
  if (n.dot(p.clone().sub(centre)) > 0) outward++
  const h = (p.y - box.min.y) / (box.max.y - box.min.y)
  if (h < 0.25) { low += col.getY(i); lowN++ } else if (h > 0.75) { high += col.getY(i); highN++ }
 }
 assert.ok(outward / pos.count > 0.9)
 assert.ok(low / lowN < high / highN)
 g.dispose()
})

test('knee and elbow buffers bend independently while reduced motion freezes them', () => {
 const thigh=new THREE.Matrix4(),shin=new THREE.Matrix4(),arm=new THREE.Matrix4(),forearm=new THREE.Matrix4()
 frame(.8)
 let bentKnees=0,bentElbows=0
 for(let i=0;i<world.ppl.length*2;i++) {
  world.peopleLegs.getMatrixAt(i,thigh);world.peopleShins.getMatrixAt(i,shin)
  world.peopleArms.getMatrixAt(i,arm);world.peopleForearms.getMatrixAt(i,forearm)
  if(Math.abs(thigh.elements[5]-shin.elements[5])>.001)bentKnees++
  if(Math.abs(arm.elements[5]-forearm.elements[5])>.001)bentElbows++
 }
 assert.ok(bentKnees>0);assert.ok(bentElbows>0)
 world.reduced=true;frame(1)
 const matrices=[world.peopleShins,world.peopleForearms].map((m)=>Array.from(m.instanceMatrix.array))
 frame(5)
 assert.deepEqual(Array.from(world.peopleShins.instanceMatrix.array),matrices[0])
 assert.deepEqual(Array.from(world.peopleForearms.instanceMatrix.array),matrices[1])
 world.reduced=false
})

test('loaded warehouse pallets leave clear passages for forks and support the cartons', () => {
 const pallet=new THREE.Mesh(world.P.pallet,new THREE.MeshBasicMaterial())
 pallet.position.set(.398,.01,0);pallet.scale.setScalar(.6);pallet.updateMatrixWorld()
 for(const z of [-.045,.045]) {
  const ray=new THREE.Raycaster(new THREE.Vector3(.1,.045,z),new THREE.Vector3(1,0,0))
  assert.equal(ray.intersectObject(pallet).length,0)
 }
 assert.ok(Math.abs((.0382+.015)-(.01+.072*.6))<1e-6)
 assert.ok(Math.abs(.0664-(.01+.094*.6))<1e-6)
 pallet.material.dispose()
})
