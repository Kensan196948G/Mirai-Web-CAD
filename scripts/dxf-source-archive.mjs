import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createDxfSourceDocument, restoreDxfSourceDocument, inspectDxfSourceDocument, inspectDxfBlocks } from "../src/dxf-source-document.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [command, inputArg, outputArg] = process.argv.slice(2);
try {
  if (!inputArg || !outputArg || !["pack", "restore"].includes(command)) {
    throw new Error("Usage: dxf-source-archive.mjs pack <DXF-directory> <archive-directory> | restore <archive.json> <output.dxf>");
  }
  const input = path.resolve(inputArg), output = path.resolve(outputArg);
  if (command === "restore") {
    const archive = JSON.parse(await readFile(input, "utf8"));
    const bytes = Buffer.from(restoreDxfSourceDocument(archive.document), "utf8");
    if (hash(bytes) !== archive.sha256 || bytes.length !== archive.bytes) throw new Error("Archive checksum mismatch");
    await writeFile(output, bytes, { flag: "wx" });
    console.log(`Restored original DXF: ${output} (not an edited drawing export)`);
  } else {
    if (input === output) throw new Error("Archive directory must differ from input");
    const results = [];
    async function visit(dir) {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (file === output || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await visit(file); continue; }
        if (!entry.isFile() || !/\.dxf$/i.test(file)) continue;
        const relative = path.relative(input, file);
        try {
          const bytes = await readFile(file);
          const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          const document = createDxfSourceDocument(source);
          const archive = { sha256: hash(bytes), bytes: bytes.length, document };
          const serialized = JSON.stringify(archive);
          const restored = Buffer.from(restoreDxfSourceDocument(JSON.parse(serialized).document), "utf8");
          if (!restored.equals(bytes)) throw new Error("Source bytes changed during archive roundtrip");
          const inspection = inspectDxfSourceDocument(document);
          let blocks, blockError;
          try { blocks = inspectDxfBlocks(document); } catch (error) { blockError = error.message; }
          const target = path.join(output, `${relative}.source.json`);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, serialized);
          results.push({ file: relative, sha256: archive.sha256, bytes: bytes.length, preserved: true,
            sections: inspection.sections.map((section) => section.name), records: inspection.records.length,
            blockDefinitions: blocks?.definitions.length, blockReferences: blocks?.references.length,
            attributeDefinitions: blocks?.definitions.reduce((sum, block) => sum + block.attributeDefinitions.length, 0),
            attributes: blocks?.references.reduce((sum, reference) => sum + reference.attributes.length, 0),
            diagnostics: blocks?.diagnostics, blockError });
        } catch (error) {
          results.push({ file: relative, preserved: false, error: error.message });
        }
      }
    }
    await visit(input);
    await mkdir(output, { recursive: true });
    const report = { scope: "source-archive-only", editableCompatibilityCertified: false,
      total: results.length, preserved: results.filter((result) => result.preserved).length, results };
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Source archive byte equality: ${report.preserved}/${report.total}. This is NOT CAD compatibility certification.`);
    if (!results.length || report.preserved !== report.total) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
