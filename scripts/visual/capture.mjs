// Headless Chrome over CDP: run UI steps against the running dev server, save screenshots,
// report console warnings/errors. Used for visual regression checks and before/after shots.
//
//   node scripts/visual/capture.mjs <outDir> <WxH> '<steps json>'
//   env: URL (default http://localhost:5179/), BLOCK_ASSETS=1 (procedural world only), WAIT=ms
//   steps: [{ click: 'label' } | { key: 'Escape', mods } | { eval: 'js' } | { wait: ms, shot: 'name' }]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const [W, H] = (process.argv[3] || '1440x900').split('x').map(Number)
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn('google-chrome-stable', ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp'))}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + m.params.exceptionDetails.exception?.description)
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Runtime.enable')
await send('Network.enable')
if (process.env.BLOCK_ASSETS) await send('Network.setBlockedURLs', { urls: ['*assets/world/*'] })
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 760 })
await send('Page.navigate', { url: process.env.URL || 'http://localhost:5179/' })
await sleep(Number(process.env.WAIT || 7000))
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'))
}
const click = (txt) => evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||b.textContent).trim().includes(${JSON.stringify(txt)})); if(!b) return 'MISSING ${txt}'; b.click(); return 'ok' })()`)
const key = async (k, mods = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, modifiers: mods, windowsVirtualKeyCode: k === 'Escape' ? 27 : k === 'Enter' ? 13 : k.toUpperCase().charCodeAt(0) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, modifiers: mods })
}
const log = []
for (const s of JSON.parse(process.argv[4] || '[]')) {
  let r = ''
  if (s.click) r = await click(s.click)
  if (s.key) { await key(s.key, s.mods || 0); r = 'key' }
  if (s.eval) r = await evalJs(s.eval)
  await sleep(s.wait ?? 2500)
  if (s.shot) await shot(s.shot)
  log.push((s.shot || '') + ' ' + JSON.stringify(r))
}
console.log(log.join('\n'))
console.log('CONSOLE:\n' + errors.join('\n'))
ws.close()
chrome.kill()
process.exit(0)
