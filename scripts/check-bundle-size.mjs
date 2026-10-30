// Fails the build when any JavaScript chunk in dist/assets is over the gzip budget (default 250 kB).
// Run after `vite build` (the `build` script does). Override with MAX_CHUNK_GZIP_KB.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const dir = "dist/assets";
const budget = Number(process.env.MAX_CHUNK_GZIP_KB ?? 250) * 1000;
let failed = false;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const size = gzipSync(readFileSync(join(dir, f))).length;
  const kb = (size / 1000).toFixed(1);
  const over = size > budget;
  failed ||= over;
  console.log(`${over ? "OVER " : "ok   "} ${f}  ${kb} kB gzip`);
}
if (failed) {
  console.error(
    `A chunk is over the ${budget / 1000} kB gzip budget. Split the route with lazy().`,
  );
  process.exit(1);
}
