/**
 * 生成 PC 星碎控件在不同数量下的截图（含半块与 >5 的数字形态）。
 * 需要先启动 dev server：npm run dev-nolog
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.GAME_URL ?? "http://127.0.0.1:8085/";
const outputRoot = process.env.SHOT_DIR ?? "artifacts/starshards";
const values = (process.env.SHOT_VALUES ?? "0,0.5,1,1.5,2,4,5,5.5,6,10")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);

mkdirSync(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("mvz443.debug.dbgCommands", "1");
  localStorage.setItem("mvz443.debug.unlockAllCards", "1");
  localStorage.setItem("plantSelection", JSON.stringify({
    lastSelectedPlants: [1, 2, 3, 4],
    lastStageId: 1,
  }));
  localStorage.setItem("chapterSelection", JSON.stringify({ lastSelectedChapter: 1 }));
  localStorage.setItem("stageSelection", JSON.stringify({ lastSelectedStage: 1, lastChapterId: 1 }));
  localStorage.setItem("levelSelectorState", JSON.stringify({
    lastChapterId: 1, lastStageId: 1, lastStep: "params",
  }));
});
await page.goto(`${baseUrl}?autoSelectStage=1&fromPage=test&unlockAllCards=1&dbgCommands=1`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(900);

const reloadButton = page.getByRole("button", { name: /重选上次|Reload/i }).first();
if (await reloadButton.count()) {
  await reloadButton.click();
  await page.waitForTimeout(350);
}
const startButton = page.getByRole("button", { name: /下一步|开始游戏|开始|Next|Start Game|Start/i }).last();
if (await startButton.count()) {
  await startButton.click();
}
await page.waitForSelector("#game-container canvas", { timeout: 15000 });
await page.waitForFunction(() => Boolean(window.__MVZ443_GAME__), null, { timeout: 20000 });
await page.waitForFunction(() => typeof window.DBG?.addResource === "function", null, { timeout: 10000 });
await page.waitForTimeout(800);

const canvasBox = await page.locator("#game-container canvas").boundingBox();
const clip = canvasBox
  ? {
      x: Math.max(0, canvasBox.x),
      y: Math.max(0, canvasBox.y + canvasBox.height - 150),
      width: Math.min(canvasBox.width * 0.5, 720),
      height: 150,
    }
  : null;

const results = [];
for (const value of values) {
  const state = await page.evaluate((target) => {
    const reset = window.DBG.addResource("starshards", -10);
    const applied = window.DBG.addResource("starshards", target);
    return { reset, applied, current: window.DBG.addResource("starshards", 0) };
  }, value);
  await page.waitForTimeout(320);
  const full = join(outputRoot, `pc-starshards-${value}.png`);
  await page.screenshot({ path: full, fullPage: false });
  let detail = null;
  if (clip) {
    detail = join(outputRoot, `pc-starshards-${value}-detail.png`);
    await page.screenshot({ path: detail, clip });
  }
  const panelClip = await page.evaluate(() => {
    const scene = window.__MVZ443_GAME__;
    const canvas = document.querySelector("#game-container canvas");
    if (!scene?.hud?.bottomBarUi?.starShardsPanel || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / scene.scale.gameSize.width;
    const sy = rect.height / scene.scale.gameSize.height;
    const panel = scene.hud.bottomBarUi.starShardsPanel;
    return {
      x: Math.max(0, rect.x + panel.container.x * sx - 12),
      y: Math.max(0, rect.y + panel.container.y * sy - 12),
      width: Math.min(rect.right, panel.width * sx + 24),
      height: Math.min(rect.bottom, panel.height * sy + 24),
    };
  });
  let panel = null;
  if (panelClip) {
    panel = join(outputRoot, `pc-starshards-${value}-panel.png`);
    await page.screenshot({ path: panel, clip: panelClip });
  }
  results.push({ value, state, full, detail, panel });
}

// 移动端回归：确认仍走原 count 模式（小数半星 + xN），未受 PC 改动影响。
const mobileContext = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
await mobilePage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("mvz443.debug.dbgCommands", "1");
  localStorage.setItem("mvz443.debug.unlockAllCards", "1");
  localStorage.setItem("plantSelection", JSON.stringify({ lastSelectedPlants: [1, 2, 3, 4], lastStageId: 1 }));
  localStorage.setItem("chapterSelection", JSON.stringify({ lastSelectedChapter: 1 }));
  localStorage.setItem("stageSelection", JSON.stringify({ lastSelectedStage: 1, lastChapterId: 1 }));
  localStorage.setItem("levelSelectorState", JSON.stringify({ lastChapterId: 1, lastStageId: 1, lastStep: "params" }));
});
await mobilePage.goto(`${baseUrl}?autoSelectStage=1&fromPage=test&unlockAllCards=1&dbgCommands=1`, { waitUntil: "domcontentloaded" });
await mobilePage.waitForTimeout(900);
const mobileStart = mobilePage.getByRole("button", { name: /下一步|开始游戏|开始|Next|Start Game|Start/i }).last();
if (await mobileStart.count()) await mobileStart.click();
await mobilePage.waitForSelector("#game-container canvas", { timeout: 15000 });
await mobilePage.waitForFunction(() => typeof window.DBG?.addResource === "function", null, { timeout: 20000 });
await mobilePage.evaluate(() => {
  window.DBG.addResource("starshards", -10);
  window.DBG.addResource("starshards", 1.5);
});
await mobilePage.waitForTimeout(320);
const mobileMode = await mobilePage.evaluate(() => window.__MVZ443_GAME__?.hud?.bottomBarUi?.starShardsPanel?.renderMode ?? null);
const mobileShot = join(outputRoot, "mobile-starshards-1.5.png");
await mobilePage.screenshot({ path: mobileShot, fullPage: false });
await mobileContext.close();

writeFileSync(join(outputRoot, "results.json"), JSON.stringify({ baseUrl, values, errors, results, mobileMode, mobileShot }, null, 2));
console.log(JSON.stringify({
  errors,
  mobileMode,
  mobileShot,
  results: results.map(({ value, full, detail, panel }) => ({ value, full, detail, panel })),
}, null, 2));

await context.close();
await browser.close();
