// Optimise exported GLB assets for the web: prune, weld, resample animation,
// quantise vertex data and apply meshopt compression (EXT_meshopt_compression).
//
//   node scripts/assets/optimize.mjs <in.glb> [...more] --out <dir> [--palette]
//
// --palette: merge every solid-colour material of a mesh into one PBR material backed by
// tiny palette textures (base colour, emissive, metal/roughness), then join primitives.
// One draw call per mesh instead of one per material slot. Not for textured assets.
import { basename, join as joinPath } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, join, palette, prune, quantize, resample, weld, meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
if (outIndex < 0) throw new Error('missing --out <dir>')
const out = args[outIndex + 1]
const usePalette = args.includes('--palette')
const inputs = args.filter((a, i) => i !== outIndex && i !== outIndex + 1 && a !== '--palette')

/** Drop UVs that no texture uses, so palette() may take over the material. */
const stripUnusedUVs = () => (doc) => {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial()
    const textured = m && (m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getEmissiveTexture())
    if (!textured) for (const sem of ['TEXCOORD_0', 'TEXCOORD_1']) if (prim.getAttribute(sem)) prim.setAttribute(sem, null)
  }
}

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
})

for (const input of inputs) {
  const doc = await io.read(input)
  if (usePalette) await doc.transform(stripUnusedUVs(), palette({ min: 2 }), join({ keepMeshes: true, cleanup: false }))
  await doc.transform(
    dedup(),
    // Keep empty nodes (wheel mounts are named empties) and UVs: textures are bound at runtime.
    prune({ keepLeaves: true, keepAttributes: true }),
    weld(),
    resample({ tolerance: 1e-4 }),
    // Positions/normals quantised to 14/10 bits are invisible at map scale.
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 12 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  const target = joinPath(out, basename(input))
  await io.write(target, doc)
  const { size } = await import('node:fs').then((fs) => fs.statSync(target))
  console.log(`${basename(input)} -> ${(size / 1024).toFixed(0)} KB`)
}
