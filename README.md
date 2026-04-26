# Minecraft Vs Zombie 443

develop from https://github.com/phaserjs/template-react-ts

一个基于html5特性实现的,使用phaser框架的类植物大战僵尸游戏.

MVZ2,Minecraft,东方Project同人游戏

## 介绍

前往PVZ同人创作论坛查看本游戏的介绍

[MC大战僵尸 443版本 | PVZ同人创作论坛](https://www.pvz.moe/resources/1124/)

## goal and progress

关于游戏进度,目标等游戏性的信息可以查看以下文档.

[prpject.md](./project.md)

## Requirements

[Node.js](https://nodejs.org) is required to install dependencies and run scripts via `npm`.

## tools chain

本游戏大部分的文字放在 `public/locales/xx_xx.js`中,你可以使用 `tools/text_editor`进行新增和修改

本游戏的关卡数据放在 `public/stages`中,你可以使用 `tools/wave_editor`进行新增和修改



## Available Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install project dependencies |
| `npm run dev` | Launch a development web server |
| `npm run build` | Create a production build in the `dist` folder |
| `npm run dev-nolog` | Launch a development web server without sending anonymous data (see "About log.js" below) |
| `npm run build-nolog` | Create a production build in the `dist` folder without sending anonymous data (see "About log.js" below) |
| `pnpm run doctor:deps` | Check whether `node_modules` links are broken (common after moving/copying folder) |
| `pnpm run doctor:deps:fix` | Reinstall and repair broken dependency links automatically |

## Dependency Health Check

如果你移动/复制了项目目录，`node_modules` 里可能残留旧路径软链接，导致类似 `Cannot find package 'vite'` 的错误。

本项目已在 `dev/build` 前自动执行依赖自检；你也可以手动运行：

```bash
pnpm run doctor:deps
pnpm run doctor:deps:fix
```

## Release & Deploy (GitHub Pages)

线上版本由 [.github/workflows/deploy.yml](.github/workflows/deploy.yml) 通过 GitHub Actions 自动构建并发布到 GitHub Pages。**只有推送形如 `v*` 的 git tag 时才会触发**，普通的 `push` / `pull_request` 不会触发部署。

工作流大致流程：

1. 从 tag 名字解析出版本号(去掉前缀 `v`),作为 `VITE_APP_VERSION` 注入构建。
2. 通过 `git rev-list --count HEAD` 取得提交序号,作为 `VITE_APP_COMMIT` 注入构建。
3. 根据当前仓库名生成 `VITE_APP_BASE`(例如 `/mvz443/`),写入 `vite` 的 `base`,并由前端通过 `import.meta.env.VITE_APP_BASE` 读取派生出 `publicUrl`。
4. 运行 `npm run build-nolog`,把产物上传给 `actions/deploy-pages`。

发布一个新版本(以 `v1.0.4` 为例):

```bash
# 1. 确保 main 分支已同步到要发布的提交
git checkout main
git pull --ff-only

# 2. 打 tag(注意必须是 v 开头, 例: v0.2.1 / v1.0.4)
git tag v1.0.4

# 3. 推送 tag, 触发 GitHub Actions 构建并部署
git push origin v1.0.4
```

如果 tag 打错了,需要回退:

```bash
# 删除本地 tag
git tag -d v1.0.4

# 删除远端 tag(会触发删除事件,但本工作流只监听 push, 因此不会重新部署)
git push origin :refs/tags/v1.0.4
```

> 仓库的 GitHub Pages 设置需选择 **Build and deployment → Source: GitHub Actions** 才能让上面的工作流生效。