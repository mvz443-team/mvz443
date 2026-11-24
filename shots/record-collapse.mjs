/**
 * 第9关「地面崩塌成水格」特效录制脚本（本地 dev server + Playwright 无头 Chromium）。
 *
 * 用法：node shots/record-collapse.mjs
 * 前置：dev server 已在 http://localhost:8080 运行。
 * 输出：shots/collapse-effect.webm（含崩塌前 → 崩塌瞬间 → 崩塌后）
 */
import { chromium } from "playwright";
import { mkdirSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("shots");
mkdirSync(OUT, { recursive: true });

const PLANTS = [
  { pid: 1, level: 5 }, { pid: 2, level: 5 }, { pid: 5, level: 5 },
  { pid: 8, level: 5 }, { pid: 7, level: 5 }, { pid: 9, level: 5 }, { pid: 12, level: 5 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
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
  console.log("[record] MVZ_NET ready");

  await page.evaluate((plants) => window.MVZ_NET.startSinglePlayerForPerf(plants, 9, 1), PLANTS);
  await page.waitForFunction(() => !!window.__MVZ443_GAME__, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const g = window.__MVZ443_GAME__;
    const mobs = g?.ManagerGroup?.find((m) => m.constructor.name === "MobManager");
    return mobs && Array.isArray(mobs.waves) && mobs.waves.length > 0 && mobs.current_wave_idx >= 0;
  }, null, { timeout: 90000 });
  console.log("[record] battle running");

  const getState = () => page.evaluate(() => {
    const g = window.__MVZ443_GAME__;
    const find = (n) => g.ManagerGroup.find((m) => m.constructor.name === n);
    return {
      wave: find("MobManager")?.current_wave_idx,
      collapsed: find("PresetEventManager")?.stage22Collapsed,
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

  const clearBanner = () => page.evaluate(() => {
    const g = window.__MVZ443_GAME__;
    for (const o of [...g.children.list]) {
      if (o.type === "Text" && /大波|来袭/.test(String(o.text ?? ""))) o.setVisible(false);
    }
  });

  await sleep(1000);
  await clearBanner();

  // 崩塌前停留一会，让观众看清原始土地。
  await ffTo(21);
  await sleep(500);
  await clearBanner();
  console.log("[record] state@21", JSON.stringify(await getState()));
  await page.screenshot({ path: `${OUT}/collapse-01-before.png` });

  // 触发第 22 波崩塌；新特效总时长约 0.76s。
  await ffTo(22);
  console.log("[record] collapse triggered", JSON.stringify(await getState()));
  // 录屏持续捕获动画全过程，截图抓取中间一帧用于静态检查。
  await sleep(180);
  await page.screenshot({ path: `${OUT}/collapse-02-mid.png` });
  await sleep(900);
  await clearBanner();
  console.log("[record] state@22", JSON.stringify(await getState()));
  await page.screenshot({ path: `${OUT}/collapse-03-after.png` });

  await sleep(700);
} catch (error) {
  console.log("[record] ERROR", error?.stack || String(error));
  try { await page.screenshot({ path: `${OUT}/collapse-error.png` }); } catch {}
} finally {
  await context.close();
  await browser.close();
  if (video) {
    const src = await video.path();
    if (src && existsSync(src)) {
      const dst = resolve(OUT, "collapse-effect.webm");
      try { renameSync(src, dst); console.log("[record] video ->", dst); }
      catch (e) { console.log("[record] video rename failed:", String(e), "src=", src); }
    }
  }
}
console.log("[record] done");
