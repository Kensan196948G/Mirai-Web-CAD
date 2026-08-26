import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const app = await readFile("src/app.js", "utf8");
const css = await readFile("src/styles.css", "utf8");

const failures = [];

check(html.includes('lang="ja"'), "HTML lang=jaが必要です");
check(html.includes('name="viewport"'), "viewport metaが必要です");
check(app.includes("aria-label"), "主要操作にaria-labelが必要です");
check(app.includes("aria-pressed"), "状態切替ボタンにaria-pressedが必要です");
check(app.includes("tabindex=\"0\""), "CanvasをKeyboard focus可能にする必要があります");
check(css.includes(":focus-visible"), "focus-visibleスタイルが必要です");
check(css.includes("@media (max-width: 980px)") && css.includes("@media (max-width: 680px)"), "Responsive media queryが必要です");
check(!/font-size\s*:\s*[^;]*(vw|vh|vmin|vmax)/.test(css), "viewport幅連動のfont-sizeは禁止です");
check(!/letter-spacing\s*:\s*-/.test(css), "負のletter-spacingは禁止です");
check(!/gradient\s+orb|bokeh|blurred blob/i.test(css), "装飾blob/orbは禁止です");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("static a11y/responsive ok");

function check(condition, message) {
  if (!condition) failures.push(message);
}
