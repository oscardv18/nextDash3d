#!/usr/bin/env bash
# Rebuild every world asset from source into public/assets/world.
# Requires: Blender >= 4.2 on PATH, Python 3 with Pillow, network access for the
# Poly Haven texture download (cached in $CACHE).
set -euo pipefail
cd "$(dirname "$0")/../.."
RAW="${RAW:-$(mktemp -d)}"
CACHE="${CACHE:-$HOME/.cache/arxnet-assets/polyhaven}"
OUT=public/assets/world
mkdir -p "$OUT/textures" "$CACHE"

echo "== textures (Poly Haven CC0 + painted leaf cards)"
python3 scripts/assets/build_textures.py "$CACHE" "$OUT/textures"

echo "== trees (vendored ez-tree, MIT)"
node scripts/assets/build-trees.mjs "$RAW"

echo "== people (Quaternius CC0)"
blender -b --factory-startup --python scripts/assets/blender_people.py -- scripts/assets/sources/people "$RAW"

echo "== vehicles and props (modelled in Blender)"
blender -b --factory-startup --python scripts/assets/blender_vehicles.py -- "$RAW"
blender -b --factory-startup --python scripts/assets/blender_props.py -- "$RAW"

echo "== optimise"
node scripts/assets/optimize.mjs "$RAW"/tree_*.glb "$RAW"/person_*.glb --out "$OUT"
node scripts/assets/optimize.mjs "$RAW"/vehicle_*.glb "$RAW"/forklift.glb "$RAW"/pallet.glb "$RAW"/carton.glb \
  "$RAW"/container.glb "$RAW"/rack.glb "$RAW"/street_lamp.glb "$RAW"/bench.glb "$RAW"/bollard.glb --out "$OUT" --palette
du -sh "$OUT"
