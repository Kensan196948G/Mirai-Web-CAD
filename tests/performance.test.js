import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, createDrawing, line, measurements } from "../src/cad-core.js";

const configuredBudget = Number(process.env.CAD_CORE_10K_BUDGET_MS ?? 10_000);
const budgetMs = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 10_000;

test("10,000 entities remain processable by the deterministic CAD core", { timeout: budgetMs * 4 + 5_000 }, () => {
  const commands = Array.from({ length: 10_000 }, (_, index) => ({
    op: "add",
    entity: line("layer-structure", [index, 0], [index, 100], { id: `perf_${index}` })
  }));

  runBaseline(commands.slice(0, 100));
  const durations = Array.from({ length: 3 }, () => runBaseline(commands)).sort((left, right) => left - right);
  assert.ok(durations[1] < budgetMs, `10k CAD core median exceeded ${budgetMs} ms`);
});

function runBaseline(commands) {
  const drawing = createDrawing({ id: "dwg_performance", currentRole: "drafter" });
  const startedAt = performance.now();
  const result = applyTransaction(drawing, {
    source: "system",
    actor: "performance-test",
    label: "10k entity baseline",
    commands
  });
  const duration = performance.now() - startedAt;
  assert.equal(result.ok, true);
  assert.equal(result.drawing.entities.length, commands.length);
  assert.equal(measurements(result.drawing).entityCount, commands.length);
  return duration;
}
