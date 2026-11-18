import assert from 'node:assert/strict';
import test from 'node:test';

// 前端级对话框服务：订阅渲染器、confirm 返回值、alert 单按钮、取消订阅。
const { subscribeDialog, showConfirm, showAlert } = await import('../uiDialog.ts');

test('showConfirm 等待渲染器 settle(true) 并返回 true', async () => {
  const seen = [];
  const unsubscribe = subscribeDialog((request) => {
    if (request) {
      seen.push(request);
      queueMicrotask(() => request.settle(true));
    }
  });
  const result = await showConfirm('要重连吗？', { title: '房间' });
  unsubscribe();
  assert.equal(result, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'confirm');
  assert.equal(seen[0].message, '要重连吗？');
  assert.equal(seen[0].title, '房间');
});

test('showConfirm 收到 false 时返回 false 且清空当前对话框', async () => {
  const updates = [];
  const unsubscribe = subscribeDialog((request) => {
    updates.push(request ? request.id : null);
    if (request) {
      queueMicrotask(() => request.settle(false));
    }
  });
  const result = await showConfirm('离开房间？');
  unsubscribe();
  assert.equal(result, false);
  assert.equal(updates.length, 2);
  assert.equal(updates[1], null);
});

test('showAlert 是单按钮提示，settle 后 resolve', async () => {
  let captured = null;
  const unsubscribe = subscribeDialog((request) => {
    if (request) {
      captured = request;
      queueMicrotask(() => request.settle(true));
    }
  });
  await showAlert('房间已满');
  unsubscribe();
  assert.equal(captured.kind, 'alert');
  assert.equal(captured.message, '房间已满');
});

test('取消订阅后不再收到新对话框', async () => {
  const seen = [];
  const unsubscribe = subscribeDialog((request) => {
    if (request) {
      seen.push(request.id);
      queueMicrotask(() => request.settle(true));
    }
  });
  await showAlert('first');
  unsubscribe();
  // 无渲染器时走 window.confirm/alert 兜底，Node 里用 stub 避免抛错。
  globalThis.window ??= globalThis;
  globalThis.window.alert ??= () => undefined;
  await showAlert('second');
  assert.equal(seen.length, 1);
});
