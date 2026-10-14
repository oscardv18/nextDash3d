import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/** Shared, locally generated assets. No remote models or texture downloads. */
type Part = { geometry: THREE.BufferGeometry; color: string; matrix: THREE.Matrix4 }
export interface GeometryFactory {
  rb: (w: number, h: number, d: number, radius: number) => THREE.BufferGeometry
  cy: (top: number, bottom: number, h: number, segments: number) => THREE.BufferGeometry
}
const matrix = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))

export function coloredGeometry(parts: Part[]) {
  const geometries = parts.map(({ geometry, color, matrix: transform }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    g.applyMatrix4(transform)
    const tint = new THREE.Color(color)
    const values = new Float32Array(g.attributes.position.count * 3)
    const existing = g.attributes.color
    for (let i = 0; i < values.length; i += 3) {
      const vertex = i / 3
      values.set(existing ? [existing.getX(vertex) * tint.r, existing.getY(vertex) * tint.g, existing.getZ(vertex) * tint.b] : [tint.r, tint.g, tint.b], i)
    }
    g.setAttribute('color', new THREE.BufferAttribute(values, 3))
    return g
  })
  const result = mergeGeometries(geometries)!
  geometries.forEach((g) => g.dispose())
  result.userData.keep = true
  return result
}

export function branchGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const branch = (a: THREE.Vector3, b: THREE.Vector3, bottom: number, top: number) => {
    const delta = b.clone().sub(a)
    const g = new THREE.CylinderGeometry(top, bottom, delta.length(), 12, 1)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()))
    g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray())
    parts.push(g)
  }
  branch(new THREE.Vector3(), new THREE.Vector3(-0.015, 0.24, 0.015), 0.075, 0.055)
  branch(new THREE.Vector3(-0.015, 0.24, 0.015), new THREE.Vector3(0.04, 0.60, -0.025), 0.055, 0.035)
  branch(new THREE.Vector3(0.04, 0.60, -0.025), new THREE.Vector3(-0.035, 1.05, 0.015), 0.035, 0.016)
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3
    branch(new THREE.Vector3(Math.cos(angle) * 0.085, 0.018, Math.sin(angle) * 0.085), new THREE.Vector3(0, 0.19, 0), 0.021, 0.036)
  }
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + 0.3
    branch(new THREE.Vector3(0.02, 0.56 + i * 0.065, 0), new THREE.Vector3(Math.cos(angle) * 0.3, 1.02 + i * 0.035, Math.sin(angle) * 0.3), 0.025, 0.009)
  }
  const g = mergeGeometries(parts)!
  parts.forEach((part) => part.dispose())
  g.userData.keep = true
  return g
}

export function buildPremiumKit(factory: GeometryFactory) {
  const { rb, cy } = factory
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const parts: Part[] = []
  const add = (geometry: THREE.BufferGeometry, color: string, transform = matrix()) => parts.push({ geometry, color, matrix: transform })
  const B = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, radius = 0.015) => add(rb(w, h, d, radius), color, matrix(x, y, z))
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => add(box, color, matrix(x, y, z, w, h, d))
  const finish = () => { const g = coloredGeometry(parts); parts.length = 0; return g }
  const kit: Record<string, THREE.BufferGeometry> = {}
  const paint = '#F1F0E9', dark = '#252D36', steel = '#8D9BA8', glass = '#384F60', rubber = '#24272B', wood = '#B79770'

  // Cab-over delivery truck: upright cabin, sloping windscreen and separate chassis.
  B(0.42, 0.065, 0.49, 0, 0.085, 0, dark)
  const cabin = sideProfile([[-.185,.145],[.285,.145],[.295,.25],[.265,.315],[.17,.44],[-.18,.452],[-.185,.38]], 0.395, 0.012)
  add(cabin, paint)
  cabin.dispose()
  B(.41,.020,.38,0,.448,.005,paint,.014)
  B(0.42, 0.045, 0.055, 0, 0.09, 0.27, steel)
  bar(0.23, 0.06, 0.012, 0, 0.165, 0.294, dark)
  for (let i = 0; i < 3; i++) bar(0.21, 0.005, 0.014, 0, 0.174 + i * 0.016, 0.30, steel)
  for (const side of [-1, 1]) {
    B(0.08, 0.035, 0.02, side * 0.15, 0.19, 0.29, '#FFF0C8', 0.01)
    bar(0.008, 0.15, 0.23, side * 0.205, 0.155, -0.01, '#C4CCD1')
    bar(0.012, 0.015, 0.055, side * 0.212, 0.25, -0.07, dark)
    bar(0.04, 0.012, 0.035, side * 0.225, 0.37, 0.10, steel)
    B(0.025, 0.045, 0.045, side * 0.255, 0.352, 0.10, dark)
    const fender = wheelArch(0.094, 0.116, 0.022)
    add(fender, paint, matrix(side * 0.205, 0.087, 0.04))
    fender.dispose()
  }
  kit.cab = finish()
  add(rb(.345,.145,.012,.012),glass,matrix(0,.319,.267,1,1,1,-.60))
  for (const side of [-1, 1]) B(.01,.126,.25,side*.207,.315,-.025,glass,.008)
  kit.cabGlass = finish()

  // Cargo body, raised floor, door hardware, protective corners and reflectors.
  // Framed aluminium panels rather than a rounded solid toy container.
  bar(.39,.325,1.01,0,.20,0,'#DDE1DC')
  bar(.43,.024,1.06,0,.525,0,'#B9C3C8')
  for (const side of [-1,1]) {
    for (let bay=0;bay<6;bay++) {
      bar(.018,.30,.008,side*.205,.216,-.43+bay*.172,'#A6B2B9')
      bar(.012,.018,.14,side*.214,.25,-.36+bay*.172,'#E7E9E2')
    }
    const rearFender = wheelArch(.094,.117,.03)
    for (const z of [-.28,-.43]) add(rearFender,dark,matrix(side*.211,.087,z))
    rearFender.dispose()
    bar(.02,.04,.10,side*.218,.26,-.48,'#72838E')
    bar(.017,.10,.02,side*.18,.045,-.51,rubber)
  }
  for (const x of [-0.145, 0.145]) bar(0.035, 0.055, 1.08, x, 0.09, 0, dark)
  for (const z of [-0.43, -0.1, 0.23, 0.46]) bar(0.32, 0.035, 0.032, 0, 0.10, z, steel)
  bar(0.43, 0.025, 1.065, 0, 0.17, 0, steel)
  for (const side of [-1, 1]) {
    for (const y of [0.31, 0.44]) bar(0.012, 0.012, 0.98, side * 0.214, y, 0, '#DEE3E3')
    for (const z of [-0.52, 0.52]) bar(0.018, 0.36, 0.024, side * 0.206, 0.19, z, steel)
    for (let i = 0; i < 4; i++) bar(0.012, 0.015, 0.065, side * 0.217, 0.18, -0.4 + i * 0.26, '#D6A64D')
    bar(0.04, 0.018, 0.012, side * 0.155, 0.15, -0.548, '#B85950')
    bar(0.011, 0.30, 0.014, side * 0.07, 0.21, -0.533, dark)
  }
  bar(0.009, 0.34, 0.012, 0, 0.20, -0.534, dark)
  bar(0.42, 0.035, 0.035, 0, 0.085, -0.55, steel)
  kit.trailer = finish()

  // Wheel axis is X; its hub spokes rotate around X with travelled distance.
  add(cy(0.087, 0.087, 0.055, 16), rubber, matrix(-0.0275, 0, 0, 1, 1, 1, 0, 0, -Math.PI / 2))
  kit.wheelTyre = finish()
  add(cy(0.049, 0.049, 0.006, 12), steel, matrix(0.029, 0, 0, 1, 1, 1, 0, 0, -Math.PI / 2))
  add(cy(0.025, 0.025, 0.009, 10), dark, matrix(0.035, 0, 0, 1, 1, 1, 0, 0, -Math.PI / 2))
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5
    add(box, '#D1D8DD', matrix(0.037, Math.cos(a) * 0.030, Math.sin(a) * 0.030, 0.009, 0.022, 0.009, a, 0, 0))
  }
  kit.wheelHub = finish()
  kit.wheel = coloredGeometry([{geometry:kit.wheelTyre,color:'#FFFFFF',matrix:matrix()},{geometry:kit.wheelHub,color:'#FFFFFF',matrix:matrix()}])

  const staticWheels = (zs: number[]) => zs.flatMap((z) => [-1, 1].map((side) => ({ geometry: kit.wheel, color: '#FFFFFF', matrix: matrix(side * 0.208, 0.087, z, 1, 1, 1, 0, side < 0 ? Math.PI : 0, 0) })))
  kit.cabStatic = coloredGeometry([{ geometry: kit.cab, color: '#FFFFFF', matrix: matrix() }, { geometry: kit.cabGlass, color: '#FFFFFF', matrix: matrix() }, ...staticWheels([0.04])])
  kit.trailerStatic = coloredGeometry([{ geometry: kit.trailer, color: '#FFFFFF', matrix: matrix() }, ...staticWheels([-0.28, -0.43])])

  // Carton geometry is normalized, including seam, tape and shipping label.
  B(.985,.977,.985,0,0,0,'#C7B595',.013)
  for(const side of [-1,1]) {
    B(.48,.008,.98,side*.25,.977,0,side>0?'#CEBD9F':'#BEB093',.005)
    bar(.008,.965,.008,side*.483,.009,.493,'#A2967D')
  }
  bar(0.014, 0.007, 0.99, 0, 0.985, 0, '#846648')
  bar(0.13, 0.011, 0.99, 0, 0.99, 0, '#F1D9AF')
  for (const side of [-1, 1]) {
    bar(0.13, 0.19, 0.006, 0, 0.80, side * 0.496, '#F1D9AF')
    bar(0.20, 0.14, 0.008, 0.24, 0.40, side * 0.496, '#EDEAE1')
    bar(0.16, 0.025, 0.010, 0.24, 0.44, side * 0.50, '#605E58')
  }
  kit.carton = finish()
  B(0.99, 0.98, 0.99, 0, 0, 0, '#FFFFFF', 0.025)
  for (const side of [-1, 1]) {
    for (const z of [-0.48, 0.48]) bar(0.04, 1.0, 0.04, side * 0.48, 0, z, '#C5CFD5')
    bar(0.012, 0.95, 0.022, side * 0.20, 0.025, -0.503, '#737F89')
    for (let i = 0; i < 6; i++) bar(0.012, 0.92, 0.016, side * 0.499, 0.025, -0.36 + i * 0.145, '#CAD0D2')
  }
  bar(0.01, 0.95, 0.015, 0, 0.02, -0.503, '#69757F')
  kit.container = finish()

  // Tailored cross sections with jaw, nose, ears, cuffs and separate elbow/knee pivots.
  const torso = sectionMesh([[.226,.048,.027],[.25,.051,.029],[.31,.052,.030],[.36,.070,.034],[.385,.063,.030],[.397,.029,.022]])
  for (let style=0;style<6;style++) {
    add(torso, style===2 ? '#B0B8AA' : '#FFFFFF')
    const hip = sectionMesh([[.204,.047,.033],[.23,.050,.032],[.25,.047,.027]])
    add(hip,'#46515B'); hip.dispose()
    if (style===1 || style===4) {
      for (const side of [-1,1]) add(box,'#AEB8BA',matrix(side*.023,.319,.035,.026,.072,.006,0,0,side*-.27))
      bar(.005,.08,.004,0,.244,.032,'#27313A')
      if(style===4) bar(.084,.006,.010,0,.267,.032,'#B5BCBB')
    } else if (style===2) {
      for(const side of [-1,1]) bar(.012,.12,.007,side*.039,.258,.034,'#DDE1C4')
      bar(.10,.01,.007,0,.27,.034,'#DDE1C4')
    } else if(style===3) {
      const coat = sectionMesh([[.185,.066,.036],[.23,.056,.033],[.32,.057,.033],[.36,.071,.036],[.385,.063,.032],[.397,.030,.023]])
      add(coat,'#DCE0D7');coat.dispose()
      bar(.004,.19,.006,0,.19,.037,'#727F87')
      for(const side of [-1,1]) bar(.028,.031,.006,side*.035,.23,.037,'#BAC6C7')
    } else if(style===5) {
      bar(.10,.015,.071,0,.237,0,'#414C51')
      bar(.023,.027,.007,.032,.322,.037,'#9BAFA7')
      bar(.004,.145,.005,0,.245,.036,'#394C54')
    } else {
      for(const side of [-1,1]) add(box,'#CAD2CE',matrix(side*.013,.378,.026,.016,.020,.008,0,0,side*-.38))
      bar(.024,.036,.006,.032,.327,.036,'#A6B5BA')
    }
    if(style!==2 && style!==5) {
      const hair = sectionMesh(style===4 ? [[.427,.040,.033],[.462,.044,.035],[.491,.036,.031],[.509,.011,.012]] : [[.470,.038,.032],[.489,.041,.034],[.502,.032,.026],[.509,.009,.010]])
      add(hair,'#202521',matrix(0,0,-.010));hair.dispose()
      if(style===3) add(sphere,'#202521',matrix(0,.473,-.047,.027,.025,.020))
    }
    kit[['personBody','personBlazer','personVest','personCoat','personCardigan','personCoveralls'][style]] = finish()
  }
  torso.dispose()
  const head = sectionMesh([[.41,.019,.020],[.425,.032,.031],[.446,.040,.035],[.477,.041,.032],[.49,.034,.029],[.502,.018,.020]])
  add(head,'#DFB48F');head.dispose()
  add(cy(.018,.022,.035,8),'#DFB48F',matrix(0,.392,0))
  for(const side of [-1,1]) add(sphere,'#CFA980',matrix(side*.041,.454,0,.008,.012,.006))
  const nose = sectionMesh([[.442,.006,.004],[.454,.006,.009],[.462,.004,.004]])
  add(nose,'#D3A780',matrix(0,0,.033));nose.dispose()
  kit.personSkin = finish()
  kit.person = coloredGeometry([{geometry:kit.personBody,color:'#FFFFFF',matrix:matrix()},{geometry:kit.personSkin,color:'#FFFFFF',matrix:matrix()}])
  const upperArm = sectionMesh([[.008,.024,.025],[-.020,.026,.025],[-.065,.019,.019],[-.098,.017,.017]])
  add(upperArm,'#FFFFFF');upperArm.dispose();kit.arm=finish()
  const forearm = sectionMesh([[.006,.018,.018],[-.022,.019,.017],[-.062,.013,.014],[-.083,.013,.013]])
  add(forearm,'#FFFFFF');forearm.dispose()
  bar(.025,.010,.028,0,-.078,0,'#C4CAC7');kit.forearm=finish()
  const palm = sectionMesh([[-.076,.012,.012],[-.094,.014,.013],[-.115,.010,.011]])
  add(palm,'#DFB48F');palm.dispose()
  add(sphere,'#DFB48F',matrix(-.014,-.095,.009,.006,.012,.006));kit.hand=finish()
  const thigh = sectionMesh([[.008,.029,.030],[-.032,.028,.027],[-.075,.020,.022],[-.107,.019,.019]])
  add(thigh,'#586273');thigh.dispose();kit.leg=finish()
  const calf = sectionMesh([[.008,.019,.019],[-.032,.022,.019],[-.075,.015,.016],[-.090,.014,.016]])
  add(calf,'#586273');calf.dispose()
  B(.042,.025,.074,0,-.112,.016,'#252A32',.008)
  bar(.043,.006,.075,0,-.112,.016,'#171F24');kit.shin=finish()
  add(sphere,'#C9B780',matrix(0,.492,0,.049,.028,.046))
  B(.106,.007,.09,0,.485,.009,'#C9B780',.006);kit.helmet=finish()

  // Electric counterbalance forklift: sculpted shell, open footwell and tubular cage.
  const shell = sideProfile([[-.21,.065],[-.21,.17],[-.15,.23],[-.07,.24],[.02,.16],[.16,.14],[.19,.055]],.27,.012)
  // sideProfile travels Z: turn its long axis into the warehouse X axis.
  add(shell,'#CB9A3A',matrix(0,0,0,1,1,1,0,Math.PI/2));shell.dispose()
  B(.35,.035,.26,0,.05,0,dark,.01)
  B(.13,.038,.15,-.035,.205,0,dark,.008)
  add(rb(.028,.11,.15,.009),dark,matrix(-.09,.229,0,1,1,1,0,0,-.12))
  B(.12,.018,.16,.055,.095,0,steel,.006)
  for(const side of [-1,1]) {
    bar(.11,.028,.017,.065,.116,side*.12,dark)
    const guard=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.13,.20,side*.116),new THREE.Vector3(-.12,.46,side*.116),
      new THREE.Vector3(.12,.46,side*.116),new THREE.Vector3(.15,.17,side*.116),
    ]),8,.010,6,false)
    add(guard,dark);guard.dispose()
    for(const x of [-.13,.12]) {
      const r=x>0?.06:.055
      const tire = new THREE.LatheGeometry([new THREE.Vector2(r*.5,-.021),new THREE.Vector2(r*.88,-.023),new THREE.Vector2(r,-.014),new THREE.Vector2(r,.014),new THREE.Vector2(r*.88,.023),new THREE.Vector2(r*.5,.021)],16)
      add(tire,rubber,matrix(x,r,side*.133,1,1,1,Math.PI/2));tire.dispose()
      add(cy(r*.52,r*.52,.006,10),steel,matrix(x,r,side*.157,1,1,1,side>0?-Math.PI/2:Math.PI/2))
    }
    B(.023,.03,.027,.138,.395,side*.117,'#F1E6C4',.005)
  }
  for(let i=0;i<4;i++) bar(.018,.013,.23,-.08+i*.057,.465,0,steel)
  add(cy(.034,.034,.009,12),dark,matrix(.095,.29,0,1,1,1,0,0,-.7))
  kit.forkBody=finish()
  for(const side of [-1,1]) {
    bar(.033,.78,.036,.225,.035,side*.081,dark)
    bar(.014,.70,.014,.245,.085,side*.059,steel)
    bar(.018,.68,.008,.263,.11,side*.082,'#68747A')
  }
  for(const y of [.15,.74]) bar(.033,.025,.19,.225,y,0,steel)
  add(cy(.016,.016,.50,8),steel,matrix(.21,.11,0));kit.forkMast=finish()
  bar(.025,.19,.19,.25,.014,0,dark)
  for(const side of [-1,1]) {
    bar(.034,.15,.026,.28,.013,side*.064,steel)
    bar(.25,.015,.022,.37,.0382,side*.045,steel)
  }
  kit.forkCar=finish()

  // Functional furniture and equipment visible in the open departments.
  B(0.48, 0.035, 0.30, 0, 0.25, 0, wood)
  for (const x of [-0.20, 0.20]) bar(0.025, 0.25, 0.23, x, 0, 0, steel)
  bar(0.03, 0.08, 0.03, 0, 0.285, -0.04, dark)
  B(0.23, 0.14, 0.018, 0, 0.345, -0.05, dark)
  bar(0.20, 0.11, 0.004, 0, 0.36, -0.039, '#507784')
  B(0.19, 0.012, 0.07, 0, 0.285, 0.07, '#B5BFC6')
  kit.desk = finish()
  B(0.25, 0.73, 0.30, 0, 0, 0, dark)
  bar(0.21, 0.66, 0.012, 0, 0.04, 0.153, '#718492')
  for (let i = 0; i < 8; i++) {
    bar(0.18, 0.046, 0.019, 0, 0.055 + i * 0.077, 0.16, '#303D47')
    bar(0.012, 0.012, 0.020, 0.070, 0.073 + i * 0.077, 0.173, '#97D4C1')
  }
  kit.server = finish()
  B(0.25, 0.42, 0.18, 0, 0, 0, '#9BAAB3')
  B(0.21, 0.16, 0.022, 0, 0.27, 0.098, dark)
  bar(0.17, 0.11, 0.004, 0, 0.30, 0.112, '#5E8D98')
  bar(0.04, 0.015, 0.012, -0.055, 0.20, 0.104, '#BE655B')
  kit.console = finish()
  // Chamfered timber decks, real fork openings and bearing blocks.
  const timber = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
    const plank = chamferedSlab(w, h, d, 0.005)
    add(plank, color, matrix(x, y, z))
    plank.dispose()
  }
  for (let i = 0; i < 5; i++) timber(.42,.022,.055,0,.072,-.15+i*.075,['#978B74','#A69B85','#B0A189','#938872','#A49881'][i])
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) timber(0.06, 0.052, 0.06, -0.17 + i * 0.17, 0.02, -0.14 + j * 0.14, '#917953')
  for (let i = 0; i < 3; i++) timber(0.42, 0.020, 0.06, 0, 0, -0.14 + i * 0.14, '#A48963')
  kit.pallet = finish()
  // Continuous timber lamellae following a reclined seat/back profile.
  for(let slat=0;slat<7;slat++) {
    const t=slat/6, y=t<.55?.13:.13+(t-.55)*.25, z=.065-t*.15
    add(rb(.47,.016,.023,.005),slat%2?'#867A65':'#A29379',matrix(0,y,z,1,1,1,t<.55?0:-.34))
  }
  for(const side of [-1,1]) {
    const rail=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(side*.18,.01,.045),new THREE.Vector3(side*.18,.115,.04),
      new THREE.Vector3(side*.18,.12,-.04),new THREE.Vector3(side*.18,.245,-.08),
    ]),8,.009,6,false)
    add(rail,dark);rail.dispose()
    B(.06,.018,.12,side*.18,0,.016,dark,.006)
    bar(.019,.10,.018,side*.218,.114,-.026,dark)
    add(rb(.018,.017,.13,.005),steel,matrix(side*.218,.207,0,1,1,1,-.08))
  }
  kit.bench = finish()
  add(cy(.010,.021,.88,8),steel,matrix(0,.028,0))
  B(.085,.028,.085,0,0,0,dark,.007)
  const lightArm=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,.87,0),new THREE.Vector3(.025,.93,0),new THREE.Vector3(.17,.95,0),
  ]),5,.010,6,false)
  add(lightArm,steel);lightArm.dispose()
  B(.21,.027,.07,.13,.927,0,dark,.008)
  bar(.15,.005,.043,.13,.924,0,'#F3E4C6')
  for(let i=0;i<4;i++) bar(.012,.014,.065,.058+i*.045,.952,0,steel)
  kit.lamp = finish()
  B(0.10, 0.025, 0.10, 0, 0, 0, '#7F8990')
  add(cy(0.023, 0.026, 0.31, 10), dark, matrix(0, 0.025, 0))
  add(cy(0.024, 0.024, 0.035, 10), '#C5D0D4', matrix(0, 0.26, 0))
  kit.bollard = finish()
  B(0.16, 0.025, 0.12, 0, 0, 0, steel)
  bar(0.022, 0.47, 0.025, 0, 0.025, 0, steel)
  B(0.30, 0.19, 0.025, 0, 0.41, 0, dark)
  bar(0.24, 0.006, 0.006, 0, 0.445, 0.016, '#AABBBE')
  bar(0.11, 0.012, 0.007, -0.035, 0.505, 0.016, '#E5EADC')
  add(box, '#E5EADC', matrix(0.042, 0.495, 0.016, 0.014, 0.035, 0.007, 0, 0, -0.65))
  add(box, '#E5EADC', matrix(0.042, 0.520, 0.016, 0.014, 0.035, 0.007, 0, 0, -2.5))
  kit.wayfinding = finish()
  box.dispose(); sphere.dispose()
  return kit
}

export const ROAD_LEVEL = 0.63
export const LANE_RADIUS = 0.57
/** Constant-speed closed service loop, with tangent continuous through both turns. */
export function servicePose(distance: number, length: number, lane = LANE_RADIUS) {
  const turn = Math.PI * lane, total = length * 2 + turn * 2
  const d = ((distance % total) + total) % total
  if (d < length) return { x: lane, z: d, yaw: 0, total }
  if (d < length + turn) {
    const a = (d - length) / lane
    return { x: Math.cos(a) * lane, z: length + Math.sin(a) * lane, yaw: -a, total }
  }
  if (d < length * 2 + turn) return { x: -lane, z: length - (d - length - turn), yaw: -Math.PI, total }
  const a = Math.PI + (d - length * 2 - turn) / lane
  return { x: Math.cos(a) * lane, z: Math.sin(a) * lane, yaw: -a, total }
}

/** Beveled boxes use one subdivision per bevel; silhouettes stay smooth at map scale. */
export function bevelBox(w: number, h: number, d: number, radius: number) {
  const g = new RoundedBoxGeometry(w, h, d, 1, radius)
  g.translate(0, h / 2, 0)
  return g
}

/** Solid wedge: high edge at local -Z, low edge at +Z. */
export function entranceRamp(width: number, length: number, rise: number) {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0); shape.lineTo(length, 0); shape.lineTo(length, rise); shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-width / 2, 0, length / 2)
  geometry.userData.keep = true
  return geometry
}

function sideProfile(points: [number, number][], width: number, bevel = 0) {
  const shape = new THREE.Shape()
  points.forEach(([z, y], i) => i ? shape.lineTo(-z, y) : shape.moveTo(-z, y))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-width / 2, 0, 0)
  return geometry
}

function wheelArch(inner: number, outer: number, width: number) {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, outer, 0, Math.PI, false)
  shape.lineTo(-inner, 0)
  shape.absarc(0, 0, inner, Math.PI, 0, true)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 8 })
  g.rotateY(Math.PI / 2)
  g.translate(-width / 2, 0, 0)
  return g
}

function chamferedSlab(w: number, h: number, d: number, b: number) {
  const shape = new THREE.Shape()
  const points = [[-w/2+b,-d/2],[w/2-b,-d/2],[w/2,-d/2+b],[w/2,d/2-b],[w/2-b,d/2],[-w/2+b,d/2],[-w/2,d/2-b],[-w/2,-d/2+b]]
  points.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y))
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 })
  g.rotateX(-Math.PI / 2)
  return g
}

/** Elliptical stitched cross sections: convex anatomical/clothing profiles, not capsules. */
function sectionMesh(rings: number[][], segments = 10) {
  const positions: number[] = [], indices: number[] = [], uv: number[] = []
  for (const [y,rx,rz] of rings) for(let i=0;i<segments;i++) {
    const a=i*Math.PI*2/segments
    positions.push(Math.cos(a)*rx,y,Math.sin(a)*rz)
    uv.push(i/segments,y)
  }
  for(let r=0;r<rings.length-1;r++) for(let i=0;i<segments;i++) {
    const a=r*segments+i,b=r*segments+(i+1)%segments,c=a+segments,d=b+segments
    indices.push(a,b,c,b,d,c)
  }
  for(let i=1;i<segments-1;i++) indices.push(0,i+1,i,(rings.length-1)*segments,(rings.length-1)*segments+i,(rings.length-1)*segments+i+1)
  const g=new THREE.BufferGeometry()
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices)
  // Winding depends on descending/ascending Y; consistently orient outwards.
  if(rings[0][0] < rings[rings.length-1][0]) {
    const ix=g.index!.array
    for(let i=0;i<ix.length;i+=3) { const v=ix[i];ix[i]=ix[i+1];ix[i+1]=v }
  }
  g.computeVertexNormals();return g
}
