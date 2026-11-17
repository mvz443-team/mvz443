/**
 * 测试用模块加载器。
 *
 * 目的：让 Node 直接加载真实 `src/game/presets/**` 里的 Model，
 * 同时把 Phaser / Entity / Manager / Cmd 这些表现与世界胶水替换成
 * 可观测的测试替身。Model 代码本身不做任何改写。
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolvePath(HERE, "../..");
const requireFromProject = createRequire(pathToFileURL(resolvePath(PROJECT_ROOT, "package.json")));
const ts = requireFromProject("typescript");

const STUB_DIR = pathToFileURL(resolvePath(HERE, "stubs")).href;

function stub(name) {
  return `${STUB_DIR}/${name}`;
}

const PHASER_STUB = stub("phaser.mjs");

/** 按源文件绝对路径匹配替身；顺序敏感（先具体后通用）。 */
const STUB_RULES = [
  [/\/models\/entities\/PlantEntity\.ts$/, stub("plant-entity.mjs")],
  [/\/models\/entities\/SightLineEntity\.ts$/, stub("sightline.mjs")],
  [/\/models\/core\/CombatEntity\.ts$/, stub("combat-entity.mjs")],
  [/\/models\/entities\/ObstacleEntity\.ts$/, stub("obstacle-entity.mjs")],
  [/\/models\/projectiles\/BulletEntity\.ts$/, stub("bullet-entity.mjs")],
  [/\/models\/monster\/anims\/LegacyMonsterAnimControllers\.ts$/, stub("legacy-anims.mjs")],
  [/\/sprite\/shoot_anim\.ts$/, stub("shoot-anim.mjs")],

  [/\/utils\/cmd\/ProjectileCmd\.ts$/, stub("cmd-projectile.mjs")],
  [/\/utils\/cmd\/ResourceCmd\.ts$/, stub("cmd-resource.mjs")],
  [/\/utils\/cmd\/MobCmd\.ts$/, stub("cmd-mob.mjs")],
  [/\/utils\/cmd\/PlantCmd\.ts$/, stub("cmd-plant.mjs")],
  [/\/utils\/cmd\/ObstacleCmd\.ts$/, stub("cmd-obstacle.mjs")],
  [/\/utils\/cmd\/SfxCmd\.ts$/, stub("cmd-sfx.mjs")],
  [/\/utils\/cmd\/SoundCmd\.ts$/, stub("cmd-sound.mjs")],

  [/\/utils\/helper\/PlantHelper\.ts$/, stub("helper-plant.mjs")],
  [/\/utils\/helper\/StageHelper\.ts$/, stub("helper-stage.mjs")],

  [/\/presets\/obstacle\/index\.ts$/, stub("obstacle-data.mjs")],
  [/\/presets\/bullet\/arrow\.ts$/, stub("bullet-arrow.mjs")],
  [/\/presets\/bullet\/firework\.ts$/, stub("bullet-firework.mjs")],
  [/\/presets\/bullet\/snowball\.ts$/, stub("bullet-snowball.mjs")],

  [/\/managers\/(view\/PositionManager|BaseManager)\.ts$/, null],
  [/\/managers\//, stub("manager-generic.mjs")],
  [/\/sfx\/([^/]+)\.ts$/, "virtual-sfx"],
  [/\/sprite\//, stub("sprite-generic.mjs")],
];

function mapStub(absolutePath) {
  const normalized = absolutePath.replace(/\\/g, "/");
  for (const [pattern, target] of STUB_RULES) {
    const match = normalized.match(pattern);
    if (match) {
      if (target === "virtual-sfx") {
        const basename = match[1] ?? "StubSfx";
        return `virtual-sfx:${basename}`;
      }
      return target;
    }
  }
  return null;
}

function tryRelativeFile(specifier, context) {
  if (!specifier.startsWith(".")) return null;
  if (/\.[a-zA-Z0-9]+$/.test(specifier)) return null;
  const base = dirname(fileURLToPath(context.parentURL));
  const target = resolvePath(base, specifier);
  for (const candidate of [`${target}.ts`, `${target}.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of [`${target}/index.ts`, `${target}/index.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "phaser") {
    return { url: PHASER_STUB, shortCircuit: true };
  }

  const relativeTarget = tryRelativeFile(specifier, context);
  if (relativeTarget) {
    const replacement = mapStub(relativeTarget);
    return {
      url: replacement ?? pathToFileURL(relativeTarget).href,
      shortCircuit: true,
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("lodash/")) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}

function sfxStubSource(url) {
  const name = decodeURIComponent(url.slice("virtual-sfx:".length)).replace(/[^A-Za-z0-9_$]/g, "");
  const safe = name || "StubSfx";
  return [
    `export class ${safe} {`,
    `  constructor(args) { this.args = args; this.played = false; }`,
    `  play() { this.played = true; return this; }`,
    `  stop() { return this; }`,
    `  destroy() { return this; }`,
    `}`,
    `export default ${safe};`,
  ].join("\n");
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("virtual-sfx:")) {
    return { format: "module", shortCircuit: true, source: sfxStubSource(url) };
  }

  if (url.endsWith(".json")) {
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`,
    };
  }

  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const result = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        useDefineForClassFields: true,
        isolatedModules: true,
        jsx: ts.JsxEmit.ReactJSX,
        allowImportingTsExtensions: true,
      },
    });
    return { format: "module", shortCircuit: true, source: result.outputText };
  }

  return nextLoad(url, context);
}
