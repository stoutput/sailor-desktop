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
- **Postrender** (`src/main/postrender.ts`): Initializes runtime services after renderer is ready

### App States (Renderer)

The main app (`src/renderer/app.tsx`) manages these states:

| State | UI | Description |
|-------|-----|-------------|
| `loading` | Bouncing anchor (full screen) | Initial app load, checking if setup needed |
| `setup` | Setup wizard | Dependencies need installation |
| `starting` | App layout + "Weighing anchor..." | Colima/Docker runtimes starting |
| `awaiting-containers` | Full app | Runtimes ready, waiting for first container poll |
| `ready` | Full app | All systems operational |

Both `awaiting-containers` and `ready` render the full app - individual widgets handle their own loading states.

### Startup Flow

1. **Main process** creates BrowserWindow and system tray (`src/main/app.ts`)
2. **Postrender** (`src/main/postrender.ts`) initializes on renderer ready:
   - Creates Colima and Docker instances
   - Checks if setup is required via `isSetupRequired()`
   - If setup needed → sends `setup-required` event to renderer
   - If not → calls `startRuntime()` which starts Colima
3. **Colima starts** and emits status updates: `Booting...` → `Provisioning...` → `Starting docker...` → `Ready`
4. **When Colima is Ready** → `docker.start()` is called, which immediately polls containers
5. **First container poll** → `containers-ready` event sent to renderer
6. **Statusbox** transitions to green "Anchors away!" when both `colimaReady` AND `containersReady` are true

### IPC Communication

The preload script (`src/main/preload.ts`) exposes `window.api` with:

**Events (renderer listens):**
- `onUpdateStatus(callback)` - Colima status changes
- `onContainersUpdate(callback)` - Container list updates
- `onContainersReady(callback)` - First container poll complete
- `onLogMessage(callback)` - Log entries from main process
- `onSetupRequired(callback)` - Dependencies need installation
- `onInstallProgress(callback)` - Dependency install progress

**State queries:**
- `getContainersReady()` - Check if containers have been polled
- `getBufferedLogs()` - Get logs emitted before component mounted
- `getCurrentStatus()` - Get current Colima status
- `isColimaRunning()` - Check if Colima process is running

### Logging System

Logs are managed in `postrender.ts` with a buffer for late-mounting components:

```typescript
// Main process buffers logs (max 100 entries)
const logBuffer: LogEntry[] = [];

function emitLog(message: string, type: string) {
    logBuffer.push({ timestamp: Date.now(), message, type });
    renderer.send('log-message', message, type);
}
```

**Statusbox** (`src/renderer/components/statusbox.tsx`) displays logs:
- On mount, fetches `getBufferedLogs()` to show logs from before mount
- Subscribes to `onLogMessage()` for live updates
- Shows last 50 entries, auto-scrolls to bottom

### Settings System

Settings are managed by `SettingsManager` (`src/main/settings.ts`):

**Storage:** `~/.config/sailor/settings.json`

**Settings categories:**
- `SailorSettings` - App preferences (launch at login, theme, etc.)
- `ColimaSettings` - Runtime config (activeInstance, CPU, memory, disk)
- `DockerSettings` - Docker config (activeContext)
- `NotificationSettings` - Acknowledged notification versions

**IPC handlers:**
- `get-settings` / `get-sailor-settings` / `get-colima-settings` / `get-docker-settings`
- `set-sailor-settings` / `set-colima-settings` / `set-docker-settings`

### Notification System

Handles untested dependency version warnings:

1. **Check on ready:** `checkNotifications()` called after statusbox transitions to ready
2. **Fetch notifications:** `getUntestedVersionNotifications()` compares installed versions against `DEPENDENCY_VERSIONS` in `src/common/versions.ts`
3. **Filter acknowledged:** Checks `isNotificationAcknowledged(id, version)` against stored settings
4. **Display:** Statusbox shows notification count badge and bouncing anchor
5. **Acknowledge:** User clicks "Acknowledge" → `acknowledgeNotification(id, version)` stores in settings

### Dependency Management / Setup Wizard

**Setup Wizard** (`src/renderer/components/setupwizard.tsx`) handles first-run setup:

**Steps:**
1. `checking` - Bouncing anchor while checking dependencies
2. `no-internet` - Prompts for network connection
3. `conflicts` - Shows Docker Desktop or non-Homebrew installations to remove
4. `install` - Shows dependencies to install with version selection
5. `installing` - Progress during Homebrew installation
6. `complete` - Success, ready to start

**Dependency checking** (`src/main/dependencies.ts`):
- Checks for Homebrew, Colima, Docker CLI
- Validates versions against minimums in `DEPENDENCY_VERSIONS`
- Detects conflicts (Docker Desktop, non-Homebrew binaries)
- Uses `sudo-prompt` for elevated privilege operations

**Version installation:**
- Recommended versions use `brew extract` to install specific versions
- Latest versions use standard `brew install`

### Container Runtime Layer

- **Colima** (`src/api/colima.tsx`):
  - Spawns/manages Colima process
  - Parses stdout for status updates
  - Supports multiple instances
  - Emits: `status-update`, `log`

- **Docker** (`src/api/docker.ts`):
  - Uses Dockerode with socket at `~/.colima/<instance>/docker.sock`
  - Polls containers every 5 seconds (immediate poll on start)
  - Manages container logs, stats, shell sessions
  - Emits: `containers-update`, `log`

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
- `src/main/` - Main process code (app, preload, postrender, settings, dependencies)
- `src/modules/` - Electron-specific modules (AppTray)
- `src/renderer/` - React UI (pages, components, styles)
- `src/common/` - Shared types, constants, events, version definitions
- `bin/` - Platform-specific binaries bundled with app
- `tools/` - Build configuration (webpack, electron-forge)
- `assets/` - Icons, images (anchor.svg for app icon)
