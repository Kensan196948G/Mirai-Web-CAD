import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createDrawing, applyTransaction } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
import { exportDxf } from "../src/dxf-export.js";
import { transformEntity } from "../src/cad-advanced.js";
import { blockReference, resolveBlocks } from "../src/cad-block.js";

const input = process.argv[2] ?? "DXF-Test-Corpus", output = process.argv[3] ?? "artifacts/native-block-corpus";
const rejected = new Set();
const transform = { dx: 1.25, dy: -2.5, angle: 15, scale: 1.2 };
const results = [];
let sourceEditDrawing;
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
      if (file === "block_01_simple.dxf") sourceEditDrawing = structuredClone(imported.drawing);
      const before = exportDxf(imported.drawing);
      if (before.preservation?.mode !== "source-patch" || before.content !== content) throw new Error("Unedited source preservation failed");
      if (before.skipped.length) throw new Error("Unexpected skipped entities");
      const commands = imported.drawing.entities.filter((entity) => entity.definitionId).map((entity) => {
        const patch = transformEntity(entity, transform);
        if (patch.attributeReferences.length) patch.attributeReferences[0].value += " / edited";
        return { op: "update", id: entity.id, patch };
      });
      const modified = applyTransaction(imported.drawing, { commands });
      if (!modified.ok) throw new Error(modified.error);
      const after = exportDxf(modified.drawing);
      if (after.preservation?.mode !== "source-patch") throw new Error(`Edited source preservation failed: ${after.warnings.join(" / ")}`);
      if (after.skipped.length) throw new Error("Unexpected skipped edited entities");
      await writeFile(path.join(output, `before-${file}`), before.content);
      await writeFile(path.join(output, `after-${file}`), after.content);
      const expected = !rejected.has(file);
      results.push({ source, file, accepted: true, expected, warnings: before.warnings, preservation: { before: before.preservation, after: after.preservation } });
    } catch (error) {
      results.push({ source, file, accepted: false, expected: rejected.has(file) && /鏡像/.test(error.message), error: error.message });
    }
  }
}
if (!sourceEditDrawing) throw new Error("Missing source-edit fixture");
const template = sourceEditDrawing.blockDefinitions[0];
const added = structuredClone(template);
added.id = "source-edit-definition"; added.name = "SOURCE_EDIT_ADDED"; delete added.dxfRecordId;
added.entities = added.entities.map((entity, index) => ({ ...entity, id: `source-edit-child-${index}`, dxfRecordId: undefined }));
sourceEditDrawing.blockDefinitions.push(added);
sourceEditDrawing.entities.push(blockReference(sourceEditDrawing.entities[0].layerId, added.id, { x: 75, y: 50 }, { axisScale: { x: -2, y: 3 } }));
resolveBlocks(sourceEditDrawing);
const sourceEditOutput = exportDxf(sourceEditDrawing);
if (sourceEditOutput.preservation?.mode !== "source-patch") throw new Error("Source edit fixture did not preserve source");
await writeFile(path.join(output, "source-edits.dxf"), sourceEditOutput.content);
const report = { scope: "limited-native-block-geometry-and-attributes", fullCompatibility: false, transform, results,
  sourceEdits: { file: "source-edits.dxf", preservation: sourceEditOutput.preservation } };
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(`Native block import/export: ${results.filter((result) => result.accepted).length}/${results.length} accepted; not full compatibility.`);
if (results.length !== 20 || results.some((result) => !result.expected)) process.exitCode = 1;
