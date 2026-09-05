import { transformEntity } from "./cad-advanced.js";

export function importUnits(drawing, sourceUnit) {
  if (!["mm", "m"].includes(drawing.unit)) throw new Error("取込先の単位はmm/mのみ対応しています。");
  if (sourceUnit != null && !["mm", "m"].includes(sourceUnit)) throw new Error("取込元の単位はmm/mのみ対応しています。");
  const targetUnit = drawing.entities.length === 0 && sourceUnit ? sourceUnit : drawing.unit;
  const meters = { mm: 0.001, m: 1 };
  const factor = sourceUnit ? meters[sourceUnit] / meters[targetUnit] : 1;
  return {
    commands: targetUnit !== drawing.unit ? [{ op: "set_empty_drawing_unit", unit: targetUnit }] : [],
    convert: (entity) => {
      const converted = factor === 1 ? entity : transformEntity(entity, { scale: factor });
      const valid = (value) => typeof value === "number" ? Number.isFinite(value) : value && typeof value === "object" ? Object.values(value).every(valid) : true;
      if (!valid(converted)) throw new Error("単位換算後の座標または寸法が数値範囲を超えています。");
      return converted;
    },
    warnings: sourceUnit == null ? [`単位が未指定のため、座標を取込先の${drawing.unit}として解釈します。`] : [],
    sourceUnit, targetUnit, factor
  };
}

export function dxfUnit(header) {
  const value = header?.$INSUNITS;
  if (value == null || value === 0) return null;
  if (value === 4) return "mm";
  if (value === 6) return "m";
  throw new Error(`DXF INSUNITS=${value}は未対応です。mm(4)/m(6)で出力してください。`);
}
