// Inventory group-code records before the permissive parser can drop unknown types.
// This is not a geometry parser. Child records are counted separately.
export function sourceEntityInventory(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length % 2) throw new Error("Incomplete DXF group pair");
  const types = Object.create(null), children = Object.create(null);
  let section = "", expectSection = false;
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d+\s*$/.test(lines[i])) throw new Error("Invalid DXF group code");
    const code = Number(lines[i]), value = lines[i + 1].trim();
    if (expectSection) {
      if (code !== 2) throw new Error("Missing DXF section name");
      section = value;
      expectSection = false;
      continue;
    }
    if (code !== 0) continue;
    if (value === "SECTION") { expectSection = true; continue; }
    if (value === "ENDSEC" || value === "EOF") { section = ""; continue; }
    if (section !== "ENTITIES") continue;
    const target = ["VERTEX", "ATTRIB", "SEQEND"].includes(value) ? children : types;
    target[value] = (target[value] ?? 0) + 1;
  }
  return { types: { ...types }, children: { ...children }, total: Object.values(types).reduce((sum, n) => sum + n, 0) };
}
