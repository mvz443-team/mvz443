/**
 * 用 Playwright 进关并通过 DBG.spawnMonster 生成新僵尸，截图不同形态的渲染状态。
 * 每张图会再生成一份 *_zoom.png（2 倍最近邻放大），方便调节面罩等小图层。
 *
 * 前置：本地开发服务器已启动（npm run dev-nolog）。
 * 用法：
 *   node scripts/monster-shape-screenshots.mjs            # 全部 4 张
 *   node scripts/monster-shape-screenshots.mjs --diving   # 只截潜水僵尸（调节面罩时最快）
 *   node scripts/monster-shape-screenshots.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const onlyDiving = args.includes("--diving");
const baseUrl = args.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:8080";
const outDir = path.resolve("screenshots/monster-shapes");
mkdirSync(outDir, { recursive: true });

const ZOOM_BOX = {
  "01_boat_and_diving": "380,420,320,180",
  "04_diving_surfaced": "380,420,320,180",
  "02_dolphin_riding": "380,480,320,220",
  "03_dolphin_after_mount_broken": "380,480,320,220",
};

const PY_ZOOM = `
import sys
from PIL import Image
src, dst, spec = sys.argv[1], sys.argv[2], sys.argv[3]
x, y, w, h = map(int, spec.split(","))
Image.open(src).crop((x, y, x + w, y + h)).resize((w * 2, h * 2), Image.NEAREST).save(dst)
`;

function makeZoom(name, file) {
  const zoomFile = path.join(outDir, `${name}_zoom.png`);
  try {
    execFileSync("python", ["-c", PY_ZOOM, file, zoomFile, ZOOM_BOX[name]], { stdio: "ignore" });
    console.log(`zoom:  ${zoomFile}`);
  } catch {
    console.log("zoom:  跳过（需要 python + Pillow）");
  }
}

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
    makeZoom(name, file);
  } catch (error) {
    console.error(`FAILED ${name}: ${error}`);
  } finally {
    await page.close();
  }
}

const shots = [
  ["01_boat_and_diving", () => {
    window.DBG.spawnMonster(22, 0, 5);
    window.DBG.spawnMonster(24, 1, 5);
    window.DBG.spawnMonster(27, 4, 5);
    return "boat/boat-helmet/diving";
  }],
  ["04_diving_surfaced", () => {
    const diver = window.DBG.spawnMonster(27, 4, 5);
    // 直接走攻击起始的视图同步，展示"探出身来"形态（真实攻击时序由单测覆盖）。
    if (diver) diver.model.setSurfaced(diver);
    return "diving surfaced / attack pose";
  }],
  ["02_dolphin_riding", () => {
    window.DBG.spawnMonster(28, 5, 5);
    return "dolphin mounted";
  }],
  ["03_dolphin_after_mount_broken", () => {
    const rider = window.DBG.spawnMonster(28, 5, 5);
    if (rider) {
      rider.model.breakMount(rider);
      rider.syncViewFromModel();
    }
    return "mount broken";
  }],
];

for (const [name, script] of shots) {
  if (onlyDiving && !name.includes("diving")) continue;
  await capture(name, script);
}

await browser.close();
