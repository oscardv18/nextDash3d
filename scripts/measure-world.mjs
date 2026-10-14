import { writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { registerSourceLoader, createCpuWorld, sceneMetrics, restoreBaseline } from './world-harness.mjs'
registerSourceLoader()
const before = process.argv.includes('--before')
const baselineBundle = before ? restoreBaseline() : null
const base = before ? 'file:///tmp/arxnet-premium-before/' : new URL('../src/arxnet/', import.meta.url).href
const { ArxWorld } = await import(`${base}world.ts`)
const { PRESETS, buildDepts } = await import(`${base}data.ts`)
const result = { bundle: baselineBundle ?? readdirSync(new URL('../dist/assets/', import.meta.url)).filter((name) => name.endsWith('.js')).map((name) => { const data = readFileSync(new URL('../dist/assets/' + name, import.meta.url)); return { name, bytes: data.byteLength, gzipBytes: gzipSync(data).byteLength } }), measuredAt: new Date().toISOString(), method: 'CPU scene construction; no WebGL, FPS, draw calls or mobile hardware measurements', sourceSha256: createHash('sha256').update(readFileSync(new URL(`${base}world.ts`))).digest('hex'), organizations: [] }
for (const preset of PRESETS) {
 const { world } = createCpuWorld(ArxWorld)
 const start = performance.now()
 world.build(preset, buildDepts(preset), 'dark')
 const buildMs = Math.round((performance.now() - start) * 10) / 10
 const profiles = {}
 for (const quality of ['alta', 'equilibrada', 'baja']) {
  world.setQuality(quality)
  profiles[quality] = sceneMetrics(world)
 }
 result.organizations.push({ id: preset.id, name: preset.name, buildMs, ...profiles.alta, profiles })
}
const destination = new URL(`../docs/world-${before ? 'before' : 'after'}.json`, import.meta.url)
writeFileSync(destination, JSON.stringify(result, null, 2) + '\n')
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
