import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ArxWorld, WorldView } from './world'
import {
  CLIENTS, OWNERS, PRESETS, THEMES, buildDepts, clamp, fill, getPreset, hash, makeEvent, rng, searchText,
  type LiveEvent, type PresetId, type Quality, type Theme,
} from './data'
import './shell.css'

export interface ArxnetShellProps {
  /** Organization shown on first load. */
  preset?: PresetId
  /** Multiplier for people walking around districts (0–2). */
  density?: number
  quality?: Quality
}

interface State {
  theme: Theme
  presetId: PresetId | null
  selected: string | null
  palette: boolean
  query: string
  resultIndex: number
  launcher: boolean
  notif: boolean
  orgMenu: boolean
  settings: boolean
  activityOpen: boolean
  flows: boolean
  people: boolean
  autoRotate: boolean
  labels: boolean
  events: LiveEvent[]
  vw: number
  app: { dept: string; name: string } | null
  loading: boolean
  worldError: boolean
  read: boolean
  epm: number
  /** Bumped on every select/deselect so the camera flies even when `selected` doesn't change. */
  fly: number
}

type Patch = Partial<State> | ((s: State) => Partial<State>)

const readTheme = (): Theme => {
  try {
    return localStorage.getItem('arx-theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// ---------- small presentational pieces ----------

const glass: CSSProperties = {
  background: 'var(--surface)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  border: '1px solid var(--line)',
  boxShadow: 'var(--shadow)',
}
const topGlass: CSSProperties = { ...glass, backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' }
const popover: CSSProperties = { background: 'var(--surfaceSolid)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }
const scrim: CSSProperties = { position: 'absolute', inset: 0, background: 'var(--scrim)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 20 }
const mono: CSSProperties = { fontFamily: 'var(--mono)' }
const sectionLabel: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)' }
const iconBtn = (size: number, extra?: CSSProperties): CSSProperties => ({ width: size, height: size, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', ...extra })
const divider = (h = 20): CSSProperties => ({ width: 1, height: h, background: 'var(--line)', flex: 'none' })

const Diamond = ({ color, size = 7 }: { color: string; size?: number }) => (
  <span style={{ flex: 'none', width: size, height: size, borderRadius: 2, transform: 'rotate(45deg)', background: color }} />
)
const Dot = ({ color, size = 6 }: { color: string; size?: number }) => (
  <span style={{ flex: 'none', width: size, height: size, borderRadius: '50%', background: color }} />
)
const LiveDot = () => <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accentSoft)' }} />

const Svg = ({ size, sw, children, join, style }: { size: number; sw: number; children: ReactNode; join?: boolean; style?: CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin={join ? 'round' : undefined} style={style}>
    {children}
  </svg>
)
const SearchIcon = ({ size }: { size: number }) => (
  <Svg size={size} sw={1.8}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></Svg>
)
const CloseIcon = () => <Svg size={15} sw={2}><path d="M6 6l12 12M18 6L6 18" /></Svg>
const Logo = ({ w, h, dot }: { w: number; h: number; dot?: boolean }) => (
  <div style={{ width: w, height: h, background: 'var(--accent)', clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)', display: 'grid', placeItems: 'center' }}>
    {dot && <div style={{ width: 6, height: 6, background: 'var(--accentInk)', borderRadius: 1, transform: 'rotate(45deg)' }} />}
  </div>
)

function DockButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="ax-h2" onClick={onClick} style={{ width: 52, height: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, border: 0, borderRadius: 12, cursor: 'pointer', background: active ? 'var(--surface3)' : 'transparent', color: 'var(--ink)' }}>
      {children}
      <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink2)' }}>{label}</span>
    </button>
  )
}

// ---------- shell ----------

export default function ArxnetShell({ preset = 'ind', density = 1, quality = 'auto' }: ArxnetShellProps) {
  const [s, setS] = useState<State>(() => ({
    theme: readTheme(), presetId: null, selected: null, palette: false, query: '', resultIndex: 0, launcher: false, notif: false, orgMenu: false, settings: false,
    activityOpen: false, flows: true, people: true, autoRotate: true, labels: true,
    events: Array.from({ length: 6 }, () => makeEvent(getPreset(preset), true)),
    vw: typeof window !== 'undefined' ? window.innerWidth : 1400, app: null, loading: true, worldError: false, read: false, epm: 128, fly: 0,
  }))
  const patch = useCallback((p: Patch) => setS((prev) => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) })), [])

  const P = getPreset(s.presetId || preset)
  const ds = buildDepts(P)
  const L = s.vw < 760 ? 'mobile' : s.vw < 1220 ? 'compact' : 'wide'
  const mob = L === 'mobile'

  const worldRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const world = useRef<ArxWorld | null>(null)
  const worldOptions = useRef({ quality, density })
  useEffect(() => { worldOptions.current = { quality, density } }, [quality, density])
  const stateRef = useRef(s)
  const presetRef = useRef(P)
  const viewRef = useRef<WorldView>({ selected: null, theme: s.theme, flows: true, people: true, autoRotate: true, labels: true })
  useEffect(() => {
    stateRef.current = s
    presetRef.current = P
    viewRef.current = { selected: s.selected, theme: s.theme, flows: s.flows, people: s.people, autoRotate: s.autoRotate, labels: s.labels }
  })

  // ---------- actions ----------

  const select = useCallback(
    (id: string) => patch((st) => ({ selected: id, fly: st.fly + 1, app: null, palette: false, launcher: false, notif: false, orgMenu: false, settings: false, activityOpen: false, query: '' })),
    [patch],
  )
  const deselect = useCallback(() => patch((st) => ({ selected: null, fly: st.fly + 1 })), [patch])
  const closeOverlays = useCallback(() => patch({ palette: false, launcher: false, app: null, notif: false, orgMenu: false, settings: false, query: '' }), [patch])
  const openPalette = () => patch({ palette: true, query: '', resultIndex: 0, app: null, launcher: false, notif: false, orgMenu: false, settings: false })
  const openApp = (dept: string, name: string) => patch({ app: { dept, name }, launcher: false, palette: false, notif: false, orgMenu: false, settings: false, query: '' })
  const setTheme = (t: Theme) => {
    patch({ theme: t })
    try {
      localStorage.setItem('arx-theme', t)
    } catch {
      // storage unavailable (private mode) - theme just won't persist
    }
  }
  const pickPreset = (id: PresetId) => {
    const next = getPreset(id)
    patch({ presetId: id, selected: null, orgMenu: false, palette: false, launcher: false, notif: false, settings: false, activityOpen: false, read: false, epm: 128, query: '', app: null, events: Array.from({ length: 6 }, () => makeEvent(next, true)) })
  }
  const goWorld = () => {
    closeOverlays()
    patch({ activityOpen: false })
    deselect()
  }
  const selectRef = useRef({ select, deselect })
  useEffect(() => {
    selectRef.current = { select, deselect }
  })

  // ---------- world lifecycle ----------

  useEffect(() => {
    const host = worldRef.current, labels = labelsRef.current
    if (!host || !labels) return
    let w: ArxWorld | null = null
    let timer = 0
    let cancelled = false
    const initialize = async () => {
      let worldError = false
      try {
        const { ArxWorld } = await import('./world')
        if (cancelled) return
        w = new ArxWorld(host, labels, {
          getView: () => viewRef.current,
          onSelect: (id) => selectRef.current.select(id),
          onDeselect: () => selectRef.current.deselect(),
          onCanvasPointer: () => {
            const st = stateRef.current
            if (st.orgMenu || st.notif || st.settings) patch({ orgMenu: false, notif: false, settings: false })
          },
        }, worldOptions.current)
        const P0 = presetRef.current
        w.start(P0, buildDepts(P0), stateRef.current.theme)
        world.current = w
        if (stateRef.current.selected) w.flyTo(stateRef.current.selected)
        // Detailed models stream in after the procedural world is already interactive.
        const target = w
        import('./assets')
          .then(({ loadAssets }) => loadAssets())
          .then((lib) => { if (!cancelled && world.current === target) target.setAssets(lib) })
          .catch((error) => console.warn('arx assets: keeping the procedural world', error))
      } catch (err) {
        console.error('arx world init', err)
        w?.dispose()
        w = null
        world.current = null
        worldError = true
      }
      if (!cancelled) timer = window.setTimeout(() => patch({ loading: false, worldError }), 150)
    }
    void initialize()
    return () => {
      cancelled = true
      clearTimeout(timer)
      w?.dispose()
      world.current = null
    }
    // Density applies at build time; the world module loads after the shell mounts.
  }, [patch])

  useEffect(() => {
    const w = world.current
    if (w && w.builtFor !== P.id) w.rebuild(P, ds, stateRef.current.theme)
  }, [P, ds])

  useEffect(() => {
    world.current?.setQuality(quality)
  }, [quality])

  useEffect(() => {
    if (!s.fly) return
    const id = stateRef.current.selected
    if (id) world.current?.flyTo(id)
    else world.current?.flyHome()
  }, [s.fly])

  // ---------- window events + live feed ----------

  useEffect(() => {
    const onResize = () => patch({ vw: window.innerWidth })
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (st.palette) closeOverlays()
        else patch({ palette: true, query: '', resultIndex: 0, app: null, launcher: false, notif: false, orgMenu: false, settings: false })
      } else if (e.key === 'Escape') {
        if (st.palette || st.launcher || st.app || st.notif || st.orgMenu || st.settings) closeOverlays()
        else if (st.activityOpen) patch({ activityOpen: false })
        else if (st.selected) selectRef.current.deselect()
      }
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    const timer = window.setInterval(() => {
      const ev = makeEvent(presetRef.current)
      patch((st) => ({ events: [ev, ...st.events].slice(0, 40), epm: clamp(st.epm + Math.round((Math.random() - 0.5) * 10), 90, 190) }))
      world.current?.pulse(ev.deptId, true)
    }, 2400)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      clearInterval(timer)
    }
  }, [patch, closeOverlays])

  // ---------- enter animations ----------

  useEffect(() => {
    panelRef.current?.animate?.([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }, [s.selected])
  const hasApp = !!s.app
  useEffect(() => {
    if (hasApp) appRef.current?.animate?.([{ opacity: 0, transform: 'translate(-50%,-47%) scale(.97)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }, [hasApp])
  useEffect(() => {
    if (!s.palette && !s.launcher && !hasApp) return
    const dialog = document.querySelector<HTMLElement>('.ax-root [aria-modal="true"]')
    if (!dialog) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')).filter((el) => !el.hasAttribute('disabled'))
    ;(s.palette ? inputRef.current : focusable()[0])?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    dialog.addEventListener('keydown', onKey)
    return () => {
      dialog.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [s.palette, s.launcher, hasApp])

  // ---------- derived view data ----------

  const byId = Object.fromEntries(ds.map((d) => [d.id, d]))
  const sel = s.selected ? byId[s.selected] : null
  const panelW = L === 'wide' ? 376 : 340

  const rootStyle = {
    ...THEMES[s.theme], '--mono': "'IBM Plex Mono', ui-monospace, monospace",
    position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)',
    fontFamily: "'Instrument Sans', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased', transition: 'background .4s',
  } as CSSProperties
  const showPanel = !mob || !!sel
  const panelBox: CSSProperties = mob
    ? { ...glass, position: 'absolute', left: 8, right: 8, bottom: 8, height: '64%', borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 9 }
    : { ...glass, position: 'absolute', top: 70, right: 12, bottom: 12, width: panelW, borderRadius: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 4 }
  const dockBox: CSSProperties = mob
    ? { ...glass, position: 'absolute', left: 8, right: 8, bottom: 8, height: 62, borderRadius: 16, display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '0 6px', zIndex: 5 }
    : { ...glass, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 4, padding: 5, zIndex: 5 }
  const showActivity = L === 'wide' || s.activityOpen
  const activityBox: CSSProperties = mob
    ? { ...glass, position: 'absolute', left: 8, right: 8, bottom: 78, top: '38%', borderRadius: 18, display: 'flex', flexDirection: 'column', zIndex: 7 }
    : { ...glass, position: 'absolute', left: 80, bottom: 12, width: 316, height: s.activityOpen ? Math.min(460, s.vw * 0.4) : 176, borderRadius: 16, display: 'flex', flexDirection: 'column', zIndex: 5, transition: 'height .35s cubic-bezier(.2,.8,.2,1)' }
  const chipsBox: CSSProperties = mob
    ? { ...glass, position: 'absolute', left: 8, right: 8, bottom: 78, height: 46, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px', zIndex: 5 }
    : { ...glass, position: 'absolute', left: L === 'wide' ? 80 + 316 + 10 : 80, right: panelW + 24, bottom: 12, height: 46, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px', zIndex: 5 }
  const settingsBox: CSSProperties = mob
    ? { ...popover, position: 'absolute', left: 8, right: 8, bottom: 78, borderRadius: 16, zIndex: 8, overflow: 'hidden' }
    : { ...popover, position: 'absolute', left: 80, top: '50%', transform: 'translateY(-30%)', width: 300, borderRadius: 16, zIndex: 8, overflow: 'hidden' }

  const evs = s.events.flatMap((e) => {
    const d = byId[e.deptId]
    return d ? [{ key: e.id, text: e.text, dept: d.name, color: d.color, time: e.time, go: () => select(d.id) }] : []
  })
  const labels = [
    { id: 'core', name: P.name, stat: 'núcleo', color: 'var(--accent)', select: deselect },
    ...ds.map((d) => ({ id: d.id, name: d.name, stat: d.kpis[0].value, color: d.color, select: () => select(d.id) })),
  ]

  const notifs: { title: string; meta: string; color: string; go: () => void }[] = []
  const goNotif = (id: string) => () => {
    patch({ notif: false, read: true })
    select(id)
  }
  ds.forEach((d) => {
    if (d.status === 'Operativo') return
    notifs.push({
      title: d.status === 'Incidencia' ? d.name + ': incidencia abierta en ' + d.procs[0].name.toLowerCase() : d.name + ': ' + d.kpis[2].label.toLowerCase() + ' fuera de umbral (' + d.kpis[2].value + ')',
      meta: d.status + ' · hace ' + (3 + notifs.length * 7) + ' min',
      color: d.statusColor,
      go: goNotif(d.id),
    })
  })
  notifs.push({ title: 'Solicitud de aprobación: ' + ds[0].procs[2].name, meta: ds[0].name + ' · hace 26 min', color: ds[0].color, go: goNotif(ds[0].id) })
  notifs.push({ title: 'Arxnet 4.2 disponible: nuevo módulo de automatizaciones', meta: 'Sistema · ayer', color: 'var(--accent)', go: () => patch({ notif: false, read: true }) })
  const unread = s.read ? 0 : notifs.length

  const q = searchText(s.query)
  let results: { kind: string; label: string; color: string; run: () => void }[] = []
  ds.forEach((d) => results.push({ kind: 'Departamento', label: d.name, color: d.color, run: () => select(d.id) }))
  ds.forEach((d) => d.apps.forEach((a) => results.push({ kind: 'App · ' + d.name, label: a, color: d.color, run: () => openApp(d.id, a) })))
  results.push({ kind: 'Acción', label: s.theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro', color: 'var(--ink3)', run: () => { setTheme(s.theme === 'dark' ? 'light' : 'dark'); closeOverlays() } })
  results.push({ kind: 'Acción', label: 'Vista general de la organización', color: 'var(--ink3)', run: () => { closeOverlays(); deselect() } })
  PRESETS.filter((p) => p.id !== P.id).forEach((p) => results.push({ kind: 'Organización', label: 'Cambiar a ' + p.name, color: 'var(--ink3)', run: () => pickPreset(p.id) }))
  results = (q ? results.filter((r) => searchText(r.label + ' ' + r.kind).includes(q)) : results.slice(0, ds.length + 3)).slice(0, 12)
  const resultIndex = Math.min(s.resultIndex, Math.max(0, results.length - 1))

  useEffect(() => {
    if (s.palette) document.getElementById(`ax-result-${resultIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [s.palette, resultIndex])

  let app: { name: string; color: string; crumbs: string; rows: { code: string; desc: string; owner: string; state: string; stateColor: string; value: string }[] } | null = null
  if (s.app && byId[s.app.dept]) {
    const d = byId[s.app.dept]
    const r = rng(hash(s.app.name + P.id))
    const states = [['En curso', '#5FB9E6'], ['Pendiente', '#E3B058'], ['Completado', '#8CC265']]
    const pre = s.app.name.replace(/[^A-Za-zÁÉÍÓÚ]/g, '').slice(0, 2).toUpperCase()
    app = {
      name: s.app.name, color: d.color, crumbs: P.name + ' / ' + d.name + ' / ' + s.app.name,
      rows: Array.from({ length: 8 }, (_, i) => {
        const st = states[Math.floor(r() * 3)]
        return {
          code: pre + '-' + (2600 + Math.floor(r() * 900)),
          desc: fill(d.procs[i % 3].name + (i > 2 ? ' · ' + CLIENTS[i % CLIENTS.length] : ''), r),
          owner: OWNERS[Math.floor(r() * OWNERS.length)], state: st[0], stateColor: st[1],
          value: (r() * 40).toFixed(1).replace('.', ',') + ' K€',
        }
      }),
    }
  }

  const toggle = (k: 'flows' | 'people' | 'autoRotate' | 'labels') => () => patch((st) => ({ [k]: !st[k] }))
  const settingsList = [
    { label: 'Flujos de datos', desc: 'Paquetes entre departamentos', on: s.flows, toggle: toggle('flows') },
    { label: 'Personas y vehículos', desc: 'Actividad física en el mundo', on: s.people, toggle: toggle('people') },
    { label: 'Rotación automática', desc: 'Órbita lenta en reposo', on: s.autoRotate, toggle: toggle('autoRotate') },
    { label: 'Etiquetas', desc: 'Nombres sobre cada distrito', on: s.labels, toggle: toggle('labels') },
  ]
  const themeBtn = (t: Theme): CSSProperties => {
    const on = s.theme === t
    return {
      width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, cursor: 'pointer',
      background: on ? (t === 'light' ? 'var(--surfaceSolid)' : 'var(--surface3)') : 'transparent',
      color: on ? 'var(--ink)' : 'var(--ink3)',
      boxShadow: on && t === 'light' ? 'var(--shadowSm)' : 'none',
    }
  }

  return (
    <div className="ax-root" style={rootStyle}>
      <div ref={worldRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />

      {/* district labels, positioned every frame by the world */}
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1 }}>
        {labels.map((d) => (
          <div key={d.id} data-dept-label={d.id} style={{ position: 'absolute', left: 0, top: 0, willChange: 'transform', opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button onClick={d.select} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px 6px 8px', borderRadius: 999, background: 'var(--surface)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 12, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap', cursor: 'pointer', boxShadow: 'var(--shadowSm)' }}>
              <Diamond color={d.color} size={8} />
              <span>{d.name}</span>
              <span style={{ ...mono, fontSize: 11, fontWeight: 500, color: 'var(--ink2)' }}>{d.stat}</span>
            </button>
            <div style={{ width: 1, height: 16, background: 'var(--line2)' }} />
          </div>
        ))}
      </div>

      {/* top bar */}
      <div className="ax-topbar" style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'grid', gridTemplateColumns: mob ? 'minmax(0,1fr) auto' : 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: mob ? 6 : 10, pointerEvents: 'none', zIndex: 6 }}>
        <div style={{ ...topGlass, justifySelf: 'start', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, height: 46, padding: '0 6px 0 12px', borderRadius: 14, minWidth: 0 }}>
          <div className="ax-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 6 }}>
            <Logo w={20} h={22} dot />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.03em' }}>arxnet</span>
          </div>
          <div style={divider()} />
          <button className="ax-h2" onClick={() => patch((st) => ({ orgMenu: !st.orgMenu, notif: false, settings: false }))} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 8px', border: 0, borderRadius: 9, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', minWidth: 0 }}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
              {!mob && <span style={{ fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{P.sector}</span>}
            </span>
            <Svg size={14} sw={2} style={{ color: 'var(--ink3)' }}><path d="M7 10l5 5 5-5" /></Svg>
          </button>
        </div>

        {!mob ? (
          <button className="ax-hl" onClick={openPalette} style={{ ...topGlass, pointerEvents: 'auto', width: 'min(440px,34vw)', height: 46, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 14px', borderRadius: 14, color: 'var(--ink2)', cursor: 'pointer', fontSize: 13 }}>
            <SearchIcon size={16} />
            <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Buscar departamentos, apps o acciones</span>
            <span style={{ ...mono, fontSize: 11, padding: '4px 7px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--line)', color: 'var(--ink2)' }}>⌘K</span>
          </button>
        ) : null}

        <div style={{ ...topGlass, justifySelf: 'end', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 4, height: 46, padding: '0 6px', borderRadius: 14 }}>
          {L === 'wide' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 8px', fontSize: 12, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                <LiveDot />
                <span>En vivo</span>
                <span style={{ ...mono, color: 'var(--ink)' }}>{s.epm}</span>
                <span>eventos/min</span>
              </div>
              <div style={divider()} />
            </>
          )}
          {mob && (
            <button onClick={openPalette} aria-label="Buscar" style={iconBtn(36)}>
              <SearchIcon size={18} />
            </button>
          )}
          <button className="ax-h2" onClick={() => patch((st) => ({ notif: !st.notif, orgMenu: false, settings: false }))} aria-label="Notificaciones" style={iconBtn(36, { position: 'relative' })}>
            <Svg size={18} sw={1.8} join><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" /></Svg>
            {unread > 0 && (
              <span style={{ position: 'absolute', top: 5, right: 5, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8, background: 'var(--accent)', color: 'var(--accentInk)', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', lineHeight: 1 }}>{unread}</span>
            )}
          </button>
          <div style={{ display: 'flex', padding: 3, gap: 2, borderRadius: 10, background: 'var(--surface2)' }}>
            <button onClick={() => setTheme('light')} aria-label="Modo claro" style={themeBtn('light')}>
              <Svg size={15} sw={1.9}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></Svg>
            </button>
            <button onClick={() => setTheme('dark')} aria-label="Modo oscuro" style={themeBtn('dark')}>
              <Svg size={15} sw={1.9} join><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></Svg>
            </button>
          </div>
          {!mob && <div style={{ width: 32, height: 32, marginLeft: 4, borderRadius: 10, background: 'var(--surface3)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>AM</div>}
        </div>
      </div>

      {s.orgMenu && (
        <div style={{ ...popover, position: 'absolute', top: 66, left: 12, width: 'min(320px,calc(100% - 24px))', padding: 6, borderRadius: 16, zIndex: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ ...sectionLabel, padding: '10px 10px 6px' }}>Organizaciones</div>
          {PRESETS.map((p) => (
            <button key={p.id} className="ax-h2" onClick={() => pickPreset(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, border: 0, borderRadius: 11, background: p.id === P.id ? 'var(--surface2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface3)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{p.sector}</span>
              </div>
              <span style={{ ...mono, fontSize: 11, color: 'var(--ink2)' }}>{p.depts.length} dptos.</span>
            </button>
          ))}
        </div>
      )}

      {s.notif && (
        <div style={{ ...popover, position: 'absolute', top: 66, right: 12, width: 'min(360px,calc(100% - 24px))', maxHeight: 'calc(100% - 78px)', overflow: 'auto', borderRadius: 16, zIndex: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Notificaciones</span>
            <button onClick={() => patch({ read: true })} style={{ border: 0, background: 'transparent', color: 'var(--ink2)', fontSize: 12, cursor: 'pointer' }}>Marcar como leídas</button>
          </div>
          {notifs.map((n, i) => (
            <button key={i} className="ax-h2" onClick={n.go} style={{ display: 'flex', gap: 12, width: '100%', padding: '12px 16px', border: 0, borderTop: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 'none', width: 8, height: 8, marginTop: 5, borderRadius: 2, transform: 'rotate(45deg)', background: n.color }} />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 13, lineHeight: 1.35, textWrap: 'pretty' }}>{n.title}</span>
                <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{n.meta}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* dock */}
      <div style={dockBox}>
        <DockButton label="Mundo" active={!s.selected && !s.launcher && !s.activityOpen && !s.settings} onClick={goWorld}>
          <Svg size={19} sw={1.7} join><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z" /><path d="M12 12l8-4.6M12 12v9.2M12 12L4 7.4" /></Svg>
        </DockButton>
        <DockButton label="Apps" active={s.launcher} onClick={() => patch({ launcher: true, app: null, palette: false, settings: false, notif: false, orgMenu: false })}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="3.25" /></svg>
        </DockButton>
        <DockButton label="Actividad" active={s.activityOpen} onClick={() => patch((st) => ({ activityOpen: !st.activityOpen, settings: false }))}>
          <Svg size={19} sw={1.7} join><path d="M3 12h4l3-7 4 14 3-7h4" /></Svg>
        </DockButton>
        <DockButton label="Ajustes" active={s.settings} onClick={() => patch((st) => ({ settings: !st.settings, notif: false, orgMenu: false }))}>
          <Svg size={19} sw={1.7}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Svg>
        </DockButton>
      </div>

      {s.settings && (
        <div style={settingsBox}>
          <div style={{ padding: '14px 16px 8px', fontSize: 14, fontWeight: 600 }}>Vista del mundo</div>
          {settingsList.map((o) => (
            <button key={o.label} className="ax-h2" onClick={o.toggle} role="switch" aria-checked={o.on} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 16px', border: 0, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{o.label}</span>
                <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{o.desc}</span>
              </span>
              <span style={{ flex: 'none', width: 34, height: 20, borderRadius: 10, padding: 2, background: o.on ? 'var(--accent)' : 'var(--surface3)', transition: 'background .2s' }}>
                <span style={{ display: 'block', width: 16, height: 16, borderRadius: 8, background: o.on ? 'var(--accentInk)' : 'var(--surfaceSolid)', transform: `translateX(${o.on ? 14 : 0}px)`, transition: 'transform .2s' }} />
              </span>
            </button>
          ))}
          <div style={{ padding: '10px 16px 14px', fontSize: 11, lineHeight: 1.5, color: 'var(--ink3)', borderTop: '1px solid var(--line)', marginTop: 6 }}>Arrastra para orbitar · clic derecho o Mayús para desplazar · rueda o pellizco para acercar</div>
        </div>
      )}

      {showActivity && (
        <div style={activityBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 8px' }}>
            <LiveDot />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink2)' }}>Actividad en vivo</span>
            <button onClick={() => patch((st) => ({ activityOpen: !st.activityOpen, settings: false }))} style={{ border: 0, background: 'transparent', color: 'var(--ink2)', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}>
              {s.activityOpen ? (L === 'wide' ? 'Contraer' : 'Cerrar') : 'Ver todo'}
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column', padding: '0 6px 6px' }}>
            {evs.slice(0, s.activityOpen ? 20 : 3).map((e) => (
              <button key={e.key} className="ax-h2" onClick={e.go} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: 8, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
                <Diamond color={e.color} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.text}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{e.dept}</span>
                </span>
                <span style={{ ...mono, fontSize: 10.5, color: 'var(--ink3)' }}>{e.time}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* department chips + zoom */}
      <div style={chipsBox}>
        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none', display: 'flex', gap: 4, padding: 2 }}>
          {ds.map((d) => (
            <button key={d.id} className="ax-h3" onClick={() => (s.selected === d.id ? deselect() : select(d.id))} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px 0 10px', border: 0, borderRadius: 10, background: s.selected === d.id ? 'var(--surface3)' : 'transparent', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Diamond color={d.color} />
              <span>{d.name}</span>
              <Dot color={d.statusColor} />
            </button>
          ))}
        </div>
        <div style={divider(22)} />
        <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
          <button className="ax-h2" onClick={() => world.current?.zoom(1.25)} aria-label="Alejar" style={iconBtn(34)}>
            <Svg size={16} sw={2}><path d="M6 12h12" /></Svg>
          </button>
          <button className="ax-h2" onClick={() => world.current?.zoom(0.8)} aria-label="Acercar" style={iconBtn(34)}>
            <Svg size={16} sw={2}><path d="M6 12h12M12 6v12" /></Svg>
          </button>
          <button className="ax-h2" onClick={goWorld} aria-label="Vista general" style={iconBtn(34)}>
            <Svg size={16} sw={1.8}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></Svg>
          </button>
        </div>
      </div>

      {/* side panel: selected department, or organization overview */}
      {showPanel && (
        <div ref={panelRef} style={panelBox}>
          {mob && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 0' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line2)' }} />
            </div>
          )}

          {sel ? (
            <>
              <div style={{ height: 3, background: sel.color, flex: 'none' }} />
              <div style={{ padding: '16px 18px 14px', display: 'flex', flexDirection: 'column', gap: 10, flex: 'none', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="ax-hi" onClick={goWorld} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'transparent', padding: 0, color: 'var(--ink2)', fontSize: 12, cursor: 'pointer' }}>
                    <Svg size={14} sw={2}><path d="M14 6l-6 6 6 6" /></Svg>
                    <span>{P.name}</span>
                  </button>
                  <span style={{ flex: 1 }} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px', borderRadius: 999, background: 'var(--surface2)', fontSize: 11.5, fontWeight: 500 }}>
                    <Dot color={sel.statusColor} />
                    {sel.status}
                  </span>
                  <button className="ax-h2" onClick={goWorld} aria-label="Cerrar" style={iconBtn(28, { borderRadius: 8, color: 'var(--ink2)' })}>
                    <CloseIcon />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.05 }}>{sel.name}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Responsable: {sel.lead} · {sel.head} personas</span>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '14px 18px 6px', display: 'flex', flexDirection: 'column' }}>
                  {sel.kpis.map((k) => (
                    <div key={k.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 76px auto', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{k.label}</span>
                        <span style={{ ...mono, fontSize: 11, color: k.deltaColor }}>{k.delta}</span>
                      </div>
                      <svg width="76" height="28" viewBox="0 0 100 30" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                        <polygon points={k.area} fill={sel.color} opacity={0.14} />
                        <polyline points={k.line} fill="none" stroke={sel.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                      </svg>
                      <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', textAlign: 'right', whiteSpace: 'nowrap' }}>{k.value}</span>
                    </div>
                  ))}
                </div>

                <div style={{ ...sectionLabel, padding: '14px 18px 4px' }}>Procesos activos</div>
                <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column' }}>
                  {sel.procs.map((p) => (
                    <div key={p.name} className="ax-h2" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 8px', borderRadius: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{p.name}</span>
                        <span style={{ ...mono, fontSize: 11, color: 'var(--ink2)' }}>{p.pct}</span>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: 'var(--surface3)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: p.pct, background: sel.color, borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{p.meta}</span>
                    </div>
                  ))}
                </div>

                <div style={{ ...sectionLabel, padding: '14px 18px 8px' }}>Aplicaciones</div>
                <div style={{ padding: '0 18px', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 }}>
                  {sel.apps.map((a) => (
                    <button key={a} className="ax-hlb" onClick={() => openApp(sel.id, a)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 44, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface2)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a}</span>
                      <Svg size={13} sw={2} style={{ flex: 'none', color: 'var(--ink3)' }}><path d="M7 17L17 7M9 7h8v8" /></Svg>
                    </button>
                  ))}
                </div>

                {sel.links.length > 0 && (
                  <>
                    <div style={{ ...sectionLabel, padding: '18px 18px 8px' }}>Flujos conectados</div>
                    <div style={{ padding: '0 18px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {sel.links.map((l) => (
                        <button key={l.other} className="ax-hl" onClick={() => select(l.other)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px 0 9px', border: '1px solid var(--line)', borderRadius: 999, background: 'transparent', color: 'var(--ink)', fontSize: 12, cursor: 'pointer' }}>
                          <Diamond color={byId[l.other].color} />
                          <span>{byId[l.other].name}</span>
                          <span style={{ ...mono, fontSize: 10.5, color: 'var(--ink3)' }}>{l.dir === 'salida' ? '→' : '←'}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ ...sectionLabel, padding: '18px 18px 6px' }}>Actividad reciente</div>
                <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column' }}>
                  {evs.filter((e) => e.dept === sel.name).slice(0, 5).map((e) => (
                    <div key={e.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ ...mono, fontSize: 10.5, color: 'var(--ink3)' }}>{e.time}</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.35 }}>{e.text}</span>
                    </div>
                  ))}
                  {!evs.some((e) => e.dept === sel.name) && <span style={{ fontSize: 12, color: 'var(--ink3)', padding: '6px 0' }}>Esperando nuevos eventos…</span>}
                </div>
              </div>
              <div style={{ padding: '12px 18px 16px', borderTop: '1px solid var(--line)', flex: 'none' }}>
                <button className="ax-hb" onClick={() => openApp(sel.id, sel.apps[0])} style={{ width: '100%', height: 44, border: 0, borderRadius: 12, background: 'var(--accent)', color: 'var(--accentInk)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span>Abrir espacio de {sel.name}</span>
                  <Svg size={15} sw={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '18px 18px 14px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--line)' }}>
                <span style={sectionLabel}>Pulso de la organización</span>
                <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{P.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{P.sector}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', borderBottom: '1px solid var(--line)' }}>
                {[
                  { value: String(P.size), label: 'Personas' },
                  { value: String(ds.length), label: 'Departamentos' },
                  { value: String(ds.length * 3 + 7), label: 'Procesos activos' },
                ].map((st) => (
                  <div key={st.label} style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4, borderRight: '1px solid var(--line)' }}>
                    <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{st.value}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{st.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...sectionLabel, padding: '14px 18px 6px' }}>Departamentos</div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', scrollbarWidth: 'none', padding: '0 8px 10px', display: 'flex', flexDirection: 'column' }}>
                {ds.map((d) => (
                  <button key={d.id} className="ax-h2" onClick={() => select(d.id)} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 12, padding: 10, border: 0, borderRadius: 11, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface2)', display: 'grid', placeItems: 'center' }}>
                      <Diamond color={d.color} size={9} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
                        <span>{d.name}</span>
                        <Dot color={d.statusColor} />
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.kpis[0].label} · {d.lead}</span>
                    </span>
                    <span style={{ ...mono, fontSize: 12, color: 'var(--ink)' }}>{d.kpis[0].value}</span>
                  </button>
                ))}
              </div>
              <div style={{ padding: '12px 18px 14px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--ink2)' }}>
                  <span style={{ width: 16, height: 3, borderRadius: 2, background: 'var(--ink3)' }} />
                  <span>Rutas físicas · personas y mercancías</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--ink2)' }}>
                  <span style={{ width: 16, height: 0, borderTop: '2px dotted var(--accentLine)' }} />
                  <span>Flujos de datos entre departamentos</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* app workspace modal */}
      {app && (
        <>
          <div onClick={() => patch({ app: null })} style={scrim} />
          <div ref={appRef} role="dialog" aria-modal="true" aria-label={app.name} style={{ ...popover, position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(820px,calc(100% - 20px))', maxHeight: 'calc(100% - 40px)', display: 'flex', flexDirection: 'column', borderRadius: 18, zIndex: 21, overflow: 'hidden' }}>
            <div style={{ height: 3, background: app.color }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 14px 20px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.crumbs}</span>
                <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{app.name}</span>
              </div>
              <button style={{ height: 36, padding: '0 14px', border: 0, borderRadius: 10, background: 'var(--accent)', color: 'var(--accentInk)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Nuevo registro</button>
              <button onClick={() => patch({ app: null })} aria-label="Cerrar" style={iconBtn(36, { background: 'var(--surface2)' })}>
                <CloseIcon />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '12px 20px', borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
              {['Todos', 'Abiertos', 'Asignados a mí', 'Esta semana'].map((f, i) => (
                <span key={f} style={{ flex: 'none', height: 28, padding: '0 11px', borderRadius: 8, display: 'flex', alignItems: 'center', fontSize: 12, background: i === 0 ? 'var(--ink)' : 'transparent', color: i === 0 ? 'var(--bg)' : 'var(--ink2)', border: '1px solid var(--line)' }}>{f}</span>
              ))}
            </div>
            <div style={{ overflow: 'auto', scrollbarWidth: 'none', flex: 1, minHeight: 0 }}>
              <div style={{ minWidth: 620 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 140px 110px 100px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink3)', borderBottom: '1px solid var(--line)' }}>
                  <span>Código</span><span>Descripción</span><span>Responsable</span><span>Estado</span><span style={{ textAlign: 'right' }}>Valor</span>
                </div>
                {app.rows.map((r, i) => (
                  <div key={i} className="ax-h2" style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 140px 110px 100px', gap: 12, alignItems: 'center', padding: '12px 20px', fontSize: 13, borderBottom: '1px solid var(--line)' }}>
                    <span style={{ ...mono, fontSize: 12, color: 'var(--ink2)' }}>{r.code}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.desc}</span>
                    <span style={{ color: 'var(--ink2)' }}>{r.owner}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}><Dot color={r.stateColor} />{r.state}</span>
                    <span style={{ ...mono, fontSize: 12, textAlign: 'right' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* app launcher */}
      {s.launcher && (
        <>
          <div onClick={() => patch({ launcher: false })} style={scrim} />
          <div role="dialog" aria-modal="true" aria-label="Aplicaciones" style={{ ...popover, position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(900px,calc(100% - 20px))', maxHeight: 'calc(100% - 40px)', overflow: 'auto', scrollbarWidth: 'none', padding: 22, borderRadius: 20, zIndex: 21, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Aplicaciones</span>
                <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{P.name} · {ds.reduce((n, d) => n + d.apps.length, 0)} aplicaciones en {ds.length} departamentos</span>
              </div>
              <button onClick={() => patch({ launcher: false })} aria-label="Cerrar" style={iconBtn(36, { background: 'var(--surface2)' })}>
                <CloseIcon />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
              {ds.map((d) => (
                <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 14, background: 'var(--surface2)', border: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 6px' }}>
                    <Diamond color={d.color} size={8} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{d.name}</span>
                  </div>
                  {d.apps.map((a) => (
                    <button key={a} className="ax-h3" onClick={() => openApp(d.id, a)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 34, padding: '0 8px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ink)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
                      <span>{a}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* command palette */}
      {s.palette && (
        <>
          <div onClick={closeOverlays} style={{ ...scrim, zIndex: 30 }} />
          <div role="dialog" aria-modal="true" aria-label="Buscar departamentos, apps o acciones" style={{ ...popover, position: 'absolute', left: '50%', top: '12vh', transform: 'translateX(-50%)', width: 'min(580px,calc(100% - 20px))', borderRadius: 18, zIndex: 31, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, borderBottom: '1px solid var(--line)', color: 'var(--ink2)' }}>
              <SearchIcon size={18} />
              <input
                ref={inputRef}
                value={s.query}
                onChange={(e) => patch({ query: e.target.value, resultIndex: 0 })}
                role="combobox"
                aria-label="Buscar departamentos, apps o acciones"
                aria-expanded="true"
                aria-controls="ax-results"
                aria-activedescendant={results.length ? `ax-result-${resultIndex}` : undefined}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    patch({ resultIndex: results.length ? (resultIndex + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0 })
                  } else if (e.key === 'Enter' && results[resultIndex]) {
                    e.preventDefault()
                    results[resultIndex].run()
                  }
                }}
                placeholder="Ir a departamento, abrir app o ejecutar acción"
                style={{ flex: 1, minWidth: 0, height: '100%', border: 0, outline: 0, background: 'transparent', color: 'var(--ink)', fontSize: 15, fontFamily: 'inherit' }}
              />
              <span style={{ ...mono, fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--line)' }}>esc</span>
            </div>
            <div id="ax-results" role="listbox" aria-label="Resultados" style={{ maxHeight: 'min(420px,60vh)', overflow: 'auto', scrollbarWidth: 'none', padding: 6 }}>
              {results.map((r, i) => (
                <button key={r.kind + r.label} id={`ax-result-${i}`} role="option" aria-selected={i === resultIndex} className="ax-h2" onClick={r.run} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', border: 0, borderRadius: 10, background: i === resultIndex ? 'var(--surface2)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
                  <Diamond color={r.color} size={8} />
                  <span style={{ flex: 1, fontSize: 13.5 }}>{r.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.kind}</span>
                </button>
              ))}
              {results.length === 0 && <div style={{ padding: 22, textAlign: 'center', fontSize: 13, color: 'var(--ink2)' }}>Sin resultados</div>}
            </div>
          </div>
        </>
      )}

      {s.worldError && (
        <div role="alert" style={{ ...popover, position: 'absolute', left: '50%', top: '35%', transform: 'translate(-50%,-50%)', width: 'min(360px,calc(100% - 24px))', padding: 20, borderRadius: 16, zIndex: 2, fontSize: 13, lineHeight: 1.5 }}>
          No se pudo iniciar la vista 3D. Puedes seguir explorando los departamentos y aplicaciones. Activa WebGL en tu navegador y recarga para ver la ciudad.
        </div>
      )}

      {s.loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 40, background: 'var(--bg)', pointerEvents: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <Logo w={28} h={32} />
            <span style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink2)' }}>Construyendo tu organización</span>
          </div>
        </div>
      )}
    </div>
  )
}
