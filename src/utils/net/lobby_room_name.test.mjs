import assert from 'node:assert/strict';
import test from 'node:test';

// 房间名为空时，创建房间应使用灰色占位名"方块人互砍"，
// 而不是弹出"请填写房间名"。归一化与默认回退集中在 lobby.ts，
// UI 输入框与调试入口(createRoom)共用同一规则。

const { DEFAULT_ROOM_NAME, normalizeRoomName, resolveRoomName } = await import('./lobby.ts');

test('默认房间名占位文案', () => {
  assert.equal(DEFAULT_ROOM_NAME, '方块人互砍');
  // 占位文案本身是合法房间名（不超过 6 字），回退后不会再次触发默认逻辑。
  assert.equal(normalizeRoomName(DEFAULT_ROOM_NAME), DEFAULT_ROOM_NAME);
});

test('空房间名回退到占位名', () => {
  assert.equal(resolveRoomName(''), DEFAULT_ROOM_NAME);
  assert.equal(resolveRoomName(undefined), DEFAULT_ROOM_NAME);
});

test('有房间名时保持归一化结果', () => {
  assert.equal(resolveRoomName('我的房间'), '我的房间');
  assert.equal(resolveRoomName('abcdefghij'), 'abcdef');
});
