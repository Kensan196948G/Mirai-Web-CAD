import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createDrawing, applyTransaction } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
import { exportDxf } from "../src/dxf-export.js";
import { transformEntity } from "../src/cad-advanced.js";

const input = process.argv[2] ?? "DXF-Test-Corpus", output = process.argv[3] ?? "artifacts/native-block-corpus";
const rejected = new Set(["block_09_mirrored.dxf", "block_10_mixed.dxf"]);
const transform = { dx: 1.25, dy: -2.5, angle: 15, scale: 1.2 };
const results = [];
await mkdir(output, { recursive: true });
for (const folder of ["03_block", "04_attribute_block"]) {
  for (const file of (await readdir(path.join(input, folder))).filter((file) => file.endsWith(".dxf")).sort()) {
    const source = path.join(folder, file);
    try {
      const drawing = createDrawing();
      const content = await readFile(path.join(input, source), "utf8");
      const parsed = parseCadImport({ filename: file, content, drawing, currentLayerId: drawing.layers[0].id });
      const imported = applyTransaction(drawing, { commands: parsed.commands });
      if (!imported.ok) throw new Error(imported.error);
      const before = exportDxf(imported.drawing);
      if (before.skipped.length) throw new Error("Unexpected skipped entities");
      const commands = imported.drawing.entities.filter((entity) => entity.definitionId).map((entity) => {
        const patch = transformEntity(entity, transform);
        if (patch.attributeReferences.length) patch.attributeReferences[0].value += " / edited";
        return { op: "update", id: entity.id, patch };
      });
      const modified = applyTransaction(imported.drawing, { commands });
      if (!modified.ok) throw new Error(modified.error);
      const after = exportDxf(modified.drawing);
      if (after.skipped.length) throw new Error("Unexpected skipped edited entities");
      await writeFile(path.join(output, `before-${file}`), before.content);
      await writeFile(path.join(output, `after-${file}`), after.content);
      const expected = !rejected.has(file);
      results.push({ source, file, accepted: true, expected, warnings: before.warnings });
    } catch (error) {
      results.push({ source, file, accepted: false, expected: rejected.has(file) && /鏡像/.test(error.message), error: error.message });
    }
  }
}
const report = { scope: "limited-native-block-geometry-and-attributes", fullCompatibility: false, transform, results };
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(`Native block import/export: ${results.filter((result) => result.accepted).length}/${results.length} accepted; not full compatibility.`);
if (results.length !== 20 || results.some((result) => !result.expected)) process.exitCode = 1;
