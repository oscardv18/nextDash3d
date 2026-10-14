import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerSourceLoader } from './world-harness.mjs'
registerSourceLoader()

const { ArxWorld } = await import('../src/arxnet/world.ts')
const { PRESETS, buildDepts, searchText } = await import('../src/arxnet/data.ts')
const { default: ArxnetShell } = await import('../src/arxnet/ArxnetShell.tsx')

const cameraState = (r) => ({ theta: 0.5, phi: 0.9, r, target: new THREE.Vector3(2, 0, 3) })
function interactionWorld() {
  const selections = []
  const w = new ArxWorld()
  Object.assign(w, {
    cam: cameraState(30), goal: cameraState(50), r0: 70, flight: null,
    ptrs: new Map(), drag: null, pinch: 0, hoverId: null,
    renderer: { domElement: { style: {}, setPointerCapture() {} } },
    cb: { onCanvasPointer() {}, onSelect: (id) => selections.push(id), getView: () => ({ selected: null }) },
    pick: () => 'fin',
  })
  return { w, selections }
}

test('zoom during a camera flight takes effect immediately and pauses auto rotation', () => {
  const { w } = interactionWorld()
  w.flight = { t: 0.5 }
  w.zoom(0.8)
  assert.equal(w.flight, null)
  assert.equal(w.goal.r, 24)
  assert.deepEqual(w.goal.target, w.cam.target)
  assert.ok(w.interact > 0)
})

test('zoom stays within camera bounds', () => {
  const { w } = interactionWorld()
  w.zoom(0.001)
  assert.equal(w.goal.r, 14)
  w.zoom(1000)
  assert.equal(w.goal.r, 119)
})

const pointer = (pointerId) => ({ pointerId, clientX: 100, clientY: 100, button: 0, shiftKey: false })
test('a regular canvas click selects a department', () => {
  const { w, selections } = interactionWorld()
  w.onDown(pointer(1))
  w.onUp(pointer(1))
  assert.deepEqual(selections, ['fin'])
})

test('a cancelled touch never selects a department', () => {
  const { w, selections } = interactionWorld()
  w.onDown(pointer(1))
  w.onCancel(pointer(1))
  assert.deepEqual(selections, [])
  assert.equal(w.ptrs.size, 0)
  assert.equal(w.drag, null)
})

test('a stationary two-finger gesture never becomes a click', () => {
  const { w, selections } = interactionWorld()
  w.onDown(pointer(1))
  w.onDown({ ...pointer(2), clientX: 150 })
  w.onUp(pointer(1))
  w.onUp(pointer(2))
  assert.deepEqual(selections, [])
  assert.equal(w.pinch, 0)
})

test('hidden floating labels cannot intercept clicks or keyboard focus', () => {
  const label = { style: {}, getAttribute: () => 'fin', inert: false }
  const { w } = interactionWorld()
  Object.assign(w, {
    labelsHost: { clientWidth: 1440, clientHeight: 900, querySelectorAll: () => [label] },
    d3map: { fin: { pos: new THREE.Vector3(), labelY: 1 } },
    tmpV: new THREE.Vector3(), camera: new THREE.PerspectiveCamera(21, 1.6, 1, 700),
  })
  w.camera.position.set(0, 20, 30)
  w.camera.lookAt(0, 0, 0)
  w.camera.updateMatrixWorld()
  w.projectLabels({ labels: false }, null, null)
  assert.equal(label.style.visibility, 'hidden')
  assert.equal(label.inert, true)
  w.projectLabels({ labels: true }, null, null)
  assert.equal(label.style.visibility, 'visible')
  assert.equal(label.inert, false)
})

test('resizing across the mobile breakpoint reframes the current view', () => {
  const { w } = interactionWorld()
  const previousWindow = globalThis.window
  globalThis.window = { innerWidth: 390 }
  try {
    let home = 0, focused = 0
    Object.assign(w, {
      host: { clientWidth: 390, clientHeight: 844 }, preset: PRESETS[0], R: 16.5,
      renderer: { setSize() {} }, camera: new THREE.PerspectiveCamera(),
      focusId: null, flyHome: () => home++, flyTo: (id) => { assert.equal(id, 'fin'); focused++ },
    })
    w.resize()
    assert.equal(home, 1)
    assert.equal(w.r0, 23.5 * 4.2)
    w.focusId = 'fin'
    globalThis.window.innerWidth = 1440
    w.resize()
    assert.equal(focused, 1)
    assert.equal(w.r0, 23.5 * 3.1)
  } finally {
    globalThis.window = previousWindow
  }
})

test('search matches Spanish department and application names without accents', () => {
  assert.equal(searchText('  LOGÍSTICA '), 'logistica')
  assert.ok(searchText('Órdenes de fabricación').includes(searchText('ordenes')))
})

test('all organizations have valid departments, applications and connected flows', () => {
  for (const preset of PRESETS) {
    const departments = buildDepts(preset)
    assert.equal(departments.length, preset.depts.length)
    for (const dept of departments) {
      assert.equal(dept.kpis.length, 3)
      assert.ok(dept.apps.length > 0)
      for (const link of dept.links) assert.ok(preset.depts.includes(link.other))
    }
  }
  assert.equal(buildDepts(PRESETS[0]).find((d) => d.id === 'alm').status, 'Atención')
  assert.equal(buildDepts(PRESETS[0]).find((d) => d.id === 'log').status, 'Incidencia')
})

test('mobile header uses two columns and omits the desktop search column', () => {
  const previousWindow = globalThis.window
  globalThis.window = { innerWidth: 390 }
  try {
    const html = renderToStaticMarkup(createElement(ArxnetShell))
    assert.ok(html.includes('grid-template-columns:minmax(0,1fr) auto;'))
    assert.ok(html.includes('aria-label="Buscar"'))
    assert.ok(!html.includes('Buscar departamentos, apps o acciones</span>'))
  } finally {
    globalThis.window = previousWindow
  }
})
