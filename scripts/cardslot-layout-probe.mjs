import { chromium, webkit } from "playwright";

const baseUrl = process.env.GAME_URL ?? "http://127.0.0.1:8080/";
const pids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const isMobile = process.env.PROBE_MOBILE === "1";
const cardCount = Number(process.env.PROBE_CARDS ?? "12");
const stageId = Number(process.env.PROBE_STAGE ?? "1");
const viewport = {
  width: Number(process.env.PROBE_WIDTH ?? (isMobile ? "915" : "900")),
  height: Number(process.env.PROBE_HEIGHT ?? (isMobile ? "412" : "520")),
};
const browserType = process.env.PROBE_WEBKIT === "1" ? webkit : chromium;

const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({
  viewport,
  isMobile,
  hasTouch: isMobile,
  deviceScaleFactor: isMobile ? 3 : 1,
  userAgent: isMobile
    ? process.env.PROBE_WEBKIT === "1"
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
    : undefined,
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
}, { pids, cardCount, stageId });
await page.goto(`${baseUrl}?autoSelectStage=${stageId}&fromPage=test&unlockAllCards=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
const reloadButton = page.getByRole("button", { name: /重选上次|Reload/i }).first();
if (await reloadButton.count()) {
  await reloadButton.click();
  await page.waitForTimeout(350);
}
const startButton = page.getByRole("button", { name: /下一步|开始游戏|开始|Next|Start Game|Start/i }).last();
if (await startButton.count()) await startButton.click();
await page.waitForFunction(() => Boolean(window.__MVZ443_GAME__), null, { timeout: 15000 }).catch(() => undefined);
await page.waitForTimeout(2500);

const probe = await page.evaluate(() => {
  const game = window.__MVZ443_GAME__;
  const scene = game;
  const camera = scene?.battleCamera;
  const uiCamera = scene?.uiCamera;
  const background = scene?.background;
  const slots = scene?.cardSlotsUi;
  const cards = slots?.controller?.cards ?? [];
  const rect = (value) => value ? ({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    right: value.right,
    bottom: value.bottom,
  }) : null;
  return {
    errors: [],
    scale: {
      gameSize: scene?.scale?.gameSize,
      baseSize: scene?.scale?.baseSize,
      displaySize: scene?.scale?.displaySize,
      canvasBounds: rect(scene?.scale?.canvas?.getBoundingClientRect?.()),
    },
    camera: camera ? {
      viewport: rect(camera),
      zoom: camera.zoom,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      worldView: rect(camera.worldView),
    } : null,
    uiCamera: uiCamera ? { viewport: rect(uiCamera), zoom: uiCamera.zoom } : null,
    background: background ? {
      x: background.x,
      y: background.y,
      displayWidth: background.displayWidth,
      displayHeight: background.displayHeight,
      originX: background.originX,
      originY: background.originY,
      depth: background.depth,
      textureWidth: background.width,
      textureHeight: background.height,
    } : null,
    cards: cards.map((card) => ({
      index: card.index,
      x: card.container?.x,
      y: card.container?.y,
      width: card.width,
      height: card.height,
      energy: card.energy,
      reloaded: card.reloaded,
    })),
    stageEnergy: scene?.stageData?.energy,
    params: scene?.params ? {
      deviceType: scene.params.deviceType,
      mainViewportWidth: scene.params.mainViewportWidth,
      mainViewportHeight: scene.params.mainViewportHeight,
      plants: scene.params.plants?.length,
    } : null,
  };
});

console.log(JSON.stringify({ errors, probe }, null, 2));
await browser.close();
