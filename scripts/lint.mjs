import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const required = [
  "index.html",
  "src/app.js",
  "src/cad-core.js",
  "src/storage.js",
  "src/styles.css",
  "migrations/0001_initial.sql",
  "migrations/0002_idempotency.sql",
  "migrations/0003_drawing_revision.sql",
  "seeds/demo.sql",
  "playwright.config.js",
  "tsconfig.check.json"
];

const failures = [];

for (const file of required) {
  try {
    const content = await readFile(path.join(root, file), "utf8");
    if (content.trim().length === 0) failures.push(`${file}: empty file`);
  } catch {
    failures.push(`${file}: missing`);
  }
}

const checkDirs = ["src", "functions", "tests", "scripts"];
for (const file of (await Promise.all(checkDirs.map((dir) => jsFiles(path.join(root, dir))))).flat()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`${path.relative(root, file)}: ${result.stderr || result.stdout}`);
  }
}

const css = await readFile(path.join(root, "src/styles.css"), "utf8");
const forbidden = ["TODO", "FIXME"];
for (const token of forbidden) {
  if (css.includes(token)) failures.push(`src/styles.css: unresolved marker ${token}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("lint ok");

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await jsFiles(full)));
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}
