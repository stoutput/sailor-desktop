import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
import os from 'os';
import { DEPENDENCY_VERSIONS, meetsMinimum, compareVersions } from '@common/versions';
import { ConflictInfo, NonHomebrewInstall, DependencyNotification } from '@common/types';

export type Platform = 'mac-arm' | 'mac-intel';
export type DependencyName = 'homebrew' | 'colima' | 'docker';

export interface DependencyStatus {
    name: string;
    installed: boolean;
    version: string | null;
    meetsMinimum: boolean;
    minimumVersion: string;
    recommendedVersion: string;
    latestVersion: string | null;
    path: string | null;
    installedViaHomebrew: boolean;
}

export interface DependencyCheckResult {
    platform: Platform;
    allMet: boolean;
    conflicts: ConflictInfo;
    dependencies: {
        homebrew: DependencyStatus;
        colima: DependencyStatus;
        docker: DependencyStatus;
    };
}

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

/**
 * Batched command execution - runs multiple commands in a single shell
 * and returns results as an array. Much faster than individual exec calls.
 */
async function runBatchedCommands(commands: string[]): Promise<(string | null)[]> {
    const delimiter = '___SAILOR_DELIM___';
    const pathSetup = `export PATH="${HOMEBREW_PATHS}:$PATH"`;
    const script = commands.map(cmd =>
        `(${cmd}) 2>/dev/null || echo "___SAILOR_ERROR___"`
    ).join(`; echo "${delimiter}"; `);

    try {
        const { stdout } = await execAsync(`bash -c '${pathSetup}; ${script}'`, {
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
        const { stdout } = await execAsync(`PATH="${HOMEBREW_PATHS}:$PATH" HOMEBREW_NO_AUTO_UPDATE=1 brew list --formula -1 2>/dev/null`, {
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
// Main Dependency Check (Optimized)
// ============================================================================

export async function checkDependencies(): Promise<DependencyCheckResult> {
    const platform = detectPlatform();

    // Batch all path lookups and version checks into a single shell execution
    const batchResults = await runBatchedCommands([
        'which brew',
        'which colima',
        'which docker',
        'brew --version 2>/dev/null | head -1',
        'colima version 2>/dev/null',
        'docker --version 2>/dev/null',
        'HOMEBREW_NO_AUTO_UPDATE=1 brew info --json=v2 colima 2>/dev/null',
        'HOMEBREW_NO_AUTO_UPDATE=1 brew info --json=v2 docker 2>/dev/null'
    ]);

    const [brewPath, colimaPath, dockerPath, brewVersionOut, colimaVersionOut, dockerVersionOut, colimaInfoJson, dockerInfoJson] = batchResults;

    // Parse versions from output
    const brewVersion = brewVersionOut ? (() => {
        const match = brewVersionOut.match(/Homebrew ([\d.]+)/);
        return match ? `v${match[1]}` : null;
    })() : null;

    const colimaVersion = colimaVersionOut ? (() => {
        // Try multiple patterns - colima version output format may vary
        // e.g., "colima version v0.9.1" or "colima version 0.9.1" or just "v0.9.1" or "0.9.1"
        const patterns = [
            /colima version (v?[\d.]+)/i,
            /^(v?[\d.]+)/m
        ];
        for (const pattern of patterns) {
            const match = colimaVersionOut.match(pattern);
            if (match) {
                const ver = match[1];
                return ver.startsWith('v') ? ver : `v${ver}`;
            }
        }
        return null;
    })() : null;

    const dockerVersion = dockerVersionOut ? (() => {
        const match = dockerVersionOut.match(/Docker version ([\d.]+)/i);
        return match ? `v${match[1]}` : null;
    })() : null;

    // Parse latest versions from brew info JSON
    const colimaLatest = colimaInfoJson ? (() => {
        try {
            const info = JSON.parse(colimaInfoJson);
            const version = info.formulae?.[0]?.versions?.stable;
            return version ? `v${version}` : null;
        } catch { return null; }
    })() : null;

    const dockerLatest = dockerInfoJson ? (() => {
        try {
            const info = JSON.parse(dockerInfoJson);
            const version = info.formulae?.[0]?.versions?.stable;
            return version ? `v${version}` : null;
        } catch { return null; }
    })() : null;

    // Check Homebrew packages and conflicts in parallel
    const dockerDesktopInfo = isDockerDesktopInstalled();
    const [homebrewStatus, running] = await Promise.all([
        checkHomebrewPackages(['colima', 'docker']),
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
            installed: !!brewPath && !!brewVersion,
            version: brewVersion,
            meetsMinimum: true, // Any version of Homebrew is fine
            minimumVersion: 'any',
            recommendedVersion: 'any',
            latestVersion: null as string | null, // Homebrew doesn't need version selection
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
        }
    };

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

export async function isSetupRequired(): Promise<boolean> {
    const result = await checkDependencies();
    return !result.allMet || result.conflicts.hasConflicts;
}
