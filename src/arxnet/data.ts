export type Theme = 'dark' | 'light'
export type Quality = 'auto' | 'baja' | 'equilibrada' | 'alta'
export type PresetId = 'ind' | 'ret' | 'srv'
export type Kind = 'towers' | 'arch' | 'hall' | 'crates' | 'docks' | 'campus' | 'dome' | 'grid' | 'lab'

interface DeptTemplate {
  name: string
  kind: Kind
  color: string
  lead: string
  /** [label, value, delta, good] */
  kpis: [string, string, string, number][]
  apps: string[]
  procs: string[]
  ev: string[]
}

export interface Kpi {
  label: string
  value: string
  delta: string
  line: string
  area: string
  deltaColor: string
}

export interface Proc {
  name: string
  pct: string
  meta: string
}

export interface Dept {
  id: string
  name: string
  kind: Kind
  color: string
  lead: string
  head: number
  status: string
  statusColor: string
  kpis: Kpi[]
  procs: Proc[]
  apps: string[]
  ev: string[]
  links: { other: string; dir: 'salida' | 'entrada' }[]
}

export interface Preset {
  id: PresetId
  name: string
  sector: string
  size: number
  depts: string[]
  links: [string, string][]
  alerts: Record<string, number>
}

export const DT: Record<string, DeptTemplate> = {
  fin: { name: 'Finanzas', kind: 'towers', color: '#5B8DEF', lead: 'Laura Méndez', kpis: [['Flujo de caja', '2,41 M€', '+4,2%', 1], ['Cobros pendientes', '318 K€', '−6,1%', 1], ['Periodo medio de cobro', '34 días', '−2 días', 1]], apps: ['Contabilidad', 'Tesorería', 'Facturación', 'Presupuestos'], procs: ['Cierre contable de octubre', 'Conciliación bancaria semanal', 'Aprobación de gastos Q4'], ev: ['Factura F-{n} emitida', 'Cobro de {c} conciliado', 'Asiento #{n} registrado', 'Remesa SEPA enviada'] },
  ven: { name: 'Ventas', kind: 'arch', color: '#E8875B', lead: 'Diego Ferrer', kpis: [['Pedidos hoy', '184', '+12%', 1], ['Pipeline abierto', '1,9 M€', '+8,4%', 1], ['Conversión', '23,8%', '+1,1 pp', 1]], apps: ['CRM', 'Pedidos', 'Ofertas', 'Tarifas'], procs: ['Renovaciones anuales', 'Oferta para {c}', 'Revisión de tarifas 2027'], ev: ['Pedido #{n} confirmado', 'Oportunidad ganada · {c}', 'Oferta O-{n} enviada'] },
  pro: { name: 'Producción', kind: 'hall', color: '#D9B64A', lead: 'Marta Ibarra', kpis: [['OEE', '86,4%', '+1,8 pp', 1], ['Órdenes activas', '42', '+5', 1], ['Paradas hoy', '3', '−2', 1]], apps: ['Órdenes de fabricación', 'Planificación', 'Mantenimiento', 'Escandallos'], procs: ['Lote L-2291 · Línea 2', 'Preventivo prensa 4', 'Cambio de formato línea 1'], ev: ['Orden OF-{n} iniciada', 'Lote L-{n} completado', 'Línea {d} a ritmo nominal'] },
  alm: { name: 'Almacén', kind: 'crates', color: '#9C7BE0', lead: 'Iker Sola', kpis: [['Ocupación', '78%', '+3 pp', 0], ['Líneas de picking/h', '412', '+9%', 1], ['Roturas de stock', '5', '+1', 0]], apps: ['Inventario', 'Ubicaciones', 'Recepciones', 'Picking'], procs: ['Inventario cíclico zona B', 'Recepción proveedor Ferrox', 'Reubicación pasillo 12'], ev: ['Recepción R-{n} ubicada', 'Picking #{n} completado', 'Ajuste de stock en zona C'] },
  log: { name: 'Logística', kind: 'docks', color: '#4FB3A9', lead: 'Nerea Castro', kpis: [['Envíos en ruta', '67', '+11', 1], ['Entregas a tiempo', '96,2%', '−0,4 pp', 0], ['Coste por envío', '7,80 €', '−3%', 1]], apps: ['Expediciones', 'Rutas', 'Transportistas', 'Seguimiento'], procs: ['Ruta norte · 14 paradas', 'Licitación de transporte 2027', 'Devoluciones semana 41'], ev: ['Envío E-{n} entregado', 'Camión {d} sale del muelle', 'Ruta optimizada · −12 km'] },
  com: { name: 'Compras', kind: 'campus', color: '#C978B8', lead: 'Álvaro Ruiz', kpis: [['Pedidos a proveedor', '58', '+4', 1], ['Ahorro negociado', '6,2%', '+0,8 pp', 1], ['Plazo medio', '4,1 días', '−0,3', 1]], apps: ['Pedidos de compra', 'Proveedores', 'Homologación', 'Contratos'], procs: ['Homologación de Ferrox', 'Pedido marco de embalajes', 'Revisión de contratos Q1'], ev: ['Pedido de compra PC-{n} aprobado', 'Proveedor homologado', 'Albarán A-{n} recibido'] },
  rrhh: { name: 'Personas', kind: 'dome', color: '#E07A8C', lead: 'Sofía Navarro', kpis: [['Plantilla activa', '{h}', '+6', 1], ['Absentismo', '2,9%', '−0,2 pp', 1], ['Vacantes abiertas', '9', '+2', 0]], apps: ['Empleados', 'Nóminas', 'Selección', 'Formación'], procs: ['Nóminas de octubre', 'Selección de 3 perfiles', 'Plan de formación 2027'], ev: ['Alta de empleado registrada', 'Vacaciones aprobadas', 'Nueva candidatura recibida'] },
  ti: { name: 'Tecnología', kind: 'grid', color: '#5FB9E6', lead: 'Pablo Ortega', kpis: [['Disponibilidad', '99,98%', '+0,01 pp', 1], ['Tickets abiertos', '14', '−5', 1], ['Integraciones', '23', '+1', 1]], apps: ['Service desk', 'Activos', 'Accesos', 'Integraciones'], procs: ['Migración a SSO', 'Renovación de portátiles', 'Auditoría de accesos'], ev: ['Ticket T-{n} resuelto', 'Copia de seguridad completada', 'Integración EDI sincronizada'] },
  cal: { name: 'Calidad', kind: 'lab', color: '#8CC265', lead: 'Elena Prieto', kpis: [['Conformidad', '99,1%', '+0,3 pp', 1], ['No conformidades', '4', '−1', 1], ['Auditorías abiertas', '2', '', 1]], apps: ['Inspecciones', 'No conformidades', 'Auditorías', 'Certificados'], procs: ['Auditoría ISO 9001', 'Inspección lote L-2288', 'Análisis de reclamación #882'], ev: ['Inspección lote L-{n} superada', 'No conformidad cerrada', 'Certificado emitido'] },
  mkt: { name: 'Marketing', kind: 'arch', color: '#F0A04B', lead: 'Clara Vidal', kpis: [['Leads esta semana', '1.248', '+18%', 1], ['Coste por lead', '4,10 €', '−7%', 1], ['Tráfico web', '86 K', '+5%', 1]], apps: ['Campañas', 'Contenidos', 'Segmentos', 'Analítica'], procs: ['Campaña de invierno', 'Lanzamiento de colección', 'Newsletter semanal'], ev: ['Campaña publicada', 'Segmento actualizado', 'Lead cualificado · {c}'] },
  sat: { name: 'Atención al cliente', kind: 'dome', color: '#6FA8DC', lead: 'Hugo Marín', kpis: [['Casos abiertos', '37', '−8', 1], ['Primera respuesta', '12 min', '−3 min', 1], ['Satisfacción', '4,7 / 5', '+0,1', 1]], apps: ['Casos', 'Base de conocimiento', 'Chat', 'Devoluciones'], procs: ['Pico de devoluciones', 'Nueva base de conocimiento', 'Encuesta de satisfacción'], ev: ['Caso C-{n} resuelto', 'Devolución D-{n} autorizada', 'Valoración de 5 estrellas'] },
  tie: { name: 'Tiendas', kind: 'campus', color: '#E3B058', lead: 'Irene Gil', kpis: [['Ventas hoy', '84,3 K€', '+6%', 1], ['Ticket medio', '38,20 €', '+2%', 1], ['Tiendas abiertas', '24 / 24', '', 1]], apps: ['TPV', 'Reposición', 'Turnos', 'Precios'], procs: ['Reposición tienda Centro', 'Cambio de escaparate', 'Turnos de diciembre'], ev: ['Venta TPV #{n} · tienda {d}', 'Reposición solicitada · tienda {d}', 'Cierre de caja · tienda {d}'] },
  pry: { name: 'Proyectos', kind: 'towers', color: '#7E8CE0', lead: 'Marcos León', kpis: [['Proyectos activos', '18', '+2', 1], ['Horas facturables', '82%', '+3 pp', 1], ['Desviación de coste', '−2,4%', '', 1]], apps: ['Proyectos', 'Partes de horas', 'Planificación', 'Entregables'], procs: ['Implantación {c}', 'Auditoría Halvorsen', 'Plan estratégico Vértice'], ev: ['Hito completado · {c}', 'Parte de horas aprobado', 'Entregable E-{n} publicado'] },
  leg: { name: 'Legal', kind: 'lab', color: '#A79A84', lead: 'Julia Serra', kpis: [['Contratos en revisión', '11', '+3', 0], ['Plazo medio', '3,2 días', '−0,5', 1], ['Riesgos abiertos', '2', '', 1]], apps: ['Contratos', 'Cumplimiento', 'Firmas', 'Expedientes'], procs: ['Contrato marco {c}', 'Revisión RGPD', 'Renovación de seguros'], ev: ['Contrato firmado · {c}', 'Revisión completada', 'Cláusula aprobada'] },
}

export const PRESETS: Preset[] = [
  { id: 'ind', name: 'Norvik Industrial', sector: 'Manufactura · 412 personas', size: 412, depts: ['fin', 'ven', 'pro', 'alm', 'log', 'com', 'rrhh', 'ti', 'cal'], links: [['ven', 'pro'], ['pro', 'alm'], ['alm', 'log'], ['com', 'alm'], ['ven', 'fin'], ['com', 'fin'], ['cal', 'pro'], ['ti', 'fin'], ['rrhh', 'fin']], alerts: { alm: 1, log: 2 } },
  { id: 'ret', name: 'Mercato Group', sector: 'Retail · 236 personas', size: 236, depts: ['ven', 'tie', 'alm', 'log', 'mkt', 'sat', 'fin'], links: [['mkt', 'ven'], ['ven', 'tie'], ['tie', 'alm'], ['alm', 'log'], ['sat', 'ven'], ['ven', 'fin'], ['tie', 'fin']], alerts: { tie: 1 } },
  { id: 'srv', name: 'Lumen Consultores', sector: 'Servicios profesionales · 58 personas', size: 58, depts: ['pry', 'ven', 'rrhh', 'fin', 'leg'], links: [['ven', 'pry'], ['pry', 'fin'], ['rrhh', 'pry'], ['leg', 'ven']], alerts: { leg: 1 } },
]

export const CLIENTS = ['Grupo Atria', 'Halvorsen', 'Orbe Retail', 'Cobalto', 'Nadir Foods', 'Vértice']
export const OWNERS = ['A. Moreno', 'L. Méndez', 'R. Gil', 'P. Ortega', 'S. Navarro', 'M. Ibarra', 'J. Serra', 'C. Vidal']
const STATUS: [string, string][] = [['Operativo', '#8CC265'], ['Atención', '#E3B058'], ['Incidencia', '#E07A8C']]

export const THEMES: Record<Theme, Record<string, string>> = {
  dark: { '--bg': '#0B0D10', '--surface': 'rgba(19,22,27,0.78)', '--surfaceSolid': '#14171C', '--surface2': 'rgba(255,255,255,0.05)', '--surface3': 'rgba(255,255,255,0.1)', '--line': 'rgba(255,255,255,0.08)', '--line2': 'rgba(255,255,255,0.2)', '--ink': '#EDEFF2', '--ink2': '#A3ABB5', '--ink3': '#6E7682', '--accent': '#CFF56A', '--accentInk': '#11150A', '--accentSoft': 'rgba(207,245,106,0.18)', '--accentLine': '#CFF56A', '--shadow': '0 18px 50px rgba(0,0,0,0.45)', '--shadowSm': '0 4px 14px rgba(0,0,0,0.35)', '--scrim': 'rgba(5,6,8,0.55)' },
  light: { '--bg': '#ECE9E2', '--surface': 'rgba(255,255,255,0.82)', '--surfaceSolid': '#FFFFFF', '--surface2': 'rgba(20,22,25,0.045)', '--surface3': 'rgba(20,22,25,0.09)', '--line': 'rgba(20,22,25,0.09)', '--line2': 'rgba(20,22,25,0.24)', '--ink': '#16181B', '--ink2': '#565C64', '--ink3': '#8B9097', '--accent': '#CFF56A', '--accentInk': '#11150A', '--accentSoft': 'rgba(127,162,28,0.2)', '--accentLine': '#7FA21C', '--shadow': '0 18px 44px rgba(60,50,30,0.14)', '--shadowSm': '0 3px 12px rgba(60,50,30,0.12)', '--scrim': 'rgba(236,233,226,0.6)' },
}

export interface SceneTheme {
  bg: string; ground: string; dots: string; dotsOp: number; bld: string; bld2: string; plinth: string; clad: string
  glass: string; win: number; glassT: string; glassTOp: number; metal: string; dark: string; floor: string; walk: string
  plateSide: string; asphalt: string; curb: string; mark: string; grass: string; leaf: string; leaf2: string; trunk: string
  water: string; white: string; hemiSky: string; hemiGround: string; hemi: number; dir: number; dirColor: string
  rim: number; rimColor: string; capGlow: number; accent: string; arcOp: number; person: string; env: number
  exposure: number; shade: number; glowOp: number; bloom: number
}

export const SCENE: Record<Theme, SceneTheme> = {
  dark: { bg: '#0C0E12', ground: '#172027', dots: '#ffffff', dotsOp: 0.05, bld: '#77858F', bld2: '#566673', plinth: '#29363E', clad: '#657580', glass: '#415C70', win: 0.32, glassT: '#a9bed6', glassTOp: 0.2, metal: '#A3ACB8', dark: '#181B21', floor: '#414E57', walk: '#4F5A61', plateSide: '#34424B', asphalt: '#25323B', curb: '#7F8B94', mark: '#5A626D', grass: '#203328', leaf: '#3D5843', leaf2: '#5F7E4D', trunk: '#685448', water: '#1C3142', white: '#CDD2D8', hemiSky: '#a9bad4', hemiGround: '#0c0e12', hemi: 0.62, dir: 2.75, dirColor: '#E6E9FF', rim: 0.55, rimColor: '#7d93ff', capGlow: 0.08, accent: '#CFF56A', arcOp: 0.85, person: '#CDD2D8', env: 0.62, exposure: 1.06, shade: 0.66, glowOp: 0.9, bloom: 0.18 },
  light: { bg: '#EEEDE9', ground: '#E2DFD7', dots: '#000000', dotsOp: 0.05, bld: '#D8D4CC', bld2: '#A7B2B8', plinth: '#929C9F', clad: '#BFC9D0', glass: '#657E8D', win: 0, glassT: '#dbe8f2', glassTOp: 0.3, metal: '#9CABB6', dark: '#454B54', floor: '#D5D2C9', walk: '#C9C7BF', plateSide: '#AEB7BA', asphalt: '#59636A', curb: '#C7CDD0', mark: '#FFFFFF', grass: '#7B8E67', leaf: '#557A4E', leaf2: '#7F9A5E', trunk: '#9A8A75', water: '#A9CBE0', white: '#FFFFFF', hemiSky: '#F3F6FA', hemiGround: '#B7AF9F', hemi: 0.58, dir: 3.05, dirColor: '#fff3e2', rim: 0.4, rimColor: '#e6eeff', capGlow: 0.035, accent: '#8DB42A', arcOp: 0.9, person: '#4A5059', env: 0.5, exposure: 0.94, shade: 0.5, glowOp: 0.45, bloom: 0 },
}

export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function fill(s: string, r: () => number, h?: number) {
  return s
    .replace('{n}', String(1000 + Math.floor(r() * 89000)))
    .replace('{c}', CLIENTS[Math.floor(r() * CLIENTS.length)])
    .replace('{d}', String(1 + Math.floor(r() * 8)))
    .replace('{h}', String(h || 0))
}

function spark(series: number[]) {
  const mn = Math.min(...series)
  const mx = Math.max(...series)
  const pts = series.map((v, i) => ((i / (series.length - 1)) * 100).toFixed(1) + ',' + (27 - ((v - mn) / (mx - mn || 1)) * 23).toFixed(1))
  return { line: pts.join(' '), area: '0,30 ' + pts.join(' ') + ' 100,30' }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const nowStr = (d = new Date()) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const searchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim()

export function getPreset(id: string | null | undefined) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0]
}

const deptCache: Record<string, Dept[]> = {}

/** Deterministic department data for a preset (seeded by preset + dept id). */
export function buildDepts(P: Preset): Dept[] {
  if (deptCache[P.id]) return deptCache[P.id]
  const list = P.depts.map((id): Dept => {
    const t = DT[id]
    const r = rng(hash(P.id + id))
    const head = Math.max(3, Math.round(P.size * (0.06 + r() * 0.12)))
    const st = STATUS[(P.alerts && P.alerts[id]) || 0]
    const kpis = t.kpis.map(([label, value, delta, good]) => {
      const up = !delta.startsWith('−')
      const ser: number[] = []
      let v = 0.5
      for (let j = 0; j < 20; j++) {
        v += (r() - 0.5) * 0.28 + (up ? 0.035 : -0.035)
        ser.push(v)
      }
      const sp = spark(ser)
      return { label, value: fill(value, r, P.size), delta: delta || 'estable', line: sp.line, area: sp.area, deltaColor: !delta ? 'var(--ink3)' : good ? '#7DB85A' : '#E07A8C' }
    })
    const dues = ['hoy', 'mañana', 'vie 16', 'lun 19', '28 oct', '4 nov']
    const procs = t.procs.map((n) => {
      const p = Math.round(15 + r() * 80)
      return { name: fill(n, r), pct: p + '%', meta: OWNERS[Math.floor(r() * OWNERS.length)] + ' · vence ' + dues[Math.floor(r() * dues.length)] }
    })
    const links = P.links
      .filter((l) => l.includes(id))
      .map((l) => ({ other: l[0] === id ? l[1] : l[0], dir: (l[0] === id ? 'salida' : 'entrada') as 'salida' | 'entrada' }))
    return { id, name: t.name, kind: t.kind, color: t.color, lead: t.lead, head, status: st[0], statusColor: st[1], kpis, procs, apps: t.apps, ev: t.ev, links }
  })
  deptCache[P.id] = list
  return list
}

export interface LiveEvent {
  id: string
  deptId: string
  text: string
  time: string
}

export function makeEvent(P: Preset, seed = false): LiveEvent {
  const ds = buildDepts(P)
  const d = ds[Math.floor(Math.random() * ds.length)]
  const tpl = d.ev[Math.floor(Math.random() * d.ev.length)]
  const time = seed ? nowStr(new Date(Date.now() - Math.random() * 90000)) : nowStr()
  return { id: Math.random().toString(36).slice(2), deptId: d.id, text: fill(tpl, Math.random, P.size), time }
}
