import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import { DEPENDENCY_VERSIONS, meetsMinimum, compareVersions } from '@common/versions';
import { ConflictInfo, NonHomebrewInstall, DependencyNotification } from '@common/types';
import { elevatedSession } from './elevatedSession';

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
 * and returns results as an array. Much faster than individual execSync calls.
 */
function runBatchedCommands(commands: string[]): (string | null)[] {
    // Create a script that runs each command and separates output with a delimiter
    const delimiter = '___SAILOR_DELIM___';
    // Prepend Homebrew paths to ensure binaries are found in GUI app context
    const pathSetup = `export PATH="${HOMEBREW_PATHS}:$PATH"`;
    const script = commands.map(cmd =>
        `(${cmd}) 2>/dev/null || echo "___SAILOR_ERROR___"`
    ).join(`; echo "${delimiter}"; `);

    try {
        const output = execSync(`bash -c '${pathSetup}; ${script}'`, {
            encoding: 'utf8',
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        return output.split(delimiter).map(result => {
            const trimmed = result.trim();
            return trimmed === '___SAILOR_ERROR___' || !trimmed ? null : trimmed;
        });
    } catch {
        // Fallback to empty results
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
function checkHomebrewPackages(packages: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {};

    // Initialize all to false
    for (const pkg of packages) {
        result[pkg] = false;
    }

    try {
        // Get list of all installed Homebrew packages in one call
        const output = execSync('HOMEBREW_NO_AUTO_UPDATE=1 brew list --formula -1 2>/dev/null', {
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const installedPackages = new Set(output.trim().split('\n'));

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

function isDockerDesktopRunning(): boolean {
    try {
        const output = execSync('pgrep -f "Docker Desktop"', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return output.trim().length > 0;
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

export function checkForConflicts(): ConflictInfo {
    const dockerDesktopInfo = isDockerDesktopInstalled();

    // Batch the which commands and homebrew checks
    const [colimaPath, dockerPath] = runBatchedCommands([
        'which colima',
        'which docker'
    ]);

    const homebrewStatus = checkHomebrewPackages(['colima', 'docker']);

    const nonHomebrewColima = checkNonHomebrewInstallFromPaths(colimaPath, homebrewStatus['colima']);
    const nonHomebrewDocker = checkNonHomebrewInstallFromPaths(dockerPath, homebrewStatus['docker']);

    const hasConflicts = dockerDesktopInfo.installed ||
                         nonHomebrewColima.installed ||
                         nonHomebrewDocker.installed;

    return {
        hasConflicts,
        dockerDesktop: {
            ...dockerDesktopInfo,
            running: dockerDesktopInfo.installed ? isDockerDesktopRunning() : false
        },
        nonHomebrewColima,
        nonHomebrewDocker
    };
}

// ============================================================================
// Uninstall Docker Desktop
// ============================================================================

export interface UninstallResult {
    success: boolean;
    message: string;
}

export async function uninstallDockerDesktop(): Promise<UninstallResult> {
    const dockerDesktop = isDockerDesktopInstalled();
    if (!dockerDesktop.installed) {
        return { success: true, message: 'Docker Desktop is not installed' };
    }

    try {
        // First, quit Docker Desktop if running
        if (isDockerDesktopRunning()) {
            try {
                execSync('osascript -e \'quit app "Docker"\'', { timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch {
                try {
                    execSync('pkill -f "Docker Desktop"', { timeout: 5000 });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch {
                    // Ignore if already quit
                }
            }
        }

        // Run Docker's built-in uninstall command
        const uninstallBinary = '/Applications/Docker.app/Contents/MacOS/Docker';
        if (fs.existsSync(uninstallBinary)) {
            try {
                execSync(`"${uninstallBinary}" --uninstall`, {
                    timeout: 60000,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch {
                // The uninstall command may return non-zero even on success
            }
        }

        // Move the app to trash
        try {
            execSync('osascript -e \'tell application "Finder" to delete POSIX file "/Applications/Docker.app"\'', {
                timeout: 30000
            });
        } catch {
            // Fallback: try direct removal
            try {
                execSync('rm -rf "/Applications/Docker.app"', { timeout: 30000 });
            } catch (err) {
                return {
                    success: false,
                    message: `Failed to remove Docker.app: ${err}`
                };
            }
        }

        // Clean up Docker Desktop remnants
        const cleanupPaths = [
            '~/Library/Group Containers/group.com.docker',
            '~/Library/Containers/com.docker.docker',
            '~/Library/Application Support/Docker Desktop'
        ];

        for (const p of cleanupPaths) {
            const expandedPath = p.replace('~', os.homedir());
            if (fs.existsSync(expandedPath)) {
                try {
                    fs.rmSync(expandedPath, { recursive: true, force: true });
                } catch {
                    // Continue even if some cleanup fails
                }
            }
        }

        return { success: true, message: 'Docker Desktop uninstalled successfully' };
    } catch (err) {
        return {
            success: false,
            message: `Failed to uninstall Docker Desktop: ${err}`
        };
    }
}

export async function removeNonHomebrewBinary(binaryPath: string, name: string): Promise<UninstallResult> {
    if (!binaryPath) {
        return { success: true, message: `${name} not found` };
    }

    try {
        // Check if the path exists
        if (!fs.existsSync(binaryPath)) {
            return { success: true, message: `${name} already removed` };
        }

        // Try to remove the binary
        try {
            fs.unlinkSync(binaryPath);
        } catch {
            // If direct removal fails, try with sudo-prompt (single prompt)
            try {
                await elevatedSession.exec(`rm -f "${binaryPath}"`);
            } catch (sudoErr) {
                return {
                    success: false,
                    message: `Failed to remove ${name}. Please manually delete: ${binaryPath}`
                };
            }
        }

        return { success: true, message: `${name} removed successfully` };
    } catch (err) {
        return {
            success: false,
            message: `Failed to remove ${name}: ${err}`
        };
    }
}

// Export elevated session control for setup wizard
export { elevatedSession };

// ============================================================================
// Homebrew Installation
// ============================================================================

export interface InstallProgress {
    dependency: string;
    phase: 'installing' | 'complete' | 'error';
    message: string;
    error?: string;
}

export type InstallProgressCallback = (progress: InstallProgress) => void;

export async function installHomebrew(onProgress: InstallProgressCallback): Promise<void> {
    onProgress({
        dependency: 'homebrew',
        phase: 'installing',
        message: 'Installing Homebrew (this may take a few minutes)...'
    });

    try {
        // Homebrew install script
        execSync('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', {
            stdio: 'inherit',
            timeout: 600000 // 10 minutes
        });

        onProgress({
            dependency: 'homebrew',
            phase: 'complete',
            message: 'Homebrew installed successfully'
        });
    } catch (err) {
        onProgress({
            dependency: 'homebrew',
            phase: 'error',
            message: 'Failed to install Homebrew',
            error: err instanceof Error ? err.message : String(err)
        });
        throw err;
    }
}

/**
 * Ensure homebrew/core tap is available with git history.
 * This is required for `brew extract` to work.
 */
function ensureHomebrewCoreTap(): void {
    const pathSetup = `export PATH="${HOMEBREW_PATHS}:$PATH"`;
    try {
        // Check if the tap exists and has the Formula directory
        const tapPath = '/opt/homebrew/Library/Taps/homebrew/homebrew-core';
        const intelTapPath = '/usr/local/Homebrew/Library/Taps/homebrew/homebrew-core';

        if (!fs.existsSync(tapPath) && !fs.existsSync(intelTapPath)) {
            // Tap homebrew/core with --force to get git history for brew extract
            execSync(`bash -c '${pathSetup}; HOMEBREW_NO_AUTO_UPDATE=1 brew tap homebrew/core --force'`, {
                encoding: 'utf8',
                timeout: 300000, // 5 minutes - cloning can take a while
                stdio: ['pipe', 'pipe', 'pipe']
            });
        }
    } catch {
        // If tapping fails, brew extract will fail later with a clear error
    }
}

export async function installWithBrew(
    packageName: string,
    displayName: string,
    onProgress: InstallProgressCallback,
    version?: string // Specific version to install (e.g., "0.9.1")
): Promise<void> {
    const versionDisplay = version ? ` ${version}` : '';
    onProgress({
        dependency: packageName,
        phase: 'installing',
        message: `Installing ${displayName}${versionDisplay} via Homebrew...`
    });

    try {
        const pathSetup = `export PATH="${HOMEBREW_PATHS}:$PATH"`;

        if (version) {
            // Ensure homebrew/core is tapped (required for brew extract)
            onProgress({
                dependency: packageName,
                phase: 'installing',
                message: `Preparing to extract ${displayName} ${version}...`
            });
            ensureHomebrewCoreTap();

            // Install specific version using brew extract and tap
            // First, ensure we have a local tap
            const tapName = 'sailor/versions';
            try {
                execSync(`bash -c '${pathSetup}; brew tap-new ${tapName} 2>/dev/null || true'`, {
                    encoding: 'utf8',
                    timeout: 60000,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch {
                // Tap may already exist, continue
            }

            // Extract the specific version to our tap
            onProgress({
                dependency: packageName,
                phase: 'installing',
                message: `Extracting ${displayName} ${version}...`
            });

            execSync(`bash -c '${pathSetup}; HOMEBREW_NO_AUTO_UPDATE=1 brew extract --version=${version} ${packageName} ${tapName} --force'`, {
                encoding: 'utf8',
                timeout: 120000, // 2 minutes
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Install the versioned formula
            onProgress({
                dependency: packageName,
                phase: 'installing',
                message: `Installing ${displayName}@${version}...`
            });

            execSync(`bash -c '${pathSetup}; HOMEBREW_NO_AUTO_UPDATE=1 brew install ${tapName}/${packageName}@${version}'`, {
                encoding: 'utf8',
                timeout: 300000, // 5 minutes
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } else {
            // Install latest version
            execSync(`bash -c '${pathSetup}; HOMEBREW_NO_AUTO_UPDATE=1 brew install ${packageName}'`, {
                encoding: 'utf8',
                timeout: 300000, // 5 minutes
                stdio: ['pipe', 'pipe', 'pipe']
            });
        }

        onProgress({
            dependency: packageName,
            phase: 'complete',
            message: `${displayName}${versionDisplay} installed successfully`
        });
    } catch (err) {
        onProgress({
            dependency: packageName,
            phase: 'error',
            message: `Failed to install ${displayName}${versionDisplay}`,
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
        execSync(`HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade ${packageName}`, {
            encoding: 'utf8',
            timeout: 300000, // 5 minutes
            stdio: ['pipe', 'pipe', 'pipe']
        });

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
// Main Dependency Check (Optimized)
// ============================================================================

export async function checkDependencies(): Promise<DependencyCheckResult> {
    const platform = detectPlatform();

    // Batch all path lookups and version checks into a single shell execution
    const batchResults = runBatchedCommands([
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

    // Check Homebrew packages in one call
    const homebrewStatus = checkHomebrewPackages(['colima', 'docker']);

    // Check for conflicts (uses optimized batched commands internally)
    const dockerDesktopInfo = isDockerDesktopInstalled();
    const nonHomebrewColima = checkNonHomebrewInstallFromPaths(colimaPath, homebrewStatus['colima']);
    const nonHomebrewDocker = checkNonHomebrewInstallFromPaths(dockerPath, homebrewStatus['docker']);

    const hasConflicts = dockerDesktopInfo.installed ||
                         nonHomebrewColima.installed ||
                         nonHomebrewDocker.installed;

    const conflicts: ConflictInfo = {
        hasConflicts,
        dockerDesktop: {
            ...dockerDesktopInfo,
            running: dockerDesktopInfo.installed ? isDockerDesktopRunning() : false
        },
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
