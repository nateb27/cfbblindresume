/**
 * The committed glyph atlas (scripts/fn-build-atlas.mjs), indexed once per isolate. Workers-only
 * entry point: the `.bin` import is a wrangler Data module. Tests load the same files with fs.
 */
import atlasBin from './atlas.bin';
import atlasJson from './atlas.json';
import { loadAtlas, type Atlas, type AtlasJson } from './atlas';

let atlas: Atlas | null = null;

export function getAtlas(): Atlas {
  if (!atlas) atlas = loadAtlas(atlasJson as AtlasJson, atlasBin);
  return atlas;
}
