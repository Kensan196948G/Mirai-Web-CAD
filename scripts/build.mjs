import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "src"), { recursive: true });

for (const file of ["index.html"]) {
  await cp(path.join(root, file), path.join(dist, file));
}

for (const file of ["app.js", "cad-core.js", "storage.js", "styles.css"]) {
  await cp(path.join(root, "src", file), path.join(dist, "src", file));
}

console.log(`build ok: ${path.relative(root, dist)}`);
