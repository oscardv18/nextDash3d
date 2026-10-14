import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'

export function restoreBaseline(name = 'world-baseline') {
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL(`../docs/${name}.json.gz`, import.meta.url))))
  mkdirSync('/tmp/arxnet-premium-before', { recursive: true })
  for (const name of ['world', 'data', 'premium']) if (snapshot[name]) writeFileSync(`/tmp/arxnet-premium-before/${name}.ts`, snapshot[name])
  return snapshot.bundle
}

export function registerSourceLoader() {
  registerHooks({
    resolve(specifier, context, next) {
      if (!specifier.startsWith('.') && context.parentURL?.startsWith('file:///tmp/arxnet-premium-before/')) {
        context = { ...context, parentURL: new URL('../src/arxnet/world.ts', import.meta.url).href }
      }
      try { return next(specifier, context) } catch (error) {
        if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context)
        throw error
      }
    },
    load(url, context, next) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
      if (/\.tsx?$/.test(url)) {
        const { outputText } = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
          transformers: url.endsWith('/world.ts') ? { before: [(context) => {
            const visit = (node) => ts.isConstructorDeclaration(node) ? undefined : ts.visitEachChild(node, visit, context)
            return (source) => ts.visitNode(source, visit)
          }] } : undefined,
        })
        return { format: 'module', source: outputText, shortCircuit: true }
      }
      return next(url, context)
    },
  })
}

// CPU construction only. Texture pixels and GPU rendering are deliberately absent.
function canvas() {
  const image = { width: 0, height: 0 }
  const gradient = { addColorStop() {} }
  image.getContext = () => new Proxy({
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => gradient, createLinearGradient: () => gradient,
  }, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true } })
  return image
}

export function createCpuWorld(ArxWorld, width = 1440) {
  globalThis.window = { innerWidth: width, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }
  globalThis.document = { createElement: canvas, hidden: false }
  globalThis.requestAnimationFrame = () => 0
  const w = new ArxWorld()
  const view = { theme: 'dark', selected: null, flows: true, people: true, labels: true, autoRotate: false }
  Object.assign(w, {
    host: { clientWidth: width, clientHeight: 900 }, labelsHost: { clientWidth: width, clientHeight: 900, querySelectorAll: () => [] },
    cb: { getView: () => view }, quality: 'baja', density: 1, reduced: false, autoLevel: 2,
    renderer: { domElement: { style: {} }, setSize() {}, setPixelRatio() {}, shadowMap: {}, info: { reset() {}, render: {}, memory: {} }, render() {} },
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(21, width / 900, 1, 700),
    hemi: new THREE.HemisphereLight(), dir: new THREE.DirectionalLight(), rim: new THREE.DirectionalLight(),
    cam: { theta: Math.PI / 4, phi: 0.95, r: 70, target: new THREE.Vector3() },
    goal: { theta: Math.PI / 4, phi: 0.95, r: 70, target: new THREE.Vector3() },
  })
  w.scene.background = new THREE.Color()
  w.scene.fog = new THREE.Fog(0, 80, 190)
  w.dir.shadow.map = null
  w.tex = w.makeTextures()
  w.M = w.createMaterials(w.tex)
  w.G.box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  w.G.sph = new THREE.SphereGeometry(1, 24, 16)
  w.G.hemi = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2)
  w.G.ao = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  w.G.trunk = w.cy(0.045, 0.065, 0.6, 8)
  w.G.packet = new THREE.SphereGeometry(0.07, 12, 8)
  w.G.pulse = new THREE.RingGeometry(3.7, 3.95, 6).rotateX(-Math.PI / 2)
  for (const geometry of Object.values(w.G)) geometry.userData.keep = true
  w.buildProps()
  return { world: w, view }
}

export function sceneMetrics(world) {
  const geometries = new Map(), materials = new Set()
  let meshObjects = 0, instancedBatches = 0, instances = 0, triangleInstances = 0
  world.world.traverse((o) => {
    if (!o.isMesh) return
    meshObjects++
    geometries.set(o.geometry.uuid, o.geometry)
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    mats.forEach((m) => materials.add(m.uuid))
    const count = o.isInstancedMesh ? o.count : 1
    if (o.isInstancedMesh) { instancedBatches++; instances += count }
    triangleInstances += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * count
  })
  let geometryBytes = 0
  for (const geometry of geometries.values()) {
    for (const attribute of Object.values(geometry.attributes)) geometryBytes += attribute.array.byteLength
    geometryBytes += geometry.index?.array.byteLength ?? 0
  }
  return { meshObjects, instancedBatches, instances, uniqueGeometries: geometries.size, uniqueMaterials: materials.size, triangleInstances, geometryBytes }
}
