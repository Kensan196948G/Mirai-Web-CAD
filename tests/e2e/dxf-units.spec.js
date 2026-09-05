import { expect, test } from "@playwright/test";
import { createDrawing, line } from "../../src/cad-core.js";
import { exportDxf } from "../../src/dxf-export.js";

test("DXF unit adoption, Undo, Redo and reload preserve physical dimensions", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.addInitScript((doc) => {
    if (!localStorage.getItem("mirai-web-cad-mvp")) localStorage.setItem("mirai-web-cad-mvp", JSON.stringify(doc));
  }, createDrawing());
  await page.goto("/");
  await expect(page.locator(".save-status")).toHaveText("オフライン");
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("mirai-web-cad-mvp")));
  const upload = async (unit) => page.locator("#importFile").setInputFiles({ name: `${unit}.dxf`, mimeType: "application/dxf", buffer: Buffer.from(exportDxf(createDrawing({ unit, entities: [line("layer-structure", [0, 0], [10, 0])] })).content) });
  const command = async (value) => { await page.locator("#commandInput").fill(value); await page.locator("#commandInput").press("Enter"); };
  await upload("m");
  await expect.poll(async () => (await stored()).unit).toBe("m");
  expect((await stored()).entities[0].points[1].x).toBe(10);
  await command("UNDO");
  expect((await stored()).unit).toBe("mm");
  expect((await stored()).entities).toHaveLength(0);
  await command("REDO");
  expect((await stored()).unit).toBe("m");
  expect((await stored()).entities[0].points[1].x).toBe(10);
  await page.reload();
  await expect(page.locator(".save-status")).toHaveText("オフライン");
  expect((await stored()).unit).toBe("m");
  await upload("mm");
  await expect.poll(async () => (await stored()).entities.length).toBe(2);
  expect((await stored()).entities[0].points[1].x).toBe(10);
  expect((await stored()).entities[1].points[1].x).toBe(0.01);
  await expect(page.getByLabel("コマンドログ")).toContainText("DXF単位換算: mm -> m (0.001倍)");
});
