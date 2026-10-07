import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import os from 'os';
import path from 'path';
import {
    DEPENDENCY_VERSIONS,
    DOCKER_PLUGINS,
    meetsMinimum,
    compareVersions,
    parseColimaVersion,
    parseDockerVersion,
    parseHomebrewVersion,
    parseBuildxVersion,
    parseComposeVersion,
    parseBrewInfoStableVersion
} from '@common/versions';
import {
    ConflictInfo,
    NonHomebrewInstall,
    DependencyNotification,
    InstallProgress,
    DockerPluginKey,
    DependencyName,
    DependencyCheckResult,
    DependencyStatus as DependencyStatusType
} from '@common/types';
import { getDockerCliPluginsDir } from './dockerConfig';

export type Platform = 'mac-arm' | 'mac-intel';

// Shapes live in @common/types so the renderer and this module can't drift
export type DependencyStatus = DependencyStatusType;
export type { DependencyName, DependencyCheckResult };

// ============================================================================
// Platform Detection
// ============================================================================

export function detectPlatform(): Platform {
    const arch = os.arch();
    return arch === 'arm64' ? 'mac-arm' : 'mac-intel';
}

// ============================================================================
// Utility Functions
// ============================================================================

// Standard Homebrew paths that may not be in PATH for GUI apps
const HOMEBREW_PATHS = [
    '/opt/homebrew/bin',      // Apple Silicon
    '/usr/local/bin',         // Intel Mac
    '/home/linuxbrew/.linuxbrew/bin' // Linux
].join(':');

// Prepended to every shell we run brew in: the Homebrew paths (a GUI app's PATH
// lacks them) plus HOMEBREW_NO_AUTO_UPDATE, so no brew call silently triggers an
// update. Anything routed through here inherits both.
const BREW_SHELL_SETUP = `export PATH="${HOMEBREW_PATHS}:$PATH"; export HOMEBREW_NO_AUTO_UPDATE=1`;

/**
 * Batched command execution - runs multiple commands in a single shell
 * and returns results as an array. Much faster than individual exec calls.
 */
async function runBatchedCommands(commands: string[]): Promise<(string | null)[]> {
    const delimiter = '___SAILOR_DELIM___';
    const script = commands.map(cmd =>
        `(${cmd}) 2>/dev/null || echo "___SAILOR_ERROR___"`
    ).join(`; echo "${delimiter}"; `);

    try {
        const { stdout } = await execAsync(`bash -c '${BREW_SHELL_SETUP}; ${script}'`, {
            encoding: 'utf8',
            timeout: 30000,
        });

        return stdout.split(delimiter).map(result => {
            const trimmed = result.trim();
            return trimmed === '___SAILOR_ERROR___' || !trimmed ? null : trimmed;
        });
    } catch {
        return commands.map((): null => null);
    }
}

// ============================================================================
// Homebrew Detection
// ============================================================================

/**
 * Check multiple packages at once to see if they're installed via Homebrew.
 * Returns a map of package name to boolean.
 */
async function checkHomebrewPackages(packages: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const pkg of packages) {
        result[pkg] = false;
    }
    try {
        const { stdout } = await execAsync(`bash -c '${BREW_SHELL_SETUP}; brew list --formula -1 2>/dev/null'`, {
            encoding: 'utf8',
            timeout: 10000,
        });
        const installedPackages = new Set(stdout.trim().split('\n'));
        for (const pkg of packages) {
            result[pkg] = installedPackages.has(pkg);
        }
    } catch {
        // If brew list fails, all packages are considered not installed via Homebrew
    }
    return result;
}

// ============================================================================
// Conflict Detection
// ============================================================================

function isDockerDesktopInstalled(): { installed: boolean; path: string | null } {
    const appPath = '/Applications/Docker.app';
    const installed = fs.existsSync(appPath);
    return { installed, path: installed ? appPath : null };
}

async function isDockerDesktopRunning(): Promise<boolean> {
    try {
        const { stdout } = await execAsync('pgrep -f "Docker Desktop"', { encoding: 'utf8', timeout: 5000 });
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

function checkNonHomebrewInstallFromPaths(
    cmdPath: string | null,
    isHomebrewInstalled: boolean
): NonHomebrewInstall {
    if (!cmdPath) {
        return { installed: false, path: null, canAutoRemove: false };
    }

    if (isHomebrewInstalled) {
        return { installed: false, path: null, canAutoRemove: false };
    }

    // Non-Homebrew installation detected
    // Check if we can auto-remove (if it's in a location we can delete)
    const canAutoRemove = cmdPath.startsWith('/usr/local/bin/') ||
                          cmdPath.startsWith(os.homedir());

    return { installed: true, path: cmdPath, canAutoRemove };
}

export async function checkForConflicts(): Promise<ConflictInfo> {
    const dockerDesktopInfo = isDockerDesktopInstalled();

    const [[colimaPath, dockerPath], homebrewStatus, running] = await Promise.all([
        runBatchedCommands(['which colima', 'which docker']),
        checkHomebrewPackages(['colima', 'docker']),
        dockerDesktopInfo.installed ? isDockerDesktopRunning() : Promise.resolve(false),
    ]);

    const nonHomebrewColima = checkNonHomebrewInstallFromPaths(colimaPath, homebrewStatus['colima']);
    const nonHomebrewDocker = checkNonHomebrewInstallFromPaths(dockerPath, homebrewStatus['docker']);

    const hasConflicts = dockerDesktopInfo.installed ||
                         nonHomebrewColima.installed ||
                         nonHomebrewDocker.installed;

    return {
        hasConflicts,
        dockerDesktop: { ...dockerDesktopInfo, running },
        nonHomebrewColima,
        nonHomebrewDocker
    };
}

// ============================================================================
// Installation
// ============================================================================

export type InstallProgressCallback = (progress: InstallProgress) => void;

// The official Homebrew installer. It needs a TTY (it asks for confirmation and
// the user's sudo password), so it is run in Terminal.app rather than in-process.
export const HOMEBREW_INSTALL_COMMAND =
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

/**
 * Run a brew subcommand with the Homebrew paths prepended, since a packaged
 * Electron app's PATH does not include them.
 */
async function runBrew(brewArgs: string, timeout: number): Promise<string> {
    const { stdout } = await execAsync(
        `bash -c '${BREW_SHELL_SETUP}; brew ${brewArgs}'`,
        { encoding: 'utf8', timeout, maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout;
}

/** Lightweight check used to poll for Homebrew while the user installs it. */
export async function isHomebrewInstalled(): Promise<boolean> {
    const [brewPath] = await runBatchedCommands(['which brew']);
    return !!brewPath;
}

/**
 * Run the official Homebrew installer in Terminal.app. It needs a TTY — it asks
 * for confirmation and the user's sudo password — and it refuses to run as root,
 * so it can't be driven from an elevated helper. Sailor polls for brew to appear
 * while the user completes it.
 *
 * The command is written to a .command script and handed to Terminal via
 * LaunchServices rather than driven with AppleScript: `open` needs no Automation
 * (TCC) permission, and the script stays on disk for the user to inspect.
 *
 * Returns the script path so the UI can point the user at it.
 */
export async function openHomebrewInstaller(): Promise<string> {
    const scriptPath = path.join(os.tmpdir(), 'sailor-install-homebrew.command');

    // HOMEBREW_INSTALL_COMMAND holds no single quotes, so it's safe to echo
    // single-quoted — double quotes would run the command substitution here
    const script = `#!/bin/bash
# Opened by Sailor to install Homebrew using the official installer from
# https://brew.sh. Sailor runs nothing as root; the installer asks for your
# password itself. Review this script before continuing.
export HOMEBREW_NO_AUTO_UPDATE=1

echo 'Sailor is installing Homebrew by running:'
echo '${HOMEBREW_INSTALL_COMMAND}'
echo

${HOMEBREW_INSTALL_COMMAND}

echo
echo 'Finished. You can close this window and return to Sailor.'
`;

    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    await execFileAsync('open', ['-a', 'Terminal', scriptPath]);
    return scriptPath;
}

/**
 * Install the latest version of a formula. Older versions aren't offered: they
 * would need `brew extract`, and the resulting formulae generally have no
 * bottles and often fail to build.
 */
export async function installWithBrew(
    packageName: string,
    displayName: string,
    onProgress: InstallProgressCallback
): Promise<void> {
    onProgress({
        dependency: packageName,
        phase: 'installing',
        message: `Installing ${displayName} via Homebrew...`
    });

    try {
        // --formula is important for docker: the cask is Docker Desktop
        await runBrew(`install --formula ${packageName}`, 600000);

        onProgress({
            dependency: packageName,
            phase: 'complete',
            message: `${displayName} installed successfully`
        });
    } catch (err) {
        onProgress({
            dependency: packageName,
            phase: 'error',
            message: `Failed to install ${displayName}`,
            error: err instanceof Error ? err.message : String(err)
        });
        throw err;
    }
}

export async function upgradeWithBrew(
    packageName: string,
    displayName: string,
    onProgress: InstallProgressCallback
): Promise<void> {
    onProgress({
        dependency: packageName,
        phase: 'installing',
        message: `Upgrading ${displayName} via Homebrew...`
    });

    try {
        await runBrew(`upgrade --formula ${packageName}`, 600000);
        onProgress({
            dependency: packageName,
            phase: 'complete',
            message: `${displayName} upgraded successfully`
        });
    } catch (err) {
        onProgress({
            dependency: packageName,
            phase: 'error',
            message: `Failed to upgrade ${displayName}`,
            error: err instanceof Error ? err.message : String(err)
        });
        throw err;
    }
}

// ============================================================================
// Docker CLI Plugins
// ============================================================================

const PLUGIN_VERSION_PARSERS: Record<DockerPluginKey, (out: string | null) => string | null> = {
    buildx: parseBuildxVersion,
    compose: parseComposeVersion
};

/**
 * Build a DependencyStatus per plugin from the batched probe output. Plugins have
 * no minimum version — they're either available to the docker CLI or they aren't.
 */
function buildPluginStatuses(
    pluginResults: (string | null)[],
    homebrewStatus: Record<string, boolean>
): Record<DockerPluginKey, DependencyStatus> {
    const statuses = {} as Record<DockerPluginKey, DependencyStatus>;

    DOCKER_PLUGINS.forEach((plugin, i) => {
        // Two batched commands per plugin: version probe, then brew info
        const [versionOut, infoJson] = pluginResults.slice(i * 2, i * 2 + 2);
        const version = PLUGIN_VERSION_PARSERS[plugin.key](versionOut);
        const brewBinary = path.join(getDockerCliPluginsDir(), plugin.binary);

        statuses[plugin.key] = {
            name: plugin.displayName,
            installed: !!version,
            version,
            meetsMinimum: true, // No floor: presence is what matters
            minimumVersion: 'any',
            recommendedVersion: 'any',
            latestVersion: parseBrewInfoStableVersion(infoJson),
            path: fs.existsSync(brewBinary) ? brewBinary : null,
            installedViaHomebrew: homebrewStatus[plugin.formula] ?? false
        };
    });

    return statuses;
}

/** Homebrew formula backing a dependency, for install/upgrade */
export function getFormulaName(name: DependencyName): string | null {
    if (name === 'colima' || name === 'docker') return name;
    return DOCKER_PLUGINS.find(p => p.key === name)?.formula ?? null;
}

/** Human-readable name used in install progress messages */
export function getDisplayName(name: DependencyName): string {
    if (name === 'colima') return 'Colima';
    if (name === 'docker') return 'Docker CLI';
    if (name === 'homebrew') return 'Homebrew';
    return DOCKER_PLUGINS.find(p => p.key === name)?.displayName ?? name;
}

/** True when the dependency is a docker CLI plugin rather than a standalone binary */
export function isDockerPlugin(name: DependencyName): boolean {
    return DOCKER_PLUGINS.some(p => p.key === name);
}

// ============================================================================
// Main Dependency Check (Optimized)
// ============================================================================

export async function checkDependencies(): Promise<DependencyCheckResult> {
    const platform = detectPlatform();

    // Batch all path lookups and version checks into a single shell execution.
    // Plugins are probed through the docker CLI (`docker compose version`) rather
    // than by looking for a file, so a plugin the user installed elsewhere — e.g.
    // in ~/.docker/cli-plugins — counts as present and isn't installed twice.
    const batchResults = await runBatchedCommands([
        'which brew',
        'which colima',
        'which docker',
        'brew --version 2>/dev/null | head -1',
        'colima version 2>/dev/null',
        'docker --version 2>/dev/null',
        'brew info --json=v2 colima 2>/dev/null',
        'brew info --json=v2 docker 2>/dev/null',
        ...DOCKER_PLUGINS.flatMap(plugin => [
            `docker ${plugin.subcommand} version 2>/dev/null`,
            `brew info --json=v2 ${plugin.formula} 2>/dev/null`
        ])
    ]);

    const [brewPath, colimaPath, dockerPath, brewVersionOut, colimaVersionOut, dockerVersionOut, colimaInfoJson, dockerInfoJson] = batchResults;
    // Plugin results follow the fixed entries above, two per plugin
    const pluginResults = batchResults.slice(8);

    // Parse versions from output
    const brewVersion = parseHomebrewVersion(brewVersionOut);
    const colimaVersion = parseColimaVersion(colimaVersionOut);
    const dockerVersion = parseDockerVersion(dockerVersionOut);

    // Parse latest available versions from brew info JSON
    const colimaLatest = parseBrewInfoStableVersion(colimaInfoJson);
    const dockerLatest = parseBrewInfoStableVersion(dockerInfoJson);

    // Check Homebrew packages and conflicts in parallel
    const dockerDesktopInfo = isDockerDesktopInstalled();
    const [homebrewStatus, running] = await Promise.all([
        checkHomebrewPackages(['colima', 'docker', ...DOCKER_PLUGINS.map(p => p.formula)]),
        dockerDesktopInfo.installed ? isDockerDesktopRunning() : Promise.resolve(false),
    ]);

    const nonHomebrewColima = checkNonHomebrewInstallFromPaths(colimaPath, homebrewStatus['colima']);
    const nonHomebrewDocker = checkNonHomebrewInstallFromPaths(dockerPath, homebrewStatus['docker']);

    const hasConflicts = dockerDesktopInfo.installed ||
                         nonHomebrewColima.installed ||
                         nonHomebrewDocker.installed;

    const conflicts: ConflictInfo = {
        hasConflicts,
        dockerDesktop: { ...dockerDesktopInfo, running },
        nonHomebrewColima,
        nonHomebrewDocker
    };

    const dependencies = {
        homebrew: {
            name: 'Homebrew',
            // Presence in PATH is what matters; its version gates nothing, and a
            // shallow brew clone reports one we can't parse
            installed: !!brewPath,
            version: brewVersion,
            meetsMinimum: true, // Any version of Homebrew is fine
            minimumVersion: 'any',
            recommendedVersion: 'any',
            latestVersion: null as string | null, // Not surfaced; its installer always fetches current
            path: brewPath,
            installedViaHomebrew: true // Homebrew is always "via Homebrew"
        },
        colima: {
            name: 'Colima',
            installed: !!colimaPath && !!colimaVersion,
            version: colimaVersion,
            meetsMinimum: colimaVersion ? meetsMinimum(colimaVersion, DEPENDENCY_VERSIONS.colima.minimum) : false,
            minimumVersion: DEPENDENCY_VERSIONS.colima.minimum,
            recommendedVersion: DEPENDENCY_VERSIONS.colima.recommended,
            latestVersion: colimaLatest,
            path: colimaPath,
            installedViaHomebrew: homebrewStatus['colima']
        },
        docker: {
            name: 'Docker CLI',
            installed: !!dockerPath && !!dockerVersion,
            version: dockerVersion,
            meetsMinimum: dockerVersion ? meetsMinimum(dockerVersion, DEPENDENCY_VERSIONS.docker.minimum) : false,
            minimumVersion: DEPENDENCY_VERSIONS.docker.minimum,
            recommendedVersion: DEPENDENCY_VERSIONS.docker.recommended,
            latestVersion: dockerLatest,
            path: dockerPath,
            installedViaHomebrew: homebrewStatus['docker']
        },
        ...buildPluginStatuses(pluginResults, homebrewStatus)
    } as DependencyCheckResult['dependencies'];

    const allMet = Object.values(dependencies).every(d => d.installed && d.meetsMinimum);

    return {
        platform,
        allMet,
        conflicts,
        dependencies
    };
}

// Check for versions greater than recommended (untested)
export function getUntestedVersionNotifications(result: DependencyCheckResult): DependencyNotification[] {
    const notifications: DependencyNotification[] = [];

    const checkDep = (name: DependencyName, dep: DependencyStatus) => {
        if (dep.installed && dep.version && dep.recommendedVersion !== 'any') {
            if (compareVersions(dep.version, dep.recommendedVersion) > 0) {
                notifications.push({
                    id: `untested_${name}_${dep.version}`,
                    type: 'untested_version',
                    dependency: name,
                    version: dep.version,
                    message: `${dep.name} ${dep.version} is newer than tested version ${dep.recommendedVersion}`
                });
            }
        }
    };

    checkDep('colima', result.dependencies.colima);
    checkDep('docker', result.dependencies.docker);

    return notifications;
}

/**
 * Setup is required when Colima or the Docker CLI is missing from PATH (or is
 * older than the supported minimum). Homebrew is only needed as the means to
 * install them, so it doesn't gate startup on its own — and conflicting installs
 * are surfaced inside the wizard rather than hijacking an otherwise working setup.
 */
export async function isSetupRequired(): Promise<boolean> {
    const { colima, docker } = (await checkDependencies()).dependencies;
    return [colima, docker].some(dep => !dep.installed || !dep.meetsMinimum);
}
