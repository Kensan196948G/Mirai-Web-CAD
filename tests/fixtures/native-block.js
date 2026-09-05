import { createDrawing, line, circle } from "../../src/cad-core.js";
import { blockReference, resolveBlocks } from "../../src/cad-block.js";

export function nativeBlockDrawing() {
  const drawing = createDrawing({ unit: "mm" });
  drawing.layers.push({ id: "zero", name: "0", color: "#ff0000", visible: true, locked: false, printable: true });
  const attribute = { id: "attr", tag: "番号", value: "測点A", prompt: "番号", at: { x: 10, y: -20 }, size: 15, rotation: 10, flags: 0, layerId: "zero", styleName: "STANDARD" };
  drawing.blockDefinitions = [
    { id: "inner", name: "INNER", basePoint: { x: 10, y: 20 }, entities: [line("zero", [10, 20], [110, 20]), circle("layer-structure", [60, 60], 15)], attributeDefinitions: [{ ...attribute, at: { x: 20, y: 0 } }] },
    { id: "outer", name: "OUTER", basePoint: { x: 0, y: 0 }, entities: [blockReference("zero", "inner", { x: 50, y: 50 }, { attributeReferences: [attribute] })], attributeDefinitions: [] }
  ];
  drawing.entities = [blockReference("layer-structure", "outer", { x: 400, y: 400 }, { id: "outer-ref", rotation: 30, scale: 2 }),
    blockReference("layer-structure", "inner", { x: 1000, y: 500 }, { id: "inner-ref", attributeReferences: [attribute, { ...attribute, id: "attr2", value: "測点B", at: { x: 10, y: -40 } }] })];
  resolveBlocks(drawing);
  return drawing;
}
