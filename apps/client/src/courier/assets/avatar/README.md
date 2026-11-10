# Messenger avatar source assets

These files preserve decoded public source assets from https://messenger.abeto.co/. Geometry was decoded offline with the installed Three.js Draco decoder. This package contains base, short hair (hair3), hoodie (top2), trousers (bottom2), and sneakers (shoes3).

| Packaged file | Original source | SHA256 of original source bytes |
| --- | --- | --- |
| base.json | https://messenger.abeto.co/assets/geometries/avatar/accessories/base.drc | 68f1cd0c8e4e6ba4992ff59592555f169f21cfdaaf3cc623075be26fb4474556 |
| hair3.json | https://messenger.abeto.co/assets/geometries/avatar/accessories/hair3.drc | c43c6a456dbefe30f9a92247e2e29509fffe9c45ccc0f34d8525b5a6efa0c52d |
| top2.json | https://messenger.abeto.co/assets/geometries/avatar/accessories/top2.drc | 1f2cc60b04331099f2507950bc41a70a3e8f4e0fcfd7e17165b590a7818f0036 |
| bottom2.json | https://messenger.abeto.co/assets/geometries/avatar/accessories/bottom2.drc | 98f3aa91e5563547516b66333033326f2680996c502906fe251fd43011f6e144 |
| shoes3.json | https://messenger.abeto.co/assets/geometries/avatar/accessories/shoes3.drc | 83407fc6b982bc06a2ad720ed4f3540fc1d855db0e5d3d8262bce7d2100139c5 |
| rig.json | https://messenger.abeto.co/assets/geometries/avatar/avatar-bones.drc | d08c4ef50e835c7cf189ff5d1f89e7e02989640a3a7cfbeb6fe3c05c335780ba |
| idle-pose.json (frame 0) | https://messenger.abeto.co/assets/geometries/avatar/avatar-idle.drc | a99361950e8ac98d99347de55dc1e158e6d795c910ba02c051a53f53e03458d9 |
| public/characters/atlas.png | https://messenger.abeto.co/assets/images/atlas.png | 442a9b765987dcab366cbb26aac58592106aa5cbf8b1c710413e5010e2596a86 |
| public/characters/eye.ktx2 | https://messenger.abeto.co/assets/images/mainchar-eye-highq.ktx2 | 9ff8dfa81d9435ffbec2bbed6444baacc3935432deee812d073d2aa3f47f8857 |

Mesh JSON retains every original point attribute (position, normal, uv, skinIndex, skinWeight, surfaceId), indices, embedded metadata, bounds, source URL, original byte count, and original SHA256. Attributes use numeric arrays plus itemSize, normalized, and Draco dataType. Geometry positions use reference units and the shared bind pose; bone indices are unchanged. UV values outside 0–1 are intentional and select the animated eye texture in the reference shader. surfaceId is a random per-surface float, not a palette color index.

rig.json includes all 22 local bone transforms, parent indices, normalized quaternions, and derived column-major bind/world/inverse matrices. Bone role names are inferred from hierarchy and spatial position; they were not provided as source names. idle-pose.json contains local transforms from animation frame 0 plus derived world positions; it should be applied after the rig is bound. The texture files are byte-for-byte copies, with eye.ktx2 renamed from mainchar-eye-highq.ktx2. The source atlas uses nearest filtering and sRGB; the eye texture uses repeat wrapping.

Reproducible mesh decoder: artifacts/messenger-right/reference-data.mjs. Canonical inspection assets and original compressed bytes are retained in .claude/abeto-messenger/character-reference-assets/. No reduction, retopology, proportion edits, or baked pose deformation was applied to these packaged data files.

The synchronous eye-mask.json contains the red channel of mip 0 (256×64), decoded by the installed Basis Universal transcoder to RGBA32 and then extracted without resizing, recoloring, or row reordering. The original KTX2 uses UASTC 4×4 blocks with Zstd supercompression, not raw R8 bytes. Pixel data SHA256: 15f07625743776455ed9b6de394770f0af8a47378e8749d0a36934ece0956632.

palette.json preserves the atlas PNG's 16×16 top-down RGBA bytes, obtained by zlib scanline decoding, PNG filter reversal, and exact indexed PLTE/tRNS expansion. RGBA SHA256: 80bfafce869023679524ae0a957425e75387b96e9018f4f98e644c6246809e56. A Three.js DataTexture should use RGBAFormat, SRGBColorSpace, nearest filtering, and flipY=true to match TextureLoader's PNG orientation.
