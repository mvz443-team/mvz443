/**
 * 用 Playwright 进关并通过 DBG.spawnMonster 生成新僵尸，截图不同形态的渲染状态。
 * 前置：本地开发服务器已启动（npm run dev-nolog）。
 * 用法：node scripts/monster-shape-screenshots.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8080";
const outDir = path.resolve("screenshots/monster-shapes");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

async function enterGame(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("mvz443.debug.unlockall", "1");
    localStorage.setItem("mvz443.debug.dbgCommands", "1");
    localStorage.setItem("plantSelection", JSON.stringify({
      lastSelectedPlants: [1, 2, 3, 4, 5, 6, 7, 8],
      lastStageId: 5,
    }));
    localStorage.setItem("chapterSelection", JSON.stringify({ lastSelectedChapter: 1 }));
    localStorage.setItem("stageSelection", JSON.stringify({ lastSelectedStage: 5, lastChapterId: 1 }));
    localStorage.setItem("levelSelectorState", JSON.stringify({
      lastChapterId: 1, lastStageId: 5, lastStep: "params",
    }));
  });
  await page.goto(`${baseUrl}/?autoSelectStage=5&fromPage=test&unlockall=1&dbgCommands=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(900);

  const start = page.getByRole("button", { name: /下一步|开始游戏|开始|Next|Start Game|Start/i }).last();
  if (await start.count()) await start.click().catch(() => undefined);
  await page.waitForSelector("#game-container canvas", { timeout: 15000 });
  await page.waitForFunction(() => Boolean(window.__MVZ443_GAME__ && window.DBG), null, { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function capture(name, spawnScript) {
  const page = await context.newPage();
  try {
    await enterGame(page);
    const info = await page.evaluate(spawnScript);
    await page.waitForTimeout(500);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`saved: ${file} ${info ?? ""}`);
  } catch (error) {
    console.error(`FAILED ${name}: ${error}`);
  } finally {
    await page.close();
  }
}

await capture("01_boat_and_diving", () => {
  window.DBG.spawnMonster(22, 0, 5);
  window.DBG.spawnMonster(24, 1, 5);
  window.DBG.spawnMonster(27, 4, 5);
  return "boat/boat-helmet/diving";
});

await capture("02_dolphin_riding", () => {
  window.DBG.spawnMonster(28, 5, 5);
  return "dolphin mounted";
});

await capture("03_dolphin_after_mount_broken", () => {
  const rider = window.DBG.spawnMonster(28, 5, 5);
  if (rider) {
    rider.model.breakMount();
    rider.syncViewFromModel();
  }
  return "mount broken";
});

await browser.close();
