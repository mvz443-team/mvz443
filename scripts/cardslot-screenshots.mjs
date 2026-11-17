import { chromium, webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.GAME_URL ?? "http://127.0.0.1:8080/";
const outputRoot = process.env.SHOT_DIR ?? "artifacts/cardslots";
const stageId = Number(process.env.SHOT_STAGE ?? "1");
const expectedRows = process.env.SHOT_EXPECTED_ROWS
  ? Number(process.env.SHOT_EXPECTED_ROWS)
  : undefined;
const cardCounts = (process.env.SHOT_COUNTS ?? "4,6,8,10,12")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);
const cardPids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const profileIds = process.env.SHOT_PROFILES?.split(",").map((value) => value.trim());
const allProfiles = [
  { id: "pc-full", browser: "chromium", viewport: { width: 1440, height: 900 }, isMobile: false },
  { id: "pc-compressed", browser: "chromium", viewport: { width: 900, height: 520 }, isMobile: false },
  {
    id: "mobile-samsung",
    browser: "chromium",
    viewport: { width: 915, height: 412 },
    isMobile: true,
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "mobile-iphone",
    browser: "webkit",
    viewport: { width: 844, height: 390 },
    isMobile: true,
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
];
const profiles = profileIds?.length
  ? allProfiles.filter((profile) => profileIds.includes(profile.id))
  : allProfiles;

mkdirSync(outputRoot, { recursive: true });
const results = [];

for (const profile of profiles) {
  const browserType = profile.browser === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({ headless: true });
  for (const count of cardCounts) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor ?? 1,
      isMobile: profile.isMobile ?? false,
      hasTouch: profile.isMobile ?? false,
      userAgent: profile.userAgent,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(({ pids, cardCount, stageId }) => {
      localStorage.clear();
      localStorage.setItem("mvz443.debug.unlockAllCards", "1");
      localStorage.setItem("plantSelection", JSON.stringify({
        lastSelectedPlants: pids.slice(0, cardCount),
        lastStageId: stageId,
      }));
      localStorage.setItem("chapterSelection", JSON.stringify({ lastSelectedChapter: 1 }));
      localStorage.setItem("stageSelection", JSON.stringify({ lastSelectedStage: stageId, lastChapterId: 1 }));
      localStorage.setItem("levelSelectorState", JSON.stringify({ lastChapterId: 1, lastStageId: stageId, lastStep: "params" }));
    }, { pids: cardPids, cardCount: count, stageId });
    await page.goto(`${baseUrl}?autoSelectStage=${stageId}&fromPage=test&unlockAllCards=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    const pageText = await page.locator("body").innerText();
    const reloadButton = page.getByRole("button", { name: /重选上次|Reload/i }).first();
    if (await reloadButton.count()) {
      await reloadButton.click();
      await page.waitForTimeout(350);
    }

    const counterText = await page.locator("h3").first().innerText().catch(() => "");
    const startButton = page.getByRole("button", { name: /下一步|开始游戏|开始|Next|Start Game|Start/i }).last();
    const hasStart = await startButton.count();
    const selectedCount = Number((counterText.match(/(\d+)\s*\/\s*15/) || [])[1] ?? 0);
    if (hasStart) {
      await startButton.click();
    }
    await page.waitForSelector("#game-container canvas", { timeout: 12000 }).catch(() => undefined);
    let sceneReady = false;
    sceneReady = await page.waitForFunction((expectedCount) => {
      const scene = window.__MVZ443_GAME__;
      const cards = scene?.cardSlotsUi?.controller?.cards;
      return Boolean(scene && cards && cards.length === expectedCount);
    }, count, { timeout: 20000 }).then(() => true).catch(() => false);
    if (sceneReady) {
      await page.waitForFunction(() => {
        const cards = window.__MVZ443_GAME__?.cardSlotsUi?.controller?.cards ?? [];
        return cards.some((card) => card.energy > 0);
      }, null, { timeout: 5000 }).catch(() => undefined);
    }
    await page.waitForTimeout(800);

    const metrics = await page.evaluate(() => {
      const app = document.querySelector("#app");
      const container = document.querySelector("#mainContainer");
      const canvas = document.querySelector("#game-container canvas");
      const bounds = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      };
      const scene = window.__MVZ443_GAME__;
      const camera = scene?.battleCamera;
      const cards = scene?.cardSlotsUi?.controller?.cards ?? [];
      const energy = scene?.cardSlotsUi?.energyPanel;
      const pickaxe = scene?.cardSlotsUi?.controller?.pickaxe;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        app: bounds(app),
        container: bounds(container),
        canvas: bounds(canvas),
        pixelRatio: window.devicePixelRatio,
        sceneReady: Boolean(scene?.cardSlotsUi?.controller),
        stage: {
          level: scene?.params?.level,
          rows: scene?.stageData?.rows,
        },
        camera: camera ? {
          viewport: {
            x: camera.x,
            y: camera.y,
            width: camera.width,
            height: camera.height,
            right: camera.x + camera.width,
            bottom: camera.y + camera.height,
          },
          zoom: camera.zoom,
          scrollX: camera.scrollX,
          scrollY: camera.scrollY,
          worldView: { x: camera.worldView.x, y: camera.worldView.y, width: camera.worldView.width, height: camera.worldView.height },
        } : null,
        cards: cards.map((card) => ({
          index: card.index,
          frame: card.frame,
          x: card.container?.x,
          y: card.container?.y,
          width: card.width,
          height: card.height,
        })),
        energy: energy ? {
          x: energy.container?.x,
          y: energy.container?.y,
          width: energy.width,
          height: energy.height,
        } : null,
        pickaxe: pickaxe ? {
          x: pickaxe.container?.x,
          y: pickaxe.container?.y,
          width: pickaxe.width,
          height: pickaxe.height,
        } : null,
      };
    });

    const screenshot = join(outputRoot, `${profile.id}-${count}cards.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    const overflow = metrics.container && metrics.app
      ? Math.max(0, metrics.container.bottom - metrics.app.bottom, metrics.container.right - metrics.app.right)
      : 0;
    results.push({
      profile: profile.id,
      count,
      overflow,
      errors,
      sceneReady,
      stage: metrics.stage,
      expectedRows,
      counterText,
      hasStart: Boolean(hasStart),
      selectedCount,
      pagePreview: pageText.slice(0, 120).replace(/\s+/g, " "),
      metrics,
      screenshot,
    });
    await context.close();
  }
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
writeFileSync(join(outputRoot, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) =>
  result.errors.length > 0
  || !result.hasStart
  || !result.sceneReady
  || result.selectedCount !== result.count
  || (expectedRows !== undefined && result.stage.rows !== expectedRows)
)) {
  process.exitCode = 1;
}

