import fs from 'fs';
import os from 'os';
import path from 'path';

function getBrewPrefix(): string {
    if (process.platform === 'linux') {
        return '/home/linuxbrew/.linuxbrew';
    }
    return os.arch() === 'arm64' ? '/opt/homebrew' : '/usr/local';
}

/** Where Homebrew's docker plugin formulae install their binaries */
export function getDockerCliPluginsDir(): string {
    return path.join(getBrewPrefix(), 'lib', 'docker', 'cli-plugins');
}

export function ensureDockerCliPlugins(): void {
    const pluginPath = getDockerCliPluginsDir();
    const dockerConfigDir = path.join(os.homedir(), '.docker');
    const dockerConfigPath = path.join(dockerConfigDir, 'config.json');

    let config: Record<string, unknown> = {};

    if (fs.existsSync(dockerConfigPath)) {
        try {
            config = JSON.parse(fs.readFileSync(dockerConfigPath, 'utf8'));
        } catch {
            // Malformed config — overwrite with our additions only
        }
    }

    const extraDirs: string[] = Array.isArray(config.cliPluginsExtraDirs)
        ? config.cliPluginsExtraDirs as string[]
        : [];

    if (extraDirs.includes(pluginPath)) return;

    config.cliPluginsExtraDirs = [...extraDirs, pluginPath];

    if (!fs.existsSync(dockerConfigDir)) {
        fs.mkdirSync(dockerConfigDir, { recursive: true });
    }

    fs.writeFileSync(dockerConfigPath, JSON.stringify(config, null, 2) + '\n');
}
