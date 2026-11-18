// TEMP-DESYNC-LOG: 必须最先导入，保证后续模块初始化日志也能被捕获。
import { desyncDiagnostics } from './utils/debug/desyncDiagnostics.ts';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { SettingsProvider } from './context/settings_ctx.tsx';
import { SaveProvider } from './context/save_ctx.tsx';

// TEMP-DESYNC-LOG: 尽早安装控制台/异常捕获，覆盖进入战斗前的联机消息。
desyncDiagnostics.install();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <SaveProvider>
        <App />
      </SaveProvider>
    </SettingsProvider>
  </React.StrictMode>,
)
