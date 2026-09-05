import { expect, test } from "@playwright/test";
import { createDrawing, line } from "../../src/cad-core.js";

test.beforeEach(async ({ page }) => {
  const drawing = createDrawing({ currentRole: "drafter", entities: [
    line("layer-structure", [400, 400], [1600, 400], { id: "first" }),
    line("layer-structure", [400, 1000], [1600, 1000], { id: "second" })
  ] });
  await page.addInitScript((doc) => localStorage.setItem("mirai-web-cad-mvp", JSON.stringify(doc)), drawing);
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".save-status")).toHaveText("オフライン");
});

async function drag(page, a, b, beforeUp) {
  const box = await page.locator("#cadCanvas").boundingBox();
  await page.mouse.move(box.x + a.x, box.y + a.y);
  await page.mouse.down();
  await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 5 });
  if (beforeUp) await beforeUp();
  await page.mouse.up();
}

const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mirai-web-cad-mvp")));

test("window selection, group preview cancellation, atomic move, undo and delete", async ({ page }, testInfo) => {
  const canvas = page.locator("#cadCanvas");
  await drag(page, { x: 65, y: 55 }, { x: 185, y: 130 });
  await expect(page.getByText("選択: 2件 / second", { exact: true })).toBeVisible();
  const before = await stored(page);
  await drag(page, { x: 120, y: 70 }, { x: 150, y: 90 }, async () => {
    expect((await stored(page)).entities).toEqual(before.entities);
    await page.keyboard.press("Escape");
  });
  expect((await stored(page)).entities).toEqual(before.entities);
  await drag(page, { x: 65, y: 55 }, { x: 185, y: 130 });
  await drag(page, { x: 120, y: 70 }, { x: 150, y: 85 });
  await expect.poll(async () => (await stored(page)).entities[0].points[0].x).toBeCloseTo(800, 8);
  expect((await stored(page)).entities[1].points[0].x).toBeCloseTo(800, 8);
  expect((await stored(page)).entities[1].points[0].y).toBeCloseTo(1200, 8);
  await page.locator("#commandInput").fill("UNDO");
  await page.locator("#commandInput").press("Enter");
  await expect.poll(async () => (await stored(page)).entities).toEqual(before.entities);
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await stored(page)).entities.length).toBe(0);
  await testInfo.attach("selection-layout", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("crossing and Shift toggle select sets; endpoint grip modifies only the endpoint", async ({ page }, testInfo) => {
  const canvas = page.locator("#cadCanvas");
  await drag(page, { x: 130, y: 55 }, { x: 110, y: 130 });
  await expect(page.getByText("選択: 2件 / second", { exact: true })).toBeVisible();
  await canvas.click({ position: { x: 120, y: 115 }, modifiers: ["Shift"] });
  await expect(page.getByText(/選択: 1件 \/ first/)).toBeVisible();
  await drag(page, { x: 170, y: 70 }, { x: 200, y: 85 });
  await expect.poll(async () => (await stored(page)).entities[0].points[1]).toEqual({ x: 2000, y: 600 });
  expect((await stored(page)).entities[0].points[0]).toEqual({ x: 400, y: 400 });
  const colored = await canvas.evaluate((element) => {
    const pixels = element.getContext("2d").getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i + 1] > 70 && pixels[i + 1] < 180 && pixels[i + 2] < 70) count++;
    return count;
  });
  expect(colored).toBeGreaterThan(20);
  await testInfo.attach("grip-preview", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
