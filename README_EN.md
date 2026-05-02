[中文](./README.md)

# Minecraft Vs Zombie 443

Developed from[phaserjs/template-react-ts](https://github.com/phaserjs/template-react-ts).

A Plants vs. Zombies-like game based on HTML5 features, built with the Phaser framework. 
It is a fan game incorporating elements from MVZ2, Minecraft, and the Touhou Project.

## Game Introduction

Please visit our documentation site for a detailed game introduction:

[Documentation Site](https://mvz443-team.github.io/docs/)

## Requirements

[Node.js](https://nodejs.org) is required to install dependencies and run scripts via `npm`.

## Toolchain

| Tool | Description |
|---|---|
| [Server Software](https://github.com/mvz443-team/mvz443-server) | Used for multiplayer mode |
| [Locale Editor](./tools/locale_editor) | Multi-language text editor |

## Available Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install project dependencies |
| `npm run dev` | Launch a development web server |
| `npm run build` | Create a production build in the `dist` folder |
| `npm run dev-nolog` | Launch a development web server without sending anonymous data (see "About log.js" below) |
| `npm run build-nolog` | Create a production build in the `dist` folder without sending anonymous data (see "About log.js" below) |
| `pnpm run doctor:deps` | Check whether `node_modules` links are broken (common after moving/copying the folder) |
| `pnpm run doctor:deps:fix` | Reinstall and repair broken dependency links automatically |

### Dependency Health Check

If you moved or copied the project directory, old path symlinks might remain in `node_modules`, causing errors like `Cannot find package 'vite'`.

This project automatically runs a dependency health check before `dev/build`; however, you can also run it manually:

```bash
pnpm run doctor:deps
pnpm run doctor:deps:fix
```

## Release & Deploy (GitHub Pages)

The online version is automatically built and deployed to GitHub Pages by[.github/workflows/deploy.yml](.github/workflows/deploy.yml) via GitHub Actions. **Deployment is only triggered when pushing a git tag formatted like `v*`**. Standard `push` or `pull_request` events will not trigger the deployment workflow.

Workflow summary:

1. Parses the version number from the tag name (by removing the `v` prefix) and injects it into the build as `VITE_APP_VERSION`.
2. Retrieves the commit count using `git rev-list --count HEAD` and injects it as `VITE_APP_COMMIT`.
3. Generates `VITE_APP_BASE` based on the repository name (e.g., `/mvz443/`), configures Vite's `base` with it, and derives the `publicUrl` on the frontend by reading `import.meta.env.VITE_APP_BASE`.
4. Runs `npm run build-nolog` and uploads the build artifact to `actions/deploy-pages`.

Releasing a new version (using `v1.0.4` as an example):

```bash
# 1. Ensure the main branch is synced to the commit you want to release
git checkout main
git pull --ff-only

# 2. Create a tag (Must start with 'v', e.g., v0.2.1 / v1.0.4)
git tag v1.0.4

# 3. Push the tag to trigger the GitHub Actions build and deployment
git push origin v1.0.4
```

If you created an incorrect tag and need to roll back:

```bash
# Delete the local tag
git tag -d v1.0.4

# Delete the remote tag (This will trigger a delete event, but since this workflow only listens to push events, it won't redeploy)
git push origin :refs/tags/v1.0.4
```

> **Note:** For the workflow to work, the repository's GitHub Pages settings must be configured to **Build and deployment → Source: GitHub Actions**.
