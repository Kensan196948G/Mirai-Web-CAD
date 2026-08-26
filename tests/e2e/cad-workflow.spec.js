import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモ初期化" }).click();
});

test("主要CAD画面は描画済みでAPI HealthとAI承認を操作できる", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Mirai Web CAD" })).toBeVisible();
  const canvas = page.getByLabel("作図キャンバス");
  await expect(canvas).toBeVisible();

  const paintedPixels = await canvas.evaluate((element) => {
    const context = element.getContext("2d");
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let nonWhite = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) nonWhite += 1;
    }
    return nonWhite;
  });
  expect(paintedPixels).toBeGreaterThan(1_000);

  await page.getByRole("button", { name: "API Health" }).click();
  await expect(page.locator(".api-status")).toContainText("mirai-web-cad-api");
  await expect(page.locator(".api-status")).toContainText("同期済み");

  if (testInfo.project.name === "mobile-chromium") {
    await testInfo.attach("cad-mobile", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png"
    });
    return;
  }

  const quantity = page.getByText("図形数").locator("xpath=following-sibling::dd[1]");
  const beforeCount = Number(await quantity.textContent());
  await page.getByRole("button", { name: "線", exact: true }).click();
  await canvas.click({ position: { x: 260, y: 240 } });
  await canvas.click({ position: { x: 420, y: 260 } });
  await expect(quantity).toHaveText(String(beforeCount + 1));

  await page.getByPlaceholder("例: クレーンの重機範囲を追加").fill("クレーンの重機範囲を追加");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("#aiPreview")).toContainText("追加 2");
  await page.getByRole("button", { name: "承認して適用" }).click();
  await expect(quantity).toHaveText(String(beforeCount + 3));
  await expect(page.getByLabel("コマンドログ")).toContainText("Neon同期");

  await testInfo.attach("cad-desktop", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
});

test("状態表示、権限拒否、Keyboard操作を確認できる", async ({ page }) => {
  for (const label of ["空", "Loading", "Error", "正常"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }

  await page.getByLabel("権限を切替").selectOption("viewer");
  const firstLayer = page.locator("[data-layer-visible]").first();
  await expect(firstLayer).toBeChecked();
  await firstLayer.click();
  await expect(page.locator("[data-layer-visible]").first()).toBeChecked();
  await expect(page.getByLabel("コマンドログ")).toContainText("図面を変更できません");

  await page.getByRole("button", { name: "線", exact: true }).click();
  await page.getByLabel("作図キャンバス").click({ position: { x: 200, y: 200 } });
  await expect(page.getByLabel("コマンドログ")).toContainText("閲覧者は作図できません");

  await page.getByLabel("作図キャンバス").press("Escape");
  await expect(page.getByLabel("コマンドログ")).toContainText("取消");
});

test("CriticalまたはSeriousのアクセシビリティ違反がない", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
  expect(blocking).toEqual([]);
});

test("URLと保存図面の文字列をHTMLとして実行しない", async ({ page }) => {
  await page.evaluate(() => {
    const drawing = JSON.parse(localStorage.getItem("mirai-web-cad-mvp"));
    drawing.layers[0].id = 'unsafe\"><img src=x onerror="window.__miraiXss=1">';
    drawing.layers[0].name = '<img src=x onerror="window.__miraiXss=1">';
    drawing.layers[0].color = "red;position:fixed;inset:0";
    localStorage.setItem("mirai-web-cad-mvp", JSON.stringify(drawing));
  });
  await page.goto('/?state=%3Cimg%20src%3Dx%20onerror%3D%22window.__miraiXss%3D1%22%3E');
  await expect(page.getByText("表示状態: 正常")).toBeVisible();
  await expect(page.locator("#app img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__miraiXss)).toBeUndefined();
  await expect(page.locator(".swatch").first()).toHaveCSS("background-color", "rgb(91, 107, 122)");
});

test("狭い画面でも主要操作領域が表示範囲を破綻させない", async ({ page }) => {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(metrics.content).toBeLessThanOrEqual(metrics.viewport + 1);
  await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
  await expect(page.getByLabel("作図キャンバス")).toBeVisible();
});
