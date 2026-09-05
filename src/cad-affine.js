// Canvas/DXF planar affine convention: [a,b,c,d,tx,ty], column vectors.
export const IDENTITY = [1, 0, 0, 1, 0, 0];
export function affinePoint(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function composeAffine(a, b) {
  const p = affinePoint(a, { x: b[4], y: b[5] });
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], p.x, p.y];
}
export function inverseAffine(m) {
  const det = m[0]*m[3]-m[1]*m[2];
  if (!Number.isFinite(det) || det === 0) throw new Error("Singular BLOCK transform");
  const r = [m[3]/det, -m[1]/det, -m[2]/det, m[0]/det, 0, 0];
  const p = affinePoint(r, { x: -m[4], y: -m[5] });
  return [...r.slice(0, 4), p.x, p.y];
}
export function blockAffine(reference) {
  const t = (reference.rotation ?? 0) * Math.PI / 180;
  const x = (reference.scale ?? 1) * (reference.axisScale?.x ?? 1);
  const y = (reference.scale ?? 1) * (reference.axisScale?.y ?? 1);
  return [Math.cos(t)*x, Math.sin(t)*x, -Math.sin(t)*y, Math.cos(t)*y, reference.insertion.x, reference.insertion.y];
}
export function textAffine(entity) {
  const t = (entity.rotation ?? 0)*Math.PI/180, h = entity.size;
  const x = h*(entity.widthFactor ?? 1)*((entity.generationFlags ?? 0)&2 ? -1 : 1);
  const y = h*((entity.generationFlags ?? 0)&4 ? -1 : 1), shear = Math.tan((entity.oblique ?? 0)*Math.PI/180);
  return [Math.cos(t)*x, Math.sin(t)*x, (Math.cos(t)*shear-Math.sin(t))*y, (Math.sin(t)*shear+Math.cos(t))*y, entity.at.x, entity.at.y];
}
export function affineText(entity, matrix) {
  const m = composeAffine(matrix, textAffine(entity));
  const width = Math.hypot(m[0], m[1]), det = m[0]*m[3]-m[1]*m[2];
  const height = Math.abs(det)/width, sign = det < 0 ? -1 : 1;
  if (!(height > 0) || !Number.isFinite(height)) throw new Error("Invalid transformed text");
  return { ...entity, at: { x: m[4], y: m[5] }, size: height, rotation: Math.atan2(m[1], m[0])*180/Math.PI,
    widthFactor: width/height, oblique: Math.atan((m[0]*m[2]+m[1]*m[3])/(width*height*sign))*180/Math.PI, generationFlags: sign < 0 ? 4 : 0 };
}

export function affineEntity(entity, matrix) {
  const next = structuredClone(entity);
  if (entity.type === "text") return affineText(next, matrix);
  if (entity.points) next.points = entity.points.map((p) => affinePoint(matrix, p));
  if (entity.controlPoints) next.controlPoints = entity.controlPoints.map((p) => affinePoint(matrix, p));
  if (["circle", "arc", "ellipse"].includes(entity.type)) {
    const rotation = (entity.rotation ?? 0)*Math.PI/180;
    const rx = entity.radius ?? entity.radiusX, ry = entity.radius ?? entity.radiusY;
    const m = composeAffine(matrix, [rx*Math.cos(rotation), rx*Math.sin(rotation), -ry*Math.sin(rotation), ry*Math.cos(rotation), entity.center.x, entity.center.y]);
    // Principal axes of M M^T; determinant gives the minor radius stably.
    const p = m[0]**2+m[2]**2, q = m[0]*m[1]+m[2]*m[3], r = m[1]**2+m[3]**2;
    const angle = 0.5*Math.atan2(2*q, p-r), major = Math.sqrt((p+r+Math.hypot(p-r, 2*q))/2);
    const det = m[0]*m[3]-m[1]*m[2], minor = Math.abs(det)/major;
    if (!(minor > 0) || !Number.isFinite(major)) throw new Error("Invalid transformed conic");
    const start = entity.type === "arc" ? entity.startAngle*Math.PI/180 : entity.startParameter ?? 0;
    const end = entity.type === "arc" ? entity.endAngle*Math.PI/180 : entity.endParameter ?? Math.PI*2;
    const parameter = (t) => {
      const x = m[0]*Math.cos(t)+m[2]*Math.sin(t), y = m[1]*Math.cos(t)+m[3]*Math.sin(t);
      return Math.atan2((-Math.sin(angle)*x+Math.cos(angle)*y)/minor, (Math.cos(angle)*x+Math.sin(angle)*y)/major);
    };
    let a = parameter(det < 0 ? end : start), b = parameter(det < 0 ? start : end);
    if (entity.type === "circle" || Math.abs(end-start) >= Math.PI*2-1e-12) b = a+Math.PI*2;
    else while (b <= a) b += Math.PI*2;
    delete next.radius; delete next.startAngle; delete next.endAngle;
    Object.assign(next, { type: "ellipse", center: { x: m[4], y: m[5] }, radiusX: major, radiusY: minor, rotation: angle*180/Math.PI, startParameter: a, endParameter: b });
  }
  return next;
}

// Compose the entire hierarchy before resolving leaves: rotated nonuniform
// INSERTs can produce shear, which cannot be represented by another INSERT.
export function blockWorldEntities(reference, parent = IDENTITY) {
  const matrix = composeAffine(parent, blockAffine(reference));
  return (reference.children ?? []).flatMap((child) => child.type === "block" ? blockWorldEntities(child, matrix) : [affineEntity(child, matrix)]);
}
