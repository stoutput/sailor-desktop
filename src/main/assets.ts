import { app } from 'electron';
import path from 'path';

/**
 * Absolute path to a file under the bundled `assets/` directory.
 *
 * When packaged, `assets/` is copied next to `app.asar` by
 * `packagerConfig.extraResources`, so it lives under `process.resourcesPath`.
 * In development the same files sit in the project root next to `package.json`,
 * which is what `app.getAppPath()` returns.
 */
export const assetPath = (...segments: string[]): string =>
    path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'assets', ...segments);
