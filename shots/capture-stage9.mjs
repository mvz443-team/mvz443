/**
 * 第9关阶段截图 + 录屏脚本（本地 dev server + Playwright 无头 Chromium）。
 *
 * 用法（在 mvz443 目录）：
 *   node shots/capture-stage9.mjs
 *
 * 前置：dev server 已在 http://localhost:8080 运行。
 * 输出：shots/stage9-*.png 与 shots/stage9-phases.webm
 */
import { chromium } from "playwright";
import { mkdirSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("shots");
mkdirSync(OUT, { recursive: true });

const PLANTS = [
  { pid: 1, level: 5 },
  { pid: 2, level: 5 },
  { pid: 5, level: 5 },
  { pid: 8, level: 5 },
  { pid: 7, level: 5 },
  { pid: 9, level: 5 },
  { pid: 12, level: 5 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !t.includes("favicon")) console.log("[page:error]", t.slice(0, 300));
});
page.on("pageerror", (e) => console.log("[page:pageerror]", String(e).slice(0, 300)));

const video = page.video();

try {
  await page.goto("http://localhost:8080/?perfHarness=1&unlockall=1", { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.MVZ_NET, null, { timeout: 60000 });
  console.log("[capture] MVZ_NET ready");

  await page.evaluate((plants) => {
    window.MVZ_NET.startSinglePlayerForPerf(plants, 9, 1);
  }, PLANTS);
  console.log("[capture] startSinglePlayerForPerf(stage9) sent");

  await page.waitForFunction(() => !!window.__MVZ443_GAME__, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const g = window.__MVZ443_GAME__;
    const mobs = g?.ManagerGroup?.find((m) => m.constructor.name === "MobManager");
    return mobs && Array.isArray(mobs.waves) && mobs.waves.length > 0 && mobs.current_wave_idx >= 0;
  }, null, { timeout: 90000 });
  console.log("[capture] battle running");

  const getState = () => page.evaluate(() => {
    const g = window.__MVZ443_GAME__;
    const find = (n) => g.ManagerGroup.find((m) => m.constructor.name === n);
    const mobs = find("MobManager");
    const preset = find("PresetEventManager");
    const combat = find("CombatManager");
    return {
      wave: mobs?.current_wave_idx,
      total: mobs?.waves?.length,
      collapsed: preset?.stage22Collapsed,
      lightsOut: preset?.stage36LightRemoved,
      day: combat?.combatStatus?.dayOrNight,
    };
  });

  const ffTo = async (target) => {
    await page.evaluate(async (t) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = window.__MVZ443_GAME__;
      const mobs = g.ManagerGroup.find((m) => m.constructor.name === "MobManager");
      let guard = 0;
      while (mobs.current_wave_idx < t && guard < 400) {
        mobs.nextWave();
        guard++;
        await sleep(70);
      }
    }, target);
  };

  // 旗帜波字幕会遮挡画面，截图前隐藏（纯表现，不影响模拟；隐藏比销毁更安全）。
  const clearBanner = () => page.evaluate(() => {
    const g = window.__MVZ443_GAME__;
    for (const o of [...g.children.list]) {
      if (o.type === "Text" && /大波|来袭/.test(String(o.text ?? ""))) o.setVisible(false);
    }
  });

  await sleep(1200);
  await clearBanner();
  await page.screenshot({ path: `${OUT}/stage9-01-start.png` });
  console.log("[capture] state@start", JSON.stringify(await getState()));

  // 第 21 波：崩塌前（地面）
  await ffTo(21);
  await sleep(400);
  await clearBanner();
  await page.screenshot({ path: `${OUT}/stage9-21-before-collapse.png` });
  console.log("[capture] state@21", JSON.stringify(await getState()));

  // 第 22 波：崩塌成水路（水面替代贴图会持续存在）
  await ffTo(22);
  await sleep(700);
  await clearBanner();
  await page.screenshot({ path: `${OUT}/stage9-22-collapse.png` });
  console.log("[capture] state@22", JSON.stringify(await getState()));

  // 第 35 波：熄灯前（白天）
  await ffTo(35);
  await sleep(500);
  await clearBanner();
  await page.screenshot({ path: `${OUT}/stage9-35-before-lightsout.png` });
  console.log("[capture] state@35", JSON.stringify(await getState()));

  // 第 36 波：闪烁只有约 0.78s，截图很慢会错过峰值；
  // 把全屏暗色遮罩冻结在峰值 alpha（真实效果的一帧）后截图。
  await ffTo(36);
  await sleep(60);
  const frozen = await page.evaluate(() => {
    const g = window.__MVZ443_GAME__;
    const rects = g.children.list.filter((o) =>
      o.type === "Rectangle"
      && Math.round(o.depth) === 900000
      && o.width > 600
      && o.height > 400);
    for (const r of rects) {
      g.tweens.killTweensOf(r);
      r.setVisible(true);
      r.setAlpha(1); // 等效 fillAlpha 0.6，取最暗一帧
    }
    return rects.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), a: r.alpha, v: r.visible, d: Math.round(r.depth) }));
  });
  console.log("[capture] frozen flicker overlays =", frozen);
  await sleep(250);
  await clearBanner();
  await page.screenshot({ path: `${OUT}/stage9-36-lightsout.png` });
  console.log("[capture] state@36", JSON.stringify(await getState()));

  // 解除冻结：销毁遮罩，恢复常亮（模拟闪烁结束）
  await page.evaluate(() => {
    const g = window.__MVZ443_GAME__;
    for (const o of [...g.children.list]) {
      if (o.type === "Rectangle" && Math.round(o.depth) === 900000 && o.width > 600 && o.height > 400) {
        o.destroy();
      }
    }
  });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/stage9-36-after.png` });

  await sleep(600);
} catch (error) {
  console.log("[capture] ERROR", error?.stack || String(error));
  try { await page.screenshot({ path: `${OUT}/stage9-error.png` }); } catch {}
} finally {
  await context.close();
  await browser.close();
  if (video) {
    const src = await video.path();
    if (src && existsSync(src)) {
      const dst = resolve(OUT, "stage9-phases.webm");
      try { renameSync(src, dst); console.log("[capture] video ->", dst); }
      catch (e) { console.log("[capture] video rename failed:", String(e), "src=", src); }
    }
  }
}
console.log("[capture] done");
