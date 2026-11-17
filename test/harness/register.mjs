import { register } from "node:module";
import Phaser from "./stubs/phaser.mjs";

// 部分 preset 直接使用全局 Phaser（例如 Phaser.Math.Clamp）。
globalThis.Phaser = Phaser;
register("./loader.mjs", import.meta.url);
