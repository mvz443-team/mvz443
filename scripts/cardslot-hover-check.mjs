import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.GAME_URL ?? "http://127.0.0.1:8080/";
const outputDir = process.env.SHOT_DIR ?? "artifacts/cardslots/col4";
const stageId = Number(process.env.SHOT_STAGE ?? "3");
const cardPids = [1, 2, 3, 4, 5, 6];

mkdirSync(outputDir, { recursive: true });

async function openGame(browser, options) {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    isMobile: options.isMobile ?? false,
    hasTouch: options.isMobile ?? false,
    userAgent: options.userAgent,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ pids, count, stageId }) => {
    localStorage.clear();
    localStorage.setItem("mvz443.debug.unlockAllCards", "1");
    localStorage.setItem("plantSelection", JSON.stringify({
      lastSelectedPlants: pids.slice(0, count),
      lastStageId: stageId,
    }));
    localStorage.setItem("chapterSelection", JSON.stringify({ lastSelectedChapter: 1 }));
    localStorage.setItem("stageSelection", JSON.stringify({ lastSelectedStage: stageId, lastChapterId: 1 }));
    localStorage.setItem("levelSelectorState", JSON.stringify({
      lastChapterId: 1,
      lastStageId: stageId,
      lastStep: "params",
    }));
  }, { pids: cardPids, count: options.count, stageId });
  await page.goto(
    `${baseUrl}?autoSelectStage=${stageId}&fromPage=test&unlockAllCards=1`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(900);

  const reloadButton = page.getByRole("button", { name: /重选上次|Reload/i }).first();
  if (await reloadButton.count()) {
    await reloadButton.click();
    await page.waitForTimeout(350);
  }
  const startButton = page.getByRole("button", {
    name: /下一步|开始游戏|开始|Next|Start Game|Start/i,
  }).last();
  if (await startButton.count()) {
    await startButton.click();
  }
  await page.waitForSelector("#game-container canvas", { timeout: 12000 });
  await page.waitForFunction((expectedCount) => {
    const cards = window.__MVZ443_GAME__?.cardSlotsUi?.controller?.cards;
    return Boolean(cards && cards.length === expectedCount);
  }, options.count, { timeout: 20000 });
  await page.waitForTimeout(600);
  return { context, page, errors };
}

async function hoverFirstCard(page) {
  const position = await page.evaluate(() => {
    const scene = window.__MVZ443_GAME__;
    const card = scene.cardSlotsUi.controller.cards[0];
    const canvas = document.querySelector("#game-container canvas").getBoundingClientRect();
    const scaleX = canvas.width / scene.scale.gameSize.width;
    const scaleY = canvas.height / scene.scale.gameSize.height;
    return {
      x: canvas.x + (card.container.x + card.width / 2) * scaleX,
      y: canvas.y + (card.container.y + card.height / 2) * scaleY,
    };
  });
  await page.mouse.move(position.x, position.y);
  await page.waitForTimeout(450);
  return position;
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  const pc = await openGame(browser, {
    count: 4,
    viewport: { width: 1440, height: 900 },
  });
  await hoverFirstCard(pc.page);
  const pcTooltip = await pc.page.evaluate(() => {
    const card = window.__MVZ443_GAME__?.cardSlotsUi?.controller?.cards?.[0];
    const tooltip = card?.tooltip;
    if (!tooltip) return { exists: false };
    const text = tooltip.list.find((child) => child.type === "Text");
    return {
      exists: true,
      visible: tooltip.visible,
      text: text?.text ?? "",
      fontSize: text?.style?.fontSize ?? "",
      color: text?.style?.color ?? "",
      lineCount: (text?.text?.match(/\n/g) ?? []).length + 1,
      cardScale: card.container.scaleX,
    };
  });
  const pcScreenshot = join(outputDir, "pc-card-hover-tooltip.png");
  await pc.page.screenshot({ path: pcScreenshot });
  results.push({ profile: "pc-full", pcTooltip, errors: pc.errors, screenshot: pcScreenshot });
  await pc.context.close();

  const mobile = await openGame(browser, {
    count: 4,
    viewport: { width: 915, height: 412 },
    isMobile: true,
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });
  await hoverFirstCard(mobile.page);
  const mobileHover = await mobile.page.evaluate(() => {
    const card = window.__MVZ443_GAME__?.cardSlotsUi?.controller?.cards?.[0];
    return {
      tooltipIsNull: card?.tooltip === null,
      cardScale: card?.container?.scaleX ?? null,
    };
  });
  const mobileScreenshot = join(outputDir, "mobile-no-hover.png");
  await mobile.page.screenshot({ path: mobileScreenshot });
  results.push({
    profile: "mobile-samsung",
    mobileHover,
    errors: mobile.errors,
    screenshot: mobileScreenshot,
  });
  await mobile.context.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));

const pcResult = results.find((result) => result.profile === "pc-full");
const mobileResult = results.find((result) => result.profile === "mobile-samsung");
const passed = results.every((result) => result.errors.length === 0)
  && pcResult?.pcTooltip?.visible === true
  && pcResult?.pcTooltip?.lineCount === 1
  && pcResult?.pcTooltip?.color === "#1b1208"
  && Number.parseInt(pcResult?.pcTooltip?.fontSize ?? "", 10) <= 13
  && mobileResult?.mobileHover?.tooltipIsNull === true
  && mobileResult?.mobileHover?.cardScale === 1;

if (!passed) {
  process.exitCode = 1;
}
