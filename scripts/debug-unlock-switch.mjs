import { chromium } from "playwright";

const baseUrl = process.env.GAME_URL ?? "http://127.0.0.1:8080/";
const unlockKey = "mvz443.debug.unlockAllCards";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

async function readFlag() {
  await page.waitForFunction(() => Boolean(document.querySelector("#app")), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return page.evaluate((key) => window.localStorage.getItem(key), unlockKey);
}

async function toggleWithShortcut() {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.keyboard.press("Control+Shift+U"),
  ]);
  return readFlag();
}

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(document.querySelector("#app")), null, { timeout: 15000 });
await page.evaluate((key) => window.localStorage.setItem(key, "1"), unlockKey);
await page.waitForTimeout(500);
const afterStorageOn = await readFlag();

const afterShortcutOff = await toggleWithShortcut();
const afterShortcutOn = await toggleWithShortcut();

await page.evaluate((key) => window.localStorage.removeItem(key), unlockKey);
const afterManualOff = await readFlag();

await page.goto(`${baseUrl}?unlockAllCards=1`, { waitUntil: "domcontentloaded" });
const afterQueryOn = await readFlag();
const afterQueryShortcutOff = await toggleWithShortcut();
const queryRemoved = await page.evaluate(() => !new URL(window.location.href).searchParams.has("unlockAllCards"));

const result = {
  afterStorageOn,
  afterShortcutOff,
  afterShortcutOn,
  afterManualOff,
  afterQueryOn,
  afterQueryShortcutOff,
  queryRemoved,
  errors,
};
console.log(JSON.stringify(result, null, 2));

const passed =
  errors.length === 0 &&
  afterStorageOn === "1" &&
  afterShortcutOff === null &&
  afterShortcutOn === "1" &&
  afterManualOff === null &&
  afterQueryOn === "1" &&
  afterQueryShortcutOff === null &&
  queryRemoved;

if (!passed) {
  process.exitCode = 1;
}

await browser.close();
