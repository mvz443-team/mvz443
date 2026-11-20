import test from "node:test";
import assert from "node:assert/strict";

import { isNetDebugEnabled, setNetDebugEnabled } from "../debugFlags.ts";
import { desyncDiagnostics } from "./desyncDiagnostics.ts";

test("netDebug 关闭后停止记录并阻止下载，重新开启后恢复", () => {
  const initial = isNetDebugEnabled();
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  const downloads = [];

  try {
    globalThis.document = {
      createElement: () => ({
        set href(_value) {},
        set download(value) { downloads.push(value); },
        click() {},
        remove() {},
      }),
      body: { appendChild() {} },
    };
    globalThis.URL.createObjectURL = () => "blob:test";
    globalThis.URL.revokeObjectURL = () => {};

    setNetDebugEnabled(true);
    desyncDiagnostics.record("test", "before-disable");
    assert.equal(desyncDiagnostics.isEnabled(), true);
    assert.equal(desyncDiagnostics.snapshot().entries.length > 0, true);

    setNetDebugEnabled(false);
    assert.equal(desyncDiagnostics.isEnabled(), false);
    assert.equal(desyncDiagnostics.snapshot().entries.length, 0);

    desyncDiagnostics.record("test", "after-disable");
    desyncDiagnostics.download("client-exit");
    assert.equal(desyncDiagnostics.snapshot().entries.length, 0);
    assert.equal(downloads.length, 0);

    setNetDebugEnabled(true);
    desyncDiagnostics.record("test", "after-enable");
    desyncDiagnostics.download("game-end");
    assert.equal(desyncDiagnostics.isEnabled(), true);
    assert.equal(desyncDiagnostics.snapshot().entries.length > 0, true);
    assert.equal(downloads.length, 1);
  } finally {
    setNetDebugEnabled(initial);
    globalThis.document = originalDocument;
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
