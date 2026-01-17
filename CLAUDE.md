# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sailor Desktop is a macOS container management application built with Electron, React, and TypeScript. It provides a desktop GUI for managing Docker containers via Colima (a container runtime for macOS).

## Development Commands

```bash
# Bootstrap environment (installs asdf versions + npm dependencies)
make

# Start development server with hot reload
npm start

# Run linting
npm run lint

# Package the application
npm run package

# Build distributable
npm run make

# Download binaries (docker, colima, etc.)
make dl-bin
```

## Architecture

### Process Model (Electron)

- **Main Process** (`src/main/app.ts`): Creates BrowserWindow, system tray, handles app lifecycle
- **Preload Script** (`src/main/preload.ts`): Exposes IPC API to renderer via `contextBridge`
- **Renderer Process** (`src/renderer/app.tsx`): React application with react-router-dom

### IPC Communication

The preload script exposes two event listeners to the renderer:
- `api.onUpdateStatus()` - Colima status updates (booting, provisioning, ready, etc.)
- `api.onContainerChange()` - Docker container state changes

### Container Runtime Layer

- **Colima** (`src/api/colima.tsx`): Spawns/manages Colima process, parses stdout to status updates
- **Docker** (`src/api/docker.ts`): Uses Dockerode to communicate with Docker socket at `~/.colima/default/docker.sock`, polls container state

### Startup Flow

1. Main process creates window and tray
2. `postrender.ts` initializes Colima and Docker instances
3. Colima starts → emits status updates → when ready, Docker polling begins
4. Status/container changes sent to renderer via IPC

### Webpack Aliases

```
@assets    → assets/
@components → src/renderer/components/
@pages     → src/renderer/pages/
@common    → src/common/
@main      → src/main/
@modules   → src/modules/
@renderer  → src/renderer/
@src       → src/
```

### Key Directories

- `src/api/` - Container runtime integrations (Colima, Docker)
- `src/modules/` - Electron-specific modules (AppTray)
- `src/renderer/` - React UI (pages, components, styles)
- `src/common/` - Shared utilities (constants, events, platform detection)
- `bin/` - Platform-specific binaries bundled with app
- `tools/` - Build configuration (webpack, electron-forge)
