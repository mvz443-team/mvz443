[EN](./README_EN.md)

# Minecraft Vs Zombie 443

基于[phaserjs/template-react-ts](https://github.com/phaserjs/template-react-ts) 模板开发。

一个基于 HTML5 特性实现、使用 Phaser 框架开发的类植物大战僵尸游戏。
包含 MVZ2、Minecraft、东方Project 等元素的同人游戏。

## 游戏介绍

前往文档站查看详细的游戏介绍：

[文档站](https://mvz443-team.github.io/docs/)

## 环境要求

需要安装 [Node.js](https://nodejs.org) 才能通过 `npm` 安装依赖并运行相关脚本。

## 工具链

| 工具 | 描述 |
|---|---|
| [服务端软件](https://github.com/mvz443-team/mvz443-server) | 用于联机模式 |
| [Locale Editor](./tools/locale_editor) | 多语言文本编辑器 |

## 可用命令

| 命令 | 描述 |
|---------|-------------|
| `npm install` | 安装项目依赖 |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 在 `dist` 文件夹生成用于生产环境的构建产物 |
| `npm run dev-nolog` | 启动开发服务器且不发送匿名数据（详见 "About log.js"） |
| `npm run build-nolog` | 生成生产环境的构建产物且不发送匿名数据（详见 "About log.js"） |
| `pnpm run doctor:deps` | 检查 `node_modules` 的软链接是否损坏（常见于移动/复制项目文件夹后） |
| `pnpm run doctor:deps:fix`| 自动重新安装并修复损坏的依赖链接 |

### 依赖健康检查

如果你移动或复制了项目目录，`node_modules` 里可能会残留旧路径的软链接，导致出现类似 `Cannot find package 'vite'` 的错误。

本项目已经在 `dev/build` 执行前配置了自动依赖自检；你也可以手动运行以下命令进行检查和修复：

```bash
pnpm run doctor:deps
pnpm run doctor:deps:fix
```

## 发布与部署 (GitHub Pages)

线上版本由 [.github/workflows/deploy.yml](.github/workflows/deploy.yml) 通过 GitHub Actions 自动构建并发布到 GitHub Pages。**只有推送形如 `v*` 的 git tag 时才会触发部署**，普通的 `push` / `pull_request` 不会触发。

工作流大致流程如下：

1. 从 tag 名字中解析出版本号（去掉前缀 `v`），作为 `VITE_APP_VERSION` 注入到构建过程中。
2. 通过 `git rev-list --count HEAD` 取得提交序号，作为 `VITE_APP_COMMIT` 注入到构建中。
3. 根据当前仓库名生成 `VITE_APP_BASE`（例如 `/mvz443/`），将其写入 `vite` 的 `base` 配置，前端可通过读取 `import.meta.env.VITE_APP_BASE` 派生出 `publicUrl`。
4. 运行 `npm run build-nolog`，并将构建产物上传给 `actions/deploy-pages` 进行部署。

发布一个新版本（以 `v1.0.4` 为例）：

```bash
# 1. 确保 main 分支已同步到你要发布的提交
git checkout main
git pull --ff-only

# 2. 打 tag（注意：必须以 v 开头，例如: v0.2.1 / v1.0.4）
git tag v1.0.4

# 3. 推送 tag，触发 GitHub Actions 构建并自动部署
git push origin v1.0.4
```

如果 tag 打错了，需要撤销回退：

```bash
# 删除本地 tag
git tag -d v1.0.4

# 删除远端 tag（此操作会触发删除事件，但由于本工作流只监听 push 事件，因此不会触发重新部署）
git push origin :refs/tags/v1.0.4
```

> **注意：** 仓库的 GitHub Pages 设置必须选择 **Build and deployment → Source: GitHub Actions** 才能让上述工作流生效。
