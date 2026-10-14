# ez-tree (vendored, build-time only)

Procedural tree generator by Daniel Greenheck, MIT licence (see LICENSE).
Source: https://github.com/dgreenheck/ez-tree (npm `@dgreenheck/ez-tree` 1.1.0).

Only the geometry generator is used, at build time, by `scripts/assets/build-trees.mjs`.
Changes: import paths gain `.js` extensions for Node; the bundled bark/leaf textures and
preset loader are removed (Arxnet ships its own CC0 bark and self-made leaf textures).
None of this code is shipped to the browser.
