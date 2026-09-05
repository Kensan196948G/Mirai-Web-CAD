import { expect, test } from "@playwright/test";
import { seedDrawing } from "../../src/cad-core.js";

test("unsupported DXF does not partially import or rename the current drawing", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.addInitScript((drawing) => localStorage.setItem("mirai-web-cad-mvp", JSON.stringify(drawing)), seedDrawing());
  await page.goto("/");
  await expect(page.locator(".save-status")).toHaveText("オフライン");
  const stored = () => page.evaluate(() => localStorage.getItem("mirai-web-cad-mvp"));
  const before = await stored();
  const line = "0\nLINE\n8\nNEW_LAYER\n10\n0\n20\n0\n11\n100\n21\n100\n";
  const dxf = (extra) => `0\nSECTION\n2\nENTITIES\n${line}${extra}0\nENDSEC\n0\nEOF`;
  await page.locator("#importFile").setInputFiles({ name: "must-not-rename.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf("0\nLEADER\n0\nACAD_PROXY_ENTITY\n")) });
  await expect(page.getByLabel("コマンドログ")).toContainText("LEADER 1件, ACAD_PROXY_ENTITY 1件");
  await expect(page.getByLabel("コマンドログ")).toContainText("図面は変更していません");
  expect(await stored()).toBe(before);
  await page.reload();
  await expect(page.locator(".save-status")).toHaveText("オフライン");
  expect(await stored()).toBe(before);
  await page.locator("#importFile").setInputFiles({ name: "supported.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf("")) });
  await expect(page.getByLabel("コマンドログ")).toContainText("Import完了: 1/1図形");
  expect(JSON.parse(await stored()).entities).toHaveLength(JSON.parse(before).entities.length + 1);
});
