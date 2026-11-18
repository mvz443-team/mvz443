// 性能测试全局初始化：复用 E2E 的 Go server 启动逻辑（联机场景需要）。
import e2eSetup from '../e2e/global-setup.mjs';

export default e2eSetup;
