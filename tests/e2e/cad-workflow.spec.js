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

  const roleSelect = page.getByLabel("権限を切替");
  if (await roleSelect.isDisabled()) {
    await expect(roleSelect).toHaveValue("viewer");
    await expect(quantity).toHaveText(String(beforeCount));
    await expect(page.getByLabel("コマンドログ")).toContainText("閲覧者は作図できません");
    return;
  }

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

test("新規図面、コマンドライン、JSON Importを連続操作できる", async ({ page }) => {
  await page.getByRole("button", { name: "新規図面" }).click();
  await expect(page.getByRole("dialog", { name: "新規図面" })).toBeVisible();
  await page.getByLabel("図面名").fill("CLI施工図");
  await page.getByLabel("テンプレート").selectOption("blank");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByText("CLI施工図", { exact: true })).toBeVisible();

  const quantity = page.getByText("図形数").locator("xpath=following-sibling::dd[1]");
  await expect(quantity).toHaveText("0");
  const command = page.getByLabel("コマンド入力");
  await command.fill("LINE 0,0 1200,800");
  await command.press("Enter");
  await expect(quantity).toHaveText("1");
  await expect(page.getByLabel("コマンドログ")).toContainText("CLI LINE");

  await command.fill("UNDO");
  await command.press("Enter");
  await expect(quantity).toHaveText("0");
  await expect(page.getByRole("button", { name: "やり直す" })).toBeEnabled();

  await command.fill("REDO");
  await command.press("Enter");
  await expect(quantity).toHaveText("1");
  await expect(page.getByRole("button", { name: "元に戻す" })).toBeEnabled();

  const imported = {
    layers: [{ id: "survey", name: "測量", color: "#224466" }],
    entities: [{ type: "circle", layerId: "survey", center: { x: 1600, y: 900 }, radius: 300 }]
  };
  await page.locator("#importFile").setInputFiles({
    name: "survey.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported))
  });
  await expect(quantity).toHaveText("2");
  await expect(page.getByLabel("検査とAI").getByText("測量", { exact: true })).toBeVisible();
  await expect(page.getByLabel("コマンドログ")).toContainText("Import完了: 1/1図形");

  await command.fill("UNDO");
  await command.press("Enter");
  await expect(quantity).toHaveText("1");
  await expect(page.getByLabel("検査とAI").getByText("測量", { exact: true })).toHaveCount(0);

  await command.fill("REDO");
  await command.press("Enter");
  await expect(quantity).toHaveText("2");
  await expect(page.getByLabel("検査とAI").getByText("測量", { exact: true })).toBeVisible();
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
  await expect(page.locator(".swatch").first()).toHaveValue("#5b6b7a");
});

test("上部設定から作図補助とコマンドライン表示を保存できる", async ({ page }) => {
  const commandLine = page.getByLabel("コマンドライン");
  expect((await commandLine.boundingBox()).height).toBeLessThanOrEqual(90);

  await page.getByRole("button", { name: "システム設定" }).click();
  const dialog = page.getByRole("dialog", { name: "システム設定" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("グリッド表示")).toBeChecked();
  await page.getByLabel("グリッドスナップ").check();
  await page.getByLabel("グリッド間隔").selectOption("250");
  await page.getByLabel("ログ表示行数").selectOption("1");
  await page.getByRole("button", { name: "適用", exact: true }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("SNAP: 250 mm", { exact: true })).toBeVisible();
  expect((await commandLine.boundingBox()).height).toBeLessThanOrEqual(72);

  await page.reload();
  await page.getByRole("button", { name: "システム設定" }).click();
  await expect(page.getByLabel("グリッドスナップ")).toBeChecked();
  await expect(page.getByLabel("グリッド間隔")).toHaveValue("250");
  await expect(page.getByLabel("ログ表示行数")).toHaveValue("1");
});

test("狭い画面でも主要操作領域が表示範囲を破綻させない", async ({ page }) => {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(metrics.content).toBeLessThanOrEqual(metrics.viewport + 1);
  await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
  await expect(page.getByLabel("作図キャンバス")).toBeVisible();
  await expect(page.getByRole("button", { name: "システム設定" })).toBeVisible();
  expect((await page.getByLabel("コマンドライン").boundingBox()).height).toBeLessThanOrEqual(110);
});

test("高度CAD編集、レイヤー、レイアウトを一連操作できる", async ({ page }) => {
  const command = page.getByLabel("コマンド入力");
  const quantity = page.getByText("図形数").locator("xpath=following-sibling::dd[1]");
  const before = Number(await quantity.textContent());

  for (const value of ["DIM 1000,1000 2500,1000", "HATCH 3000,1000 4000,1000 4000,1800 3000,1800", "SELECT e_box_1", "OFFSET 150", "ROTATE 15", "SCALE 1.05"]) {
    await command.fill(value);
    await command.press("Enter");
  }
  await expect(quantity).toHaveText(String(before + 3));
  await expect(page.getByRole("heading", { name: "CAD Operations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();

  await page.getByLabel("図形操作").selectOption("block");
  await page.getByLabel("操作値").fill("構造物記号");
  await page.getByRole("button", { name: "選択図形へ適用" }).click();
  await page.locator("#propertyForm input[name=blockAttributes]").fill("番号=B-01;種別=構造物");
  await page.getByRole("button", { name: "プロパティ更新" }).click();
  await expect(page.locator("#propertyForm input[name=blockAttributes]")).toHaveValue("番号=B-01;種別=構造物");

  await page.getByLabel("新規レイヤー名").fill("測量");
  await page.getByRole("button", { name: "レイヤー追加" }).click();
  await expect(page.getByLabel("現在レイヤー")).toContainText("測量");

  await page.locator("#layoutForm select[name=paper]").selectOption("A1");
  await page.locator("#layoutForm input[name=scale]").fill("200");
  await page.getByRole("button", { name: "設定保存" }).click();
  await expect(page.locator("#layoutForm select[name=paper]")).toHaveValue("A1");
  await page.evaluate(() => { window.print = () => localStorage.setItem("print-invoked", "yes"); });
  await page.getByRole("button", { name: "PDF / 印刷" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("print-invoked"))).toBe("yes");
});
