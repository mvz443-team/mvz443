import assert from "node:assert/strict";
import test from "node:test";

import { ProjectileCmd } from "./ProjectileCmd.ts";

test("跨局清理重置投射物序号，避免第二局首帧摘要分叉", () => {
  // 上一局产生的序号会进入 projectile.seq 跨端哈希；页面不刷新连续开新局时
  // 必须归零，否则两端从第一帧起摘要不同。
  ProjectileCmd.restoreSequence(1239);
  assert.equal(ProjectileCmd.captureSequence(), 1239);

  ProjectileCmd.clearProjectiles();
  assert.equal(ProjectileCmd.captureSequence(), 1);
  assert.equal(ProjectileCmd.getActiveProjectiles().length, 0);
});

test("跨局清理带 scene 时不误清新一局已绑定的投射物", () => {
  const oldScene = { id: "old" };
  const newScene = { id: "new" };
  ProjectileCmd.setScene(oldScene);
  ProjectileCmd.restoreSequence(77);

  // 新场景已经接管注册表时，旧场景的延迟 teardown 不能复位序号。
  ProjectileCmd.setScene(newScene);
  ProjectileCmd.clearProjectiles(oldScene);
  assert.equal(ProjectileCmd.captureSequence(), 77);

  ProjectileCmd.clearProjectiles(newScene);
  assert.equal(ProjectileCmd.captureSequence(), 1);
});
