const EPSILON = 1e-9;

export const DEFAULT_LAYERS = [
  { id: "layer-frame", name: "図枠", color: "#5b6b7a", visible: true, locked: false, printable: true },
  { id: "layer-center", name: "中心線", color: "#d14f4f", visible: true, locked: false, printable: true },
  { id: "layer-structure", name: "構造物", color: "#1574b8", visible: true, locked: false, printable: true },
  { id: "layer-temporary", name: "仮設", color: "#1e946f", visible: true, locked: false, printable: true },
  { id: "layer-annotation", name: "注記", color: "#a26a1d", visible: true, locked: false, printable: true }
];

export const ROLE_POLICIES = {
  viewer: { label: "閲覧者", canEdit: false, canApprove: false, canRunAi: false },
  drafter: { label: "作図者", canEdit: true, canApprove: false, canRunAi: true },
  reviewer: { label: "レビュアー", canEdit: false, canApprove: false, canRunAi: true },
  approver: { label: "承認者", canEdit: false, canApprove: true, canRunAi: false },
  cad_admin: { label: "CAD管理者", canEdit: true, canApprove: true, canRunAi: true }
};

export function createDrawing(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: overrides.id ?? "dwg_demo_001",
    name: overrides.name ?? "道路拡幅 仮設施工図 MVP",
    unit: overrides.unit ?? "mm",
    version: overrides.version ?? 1,
    revision: overrides.revision ?? 1,
    state: overrides.state ?? "draft",
    currentRole: overrides.currentRole ?? "drafter",
    layers: structuredClone(DEFAULT_LAYERS),
    entities: [],
    comments: [],
    commandEvents: [],
    auditLog: [
      {
        id: "audit_seed",
        at: now,
        actor: "system",
        action: "drawing.seeded",
        detail: "MVP demo drawing created"
      }
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function seedDrawing() {
  const drawing = createDrawing({ revision: 0 });
  const entities = [
    line("layer-frame", [0, 0], [12000, 0], { id: "e_frame_1" }),
    line("layer-frame", [12000, 0], [12000, 7000], { id: "e_frame_2" }),
    line("layer-frame", [12000, 7000], [0, 7000], { id: "e_frame_3" }),
    line("layer-frame", [0, 7000], [0, 0], { id: "e_frame_4" }),
    line("layer-center", [500, 3500], [11500, 3500], { id: "e_center_1", lineDash: [18, 12] }),
    rect("layer-structure", [2200, 2400], 3600, 2200, { id: "e_box_1" }),
    circle("layer-temporary", [8200, 3500], 980, { id: "e_crane_1" }),
    polyline("layer-temporary", [[6600, 1800], [9800, 1800], [10800, 5200], [7200, 5600]], {
      id: "e_yard_1",
      closed: true
    }),
    text("layer-annotation", [720, 6500], "Mirai Web CAD MVP / Preview Required", {
      id: "e_note_1",
      size: 280
    }),
    text("layer-annotation", [720, 6100], "Scale 1:100 / Unit mm / Draft", { id: "e_note_2", size: 220 })
  ];
  return applyTransaction(drawing, {
    id: "txn_seed_entities",
    source: "system",
    label: "デモ図面初期化",
    commands: entities.map((entity) => ({ op: "add", entity }))
  }).drawing;
}

export function line(layerId, start, end, options = {}) {
  return entityBase("line", layerId, {
    points: [point(start), point(end)],
    ...options
  });
}

export function rect(layerId, origin, width, height, options = {}) {
  return entityBase("rect", layerId, {
    origin: point(origin),
    width,
    height,
    ...options
  });
}

export function circle(layerId, center, radius, options = {}) {
  return entityBase("circle", layerId, {
    center: point(center),
    radius,
    ...options
  });
}

export function polyline(layerId, points, options = {}) {
  return entityBase("polyline", layerId, {
    points: points.map(point),
    closed: options.closed ?? false,
    ...options
  });
}

export function text(layerId, at, value, options = {}) {
  return entityBase("text", layerId, {
    at: point(at),
    value,
    size: options.size ?? 240,
    ...options
  });
}

function entityBase(type, layerId, options) {
  return {
    id: options.id ?? `e_${cryptoSafeId()}`,
    type,
    layerId,
    style: {
      strokeWidth: options.strokeWidth ?? 2,
      lineDash: options.lineDash ?? [],
      fill: options.fill ?? "transparent"
    },
    meta: {
      createdBy: options.createdBy ?? "user",
      createdAt: options.createdAt ?? new Date().toISOString()
    },
    ...withoutKeys(options, ["id", "strokeWidth", "lineDash", "fill", "createdBy", "createdAt"])
  };
}

export function applyTransaction(drawing, transaction) {
  const policy = ROLE_POLICIES[drawing.currentRole] ?? ROLE_POLICIES.viewer;
  if (drawing.state === "approved") {
    return fail("承認済み版は直接変更できません。新しい版を作成してください。", drawing);
  }
  if (!policy.canEdit && transaction.source !== "system" && transaction.source !== "approval") {
    return fail(`${policy.label}は図面を変更できません。`, drawing);
  }

  const next = structuredClone(drawing);
  const warnings = [];
  const beforeHash = stableHash(next.entities);

  for (const command of transaction.commands) {
    if (command.op === "add") {
      const layer = next.layers.find((item) => item.id === command.entity.layerId);
      if (!layer) {
        return fail(`存在しないレイヤーです: ${command.entity.layerId}`, drawing);
      }
      if (layer.locked) {
        return fail(`ロック中レイヤーへ追加できません: ${layer.name}`, drawing);
      }
      next.entities.push(structuredClone(command.entity));
    }

    if (command.op === "update") {
      const target = next.entities.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`更新対象が見つかりません: ${command.id}`);
        continue;
      }
      const layer = next.layers.find((item) => item.id === target.layerId);
      if (layer?.locked) {
        return fail(`ロック中レイヤーの図形は変更できません: ${layer.name}`, drawing);
      }
      Object.assign(target, structuredClone(command.patch));
    }

    if (command.op === "delete") {
      const target = next.entities.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`削除対象が見つかりません: ${command.id}`);
        continue;
      }
      const layer = next.layers.find((item) => item.id === target?.layerId);
      if (layer?.locked) {
        return fail(`ロック中レイヤーの図形は削除できません: ${layer.name}`, drawing);
      }
      next.entities = next.entities.filter((item) => item.id !== command.id);
    }

    if (command.op === "update_layer") {
      const target = next.layers.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`更新レイヤーが見つかりません: ${command.id}`);
        continue;
      }
      const allowedPatch = Object.fromEntries(
        Object.entries(command.patch ?? {}).filter(
          ([key, value]) => ["visible", "locked"].includes(key) && typeof value === "boolean"
        )
      );
      Object.assign(target, structuredClone(allowedPatch));
    }
  }

  next.updatedAt = new Date().toISOString();
  next.revision = (drawing.revision ?? 1) + 1;
  next.commandEvents.push({
    id: transaction.id ?? `txn_${cryptoSafeId()}`,
    at: next.updatedAt,
    label: transaction.label,
    source: transaction.source ?? "user",
    beforeHash,
    afterHash: stableHash(next.entities),
    commands: structuredClone(transaction.commands),
    warnings
  });
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor: transaction.actor ?? next.currentRole,
    action: "drawing.transaction",
    detail: transaction.label
  });
  return { ok: true, drawing: next, warnings };
}

export function createNewVersion(drawing, actor = "approver") {
  const next = structuredClone(drawing);
  next.version += 1;
  next.revision = (drawing.revision ?? 1) + 1;
  next.state = "draft";
  next.updatedAt = new Date().toISOString();
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor,
    action: "drawing.version.created",
    detail: `v${drawing.version}からv${next.version}を作成`
  });
  return next;
}

export function submitForReview(drawing, actor = "drafter") {
  const next = structuredClone(drawing);
  next.state = "in_review";
  next.revision = (drawing.revision ?? 1) + 1;
  next.updatedAt = new Date().toISOString();
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor,
    action: "review.submitted",
    detail: `v${next.version}をレビューへ提出`
  });
  return next;
}

export function approveDrawing(drawing, actor = "approver") {
  const policy = ROLE_POLICIES[drawing.currentRole] ?? ROLE_POLICIES.viewer;
  if (!policy.canApprove) {
    return fail(`${policy.label}は承認できません。`, drawing);
  }
  if (drawing.state !== "in_review") {
    return fail("レビュー中の図面だけを承認できます。", drawing);
  }
  const issues = validateDrawing(drawing).filter((issue) => issue.severity === "critical");
  if (issues.length > 0) {
    return fail(`Critical検査項目が残っています: ${issues.length}件`, drawing);
  }
  const next = structuredClone(drawing);
  next.state = "approved";
  next.revision = (drawing.revision ?? 1) + 1;
  next.updatedAt = new Date().toISOString();
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor,
    action: "review.approved",
    detail: `v${next.version}を承認`
  });
  return { ok: true, drawing: next };
}

export function validateDrawing(drawing) {
  const issues = [];
  const layerIds = new Set(drawing.layers.map((layer) => layer.id));
  const ids = new Set();

  for (const entity of drawing.entities) {
    if (ids.has(entity.id)) {
      issues.push(issue("critical", "duplicate-entity-id", `図形IDが重複しています: ${entity.id}`, entity.id));
    }
    ids.add(entity.id);

    if (!layerIds.has(entity.layerId)) {
      issues.push(issue("critical", "missing-layer", `存在しないレイヤーを参照しています: ${entity.layerId}`, entity.id));
    }

    const bounds = entityBounds(entity);
    if (!bounds) {
      issues.push(issue("major", "invalid-geometry", `図形の形状が不正です: ${entity.id}`, entity.id));
      continue;
    }
    if (bounds.minX < -1 || bounds.minY < -1 || bounds.maxX > 12001 || bounds.maxY > 7001) {
      issues.push(issue("major", "outside-paper", `用紙外の図形です: ${entity.id}`, entity.id));
    }
    if (entity.type === "line" && distance(entity.points[0], entity.points[1]) < EPSILON) {
      issues.push(issue("major", "zero-length-line", `長さ0の線分です: ${entity.id}`, entity.id));
    }
    if (entity.type === "circle" && entity.radius <= 0) {
      issues.push(issue("critical", "invalid-radius", `円半径が不正です: ${entity.id}`, entity.id));
    }
  }

  if (!drawing.entities.some((entity) => entity.type === "text")) {
    issues.push(issue("minor", "missing-title-note", "表題/注記の文字がありません。", drawing.id));
  }

  return issues;
}

export function measurements(drawing) {
  let totalLength = 0;
  let totalArea = 0;
  const counts = {};
  for (const entity of drawing.entities) {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    totalLength += entityLength(entity);
    totalArea += entityArea(entity);
  }
  return {
    entityCount: drawing.entities.length,
    totalLength: round(totalLength),
    totalArea: round(totalArea),
    counts
  };
}

export function buildAiProposal(drawing, prompt) {
  const normalized = prompt.trim();
  const commands = [];
  const warnings = [];
  let label = "AI提案";

  if (!normalized) {
    return {
      status: "needs_input",
      question: "作図・検査・標準化の目的を入力してください。",
      commands,
      warnings
    };
  }

  const lower = normalized.toLowerCase();
  if (normalized.includes("重機") || normalized.includes("クレーン") || lower.includes("crane")) {
    label = "クレーン作業範囲を追加";
    commands.push({
      op: "add",
      entity: circle("layer-temporary", [9300, 3500], 1450, {
        id: `preview_crane_${cryptoSafeId()}`,
        createdBy: "agent",
        strokeWidth: 2,
        lineDash: [10, 8]
      })
    });
    commands.push({
      op: "add",
      entity: text("layer-annotation", [7600, 1500], "AI Preview: crane swing radius R=1450", {
        id: `preview_note_${cryptoSafeId()}`,
        createdBy: "agent",
        size: 180
      })
    });
  } else if (normalized.includes("標準") || normalized.includes("整理") || lower.includes("cleanup")) {
    label = "レイヤー標準化と短線検査";
    const shortLine = drawing.entities.find((entity) => entity.type === "line" && entityLength(entity) < 50);
    if (shortLine) {
      commands.push({ op: "delete", id: shortLine.id });
    } else {
      warnings.push("削除対象の短線は見つかりません。標準レイヤー検査のみ実施します。");
    }
  } else if (normalized.includes("注記") || normalized.includes("寸法") || lower.includes("note")) {
    label = "施工注記を追加";
    commands.push({
      op: "add",
      entity: text("layer-annotation", [2600, 2050], "仮設範囲は現地立会い後に確定", {
        id: `preview_annotation_${cryptoSafeId()}`,
        createdBy: "agent",
        size: 210
      })
    });
  } else {
    return {
      status: "needs_input",
      question: "MVPでは「重機範囲」「標準整理」「注記追加」のいずれかを具体的に指定してください。",
      commands,
      warnings
    };
  }

  return {
    status: "planned",
    label,
    skill: {
      id: inferSkillId(label),
      version: "0.1.0",
      status: "approved"
    },
    risk: commands.length > 3 ? "major" : "minor",
    impact: {
      add: commands.filter((command) => command.op === "add").length,
      update: commands.filter((command) => command.op === "update").length,
      delete: commands.filter((command) => command.op === "delete").length
    },
    commands,
    warnings,
    postconditions: ["no_locked_layer_change", "geometry_valid", "human_approved"]
  };
}

export function proposalToTransaction(proposal, actor = "agent") {
  return {
    id: `agt_${cryptoSafeId()}`,
    source: "agent",
    actor,
    label: proposal.label,
    commands: proposal.commands
  };
}

export function entityBounds(entity) {
  if (entity.type === "line" || entity.type === "polyline") {
    return boundsFromPoints(entity.points);
  }
  if (entity.type === "rect") {
    return {
      minX: entity.origin.x,
      minY: entity.origin.y,
      maxX: entity.origin.x + entity.width,
      maxY: entity.origin.y + entity.height
    };
  }
  if (entity.type === "circle") {
    return {
      minX: entity.center.x - entity.radius,
      minY: entity.center.y - entity.radius,
      maxX: entity.center.x + entity.radius,
      maxY: entity.center.y + entity.radius
    };
  }
  if (entity.type === "text") {
    return {
      minX: entity.at.x,
      minY: entity.at.y - entity.size,
      maxX: entity.at.x + entity.value.length * entity.size * 0.55,
      maxY: entity.at.y
    };
  }
  return null;
}

export function entityLength(entity) {
  if (entity.type === "line") return distance(entity.points[0], entity.points[1]);
  if (entity.type === "polyline") {
    const points = entity.closed ? [...entity.points, entity.points[0]] : entity.points;
    return points.slice(1).reduce((sum, current, index) => sum + distance(points[index], current), 0);
  }
  if (entity.type === "rect") return Math.abs(entity.width * 2) + Math.abs(entity.height * 2);
  if (entity.type === "circle") return 2 * Math.PI * entity.radius;
  return 0;
}

export function entityArea(entity) {
  if (entity.type === "rect") return Math.abs(entity.width * entity.height);
  if (entity.type === "circle") return Math.PI * entity.radius * entity.radius;
  if (entity.type === "polyline" && entity.closed) return polygonArea(entity.points);
  return 0;
}

export function hitTest(drawing, worldPoint, tolerance = 80) {
  const visibleLayerIds = new Set(drawing.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best = null;
  let bestDistance = Infinity;
  for (const entity of drawing.entities) {
    if (!visibleLayerIds.has(entity.layerId)) continue;
    const currentDistance = distanceToEntity(entity, worldPoint);
    if (currentDistance < tolerance && currentDistance < bestDistance) {
      best = entity;
      bestDistance = currentDistance;
    }
  }
  return best;
}

function distanceToEntity(entity, p) {
  if (entity.type === "line") return pointToSegmentDistance(p, entity.points[0], entity.points[1]);
  if (entity.type === "rect") {
    const o = entity.origin;
    const points = [
      o,
      { x: o.x + entity.width, y: o.y },
      { x: o.x + entity.width, y: o.y + entity.height },
      { x: o.x, y: o.y + entity.height }
    ];
    return Math.min(...points.map((current, index) => pointToSegmentDistance(p, current, points[(index + 1) % 4])));
  }
  if (entity.type === "circle") return Math.abs(distance(p, entity.center) - entity.radius);
  if (entity.type === "polyline") {
    const points = entity.closed ? [...entity.points, entity.points[0]] : entity.points;
    return Math.min(...points.slice(1).map((current, index) => pointToSegmentDistance(p, points[index], current)));
  }
  if (entity.type === "text") {
    const bounds = entityBounds(entity);
    return p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY ? 0 : Infinity;
  }
  return Infinity;
}

function pointToSegmentDistance(p, a, b) {
  const lengthSquared = distanceSquared(a, b);
  if (lengthSquared < EPSILON) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSquared));
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function point(value) {
  return Array.isArray(value) ? { x: Number(value[0]), y: Number(value[1]) } : { x: Number(value.x), y: Number(value.y) };
}

function boundsFromPoints(points) {
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y))
  };
}

function polygonArea(points) {
  const area = points.reduce((sum, pointValue, index) => {
    const next = points[(index + 1) % points.length];
    return sum + pointValue.x * next.y - next.x * pointValue.y;
  }, 0);
  return Math.abs(area / 2);
}

function distance(a, b) {
  return Math.sqrt(distanceSquared(a, b));
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function issue(severity, code, message, entityId) {
  return { severity, code, message, entityId };
}

function fail(message, drawing) {
  return { ok: false, error: message, drawing };
}

function stableHash(value) {
  const raw = JSON.stringify(value, (_key, current) => {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return Object.fromEntries(Object.entries(current).sort(([left], [right]) => left.localeCompare(right)));
    }
    return current;
  });
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function cryptoSafeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function inferSkillId(label) {
  if (label.includes("クレーン")) return "civil-temporary-yard";
  if (label.includes("標準")) return "drawing-cleanup";
  return "dimension-annotation";
}

function withoutKeys(objectValue, keys) {
  return Object.fromEntries(Object.entries(objectValue).filter(([key]) => !keys.includes(key)));
}
