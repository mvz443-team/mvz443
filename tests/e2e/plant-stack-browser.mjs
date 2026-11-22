import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const SAVE = {
  level: [{ chapterId: 1, levelId: 1, status: 'unlocked' }],
  plants: [
    { pid: 1, level: 1 }, { pid: 6, level: 1 }, { pid: 9, level: 1 },
    { pid: 11, level: 1 }, { pid: 14, level: 1 }, { pid: 19, level: 1 },
    { pid: 10, level: 1 }, { pid: 17, level: 1 },
  ],
  zombies: [],
  items: [],
  slotNum: 9,
  updatedAt: Date.now(),
  online: { username: '', serverAddr: '', customServers: [] },
};

async function injectSave(page) {
  await page.addInitScript(({ data }) => {
    localStorage.setItem('mvz443.debug.dbgCommands', '1');
    localStorage.setItem('mvz443.debug.unlockall', '1');
    const request = indexedDB.open('MVZ443', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('gameProgress')) {
        db.createObjectStore('gameProgress', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('gameProgress', 'readwrite');
      tx.objectStore('gameProgress').put({ ...data, id: 1 });
      tx.oncomplete = () => db.close();
    };
  }, { data: SAVE });
}

async function startGame(page) {
  await page.goto(`${BASE}/?autoSelectStage=1&fromPage=probe`);
  await page.waitForSelector('#app', { timeout: 30000 });
  await page.waitForTimeout(1800);
  await page.getByText('发射器', { exact: true }).first().click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.waitForSelector('#game-container canvas', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__MVZ443_GAME__), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

const SETUP = `
  const game = window.__MVZ443_GAME__;
  const managers = game.ManagerGroup ?? [];
  const pm = managers.find((m) => m?.constructor?.name === 'PlantsManager');
  const gm = managers.find((m) => m?.constructor?.name === 'GridManager');
  const dm = managers.find((m) => m?.constructor?.name === 'DeferredManager');
  const col = 4, row = 2;
  const plant = (pid, level = 1) => {
    const result = { pid, ...pm.PlantCardDirect(9961, pid, level, col, row) };
    dm.flush();
    return result;
  };
  const cell = () => (pm.PlantsMap.get(\`\${col}-\${row}\`) ?? []).map((p) => ({
    pid: p.model.pid,
    health: p.currentHealth,
    role: p.model.stackRole,
    sleeping: p.isSleeping,
    spiky: p.model.isSpiky === true,
    brute: p.model.inBruteShoot === true,
    entityBrute: p.inBruteShoot === true,
    destroyed: p.destroyed === true,
  }));
  const entity = (pid) => (pm.PlantsMap.get(\`\${col}-\${row}\`) ?? []).find((p) => p.model.pid === pid);
`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await injectSave(page);
const results = {};

async function run(name, body, screenshot) {
  await startGame(page);
  results[name] = await page.evaluate(new Function(`return (async () => { ${body} })();`));
  if (screenshot) await page.screenshot({ path: `screenshots/${screenshot}`, fullPage: false });
  console.log(`[ok] ${name}`);
}

try {
  await run('S1_normalOnLily', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    const planted = [plant(6), plant(1)];
    return { planted, cell: cell() };
  `, 'stack-S1.png');

  await run('S2_secondNormal', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1);
    const second = plant(1);
    return { second, cell: cell() };
  `);

  await run('S3_secondShield', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    const second = plant(19);
    return { second, cell: cell() };
  `);

  await run('S4_advancedWithoutBase', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    const advanced = plant(11);
    return { advanced, cell: cell() };
  `);

  await run('S5_advancedReplaceOnlyPumpkin', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(19); plant(9);
    const pumpkin = entity(9);
    const before = cell();
    const advanced = plant(11);
    const after = cell();
    return {
      before,
      advanced,
      after,
      pumpkinDestroyed: pumpkin?.destroyed === true,
    };
  `, 'stack-S5.png');

  await run('S6_atWithoutBase', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'ground' });
    const at = plant(14);
    return { at, cell: cell() };
  `);

  await run('S7_waterWithoutLily', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    const normal = plant(1);
    const magic = plant(10);
    return { normal, magic, cell: cell() };
  `);

  await run('S8_glowPowderOnExisting', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'ground' });
    plant(1);
    const normal = entity(1);
    normal.model.isSleeping = true;
    const before = cell();
    const glow = plant(17);
    const after = cell();
    return { before, glow, after };
  `, 'stack-S8.png');

  await run('S9_glowPowderOnEmpty', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'ground' });
    const glow = plant(17);
    return { glow, cell: cell() };
  `);

  await run('S10_shovelDown', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    const before = cell();
    pm.handleAttemptRemovePlant(col, row, 'down');
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after: cell() };
  `, 'stack-S10.png');

  await run('S11_shovelUp', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    const before = cell();
    pm.handleAttemptRemovePlant(col, row, 'up');
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after: cell() };
  `);

  await run('S12_starDown', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    window.DBG.addResource('starshards', 5);
    const before = cell();
    pm.handleAttemptUseStarShards(col, row, 'down');
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after: cell() };
  `, 'stack-S12.png');

  await run('S13_starUp', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    window.DBG.addResource('starshards', 5);
    const before = cell();
    pm.handleAttemptUseStarShards(col, row, 'up');
    await new Promise((r) => setTimeout(r, 1200));
    return { before, after: cell() };
  `);

  await run('S19_bruteShootViewSync', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'ground' });
    plant(1);
    const dispenser = entity(1);
    const restX = dispenser.head.x;
    dispenser.model.inBruteShoot = true;
    dispenser.syncViewFromModel();
    const heldX = dispenser.head.x;
    dispenser.model.inBruteShoot = false;
    dispenser.syncViewFromModel();
    const resetX = dispenser.head.x;
    return {
      restX,
      heldX,
      resetX,
      moveDistance: dispenser.head.displayWidth * 0.15,
      modelBrute: dispenser.model.inBruteShoot,
      entityBrute: dispenser.inBruteShoot,
    };
  `, 'stack-S19.png');

  await run('S15_S16_zombieBite', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    const shield = entity(19);
    shield.currentHealth = 30;
    window.DBG.spawnMonster(1, row, col);
    const before = cell();
    await new Promise((r) => setTimeout(r, 4000));
    const after = cell();
    const mobs = (managers.find((m) => m?.constructor?.name === 'MobManager')?.MobsByLane.get(row) ?? [])
      .map((m) => ({ mid: m.model.mid, attacking: m.attacking?.model?.pid ?? null }));
    return { before, after, mobs };
  `, 'stack-S15.png');

  await run('S17_S18_arrowHit', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'water' });
    plant(6); plant(1); plant(19);
    const before = cell();
    window.DBG.spawnMonster(16, row, 7);
    await new Promise((r) => setTimeout(r, 6000));
    return { before, after: cell() };
  `, 'stack-S17.png');

  await run('S18_arrowTinyShieldOnly', `
    ${SETUP}
    gm.setSingleGridProperty(col, row, { type: 'ground' });
    plant(19);
    const before = cell();
    window.DBG.spawnMonster(16, row, 7);
    await new Promise((r) => setTimeout(r, 6000));
    return { before, after: cell() };
  `, 'stack-S18.png');

  fs.writeFileSync('screenshots/plant-stack-results.json', JSON.stringify(results, null, 2));
  console.log('\n=== SUMMARY ===');
  for (const [name, value] of Object.entries(results)) {
    if (value?.restX !== undefined) {
      console.log(name, '=> rest', value.restX, 'held', value.heldX, 'reset', value.resetX);
      continue;
    }
    const cell = value?.after ?? value?.cell ?? [];
    console.log(name, '=>', cell.map((p) => `${p.pid}:${p.health}${p.sleeping ? ':sleep' : ''}${p.spiky ? ':spiky' : ''}${p.brute ? ':brute' : ''}${p.entityBrute ? ':ebrute' : ''}`).join(' | '));
  }
  console.log('saved screenshots/plant-stack-results.json');
} finally {
  await context.close();
  await browser.close();
}
