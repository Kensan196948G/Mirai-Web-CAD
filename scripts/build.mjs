import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "src"), { recursive: true });

for (const file of ["index.html", "_headers"]) {
  await cp(path.join(root, file), path.join(dist, file));
}

await cp(path.join(root, "src", "styles.css"), path.join(dist, "src", "styles.css"));
await build({
  entryPoints: [path.join(root, "src", "app.js")],
  outfile: path.join(dist, "src", "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  legalComments: "none"
});

console.log(`build ok: ${path.relative(root, dist)}`);
