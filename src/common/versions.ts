// Version configuration for dependencies
// These versions are used for dependency checking

export interface VersionInfo {
    minimum: string;
    recommended: string;
}

export interface DependencyVersions {
    colima: VersionInfo;
    docker: VersionInfo;
}

// Current recommended and minimum versions
export const DEPENDENCY_VERSIONS: DependencyVersions = {
    colima: {
        minimum: 'v0.8.0',
        recommended: 'v0.9.1'
    },
    docker: {
        minimum: 'v24.0.0',
        recommended: 'v27.5.1'
    }
};

// Homebrew package names
export const HOMEBREW_PACKAGES = {
    colima: 'colima',
    docker: 'docker'
};

// Docker CLI plugins Sailor can install alongside the Docker CLI. `brew install
// docker` ships only the CLI itself — each plugin is a separate formula that
// drops a binary into $(brew --prefix)/lib/docker/cli-plugins, which
// ensureDockerCliPlugins() adds to Docker's search path.
//
// This is the full set of Docker CLI plugins in homebrew-core: they're the only
// formulae whose caveats reference cliPluginsExtraDirs. Others in the docker-*
// namespace (docker-agent, docker-credential-helper, docker-completion) install
// into bin/ or share/ instead, so they're standalone tools rather than plugins.
//
// To offer another plugin: add an entry here and widen DockerPluginKey in
// @common/types. `defaultSelected` pre-checks it in the setup wizard.
export interface DockerPlugin {
    key: 'buildx' | 'compose';
    formula: string;      // Homebrew formula name
    binary: string;       // Filename inside the cli-plugins directory
    subcommand: string;   // What it adds to the docker CLI
    displayName: string;
    description: string;
    defaultSelected: boolean;
}

export const DOCKER_PLUGINS: DockerPlugin[] = [
    {
        key: 'buildx',
        formula: 'docker-buildx',
        binary: 'docker-buildx',
        subcommand: 'buildx',
        displayName: 'Docker Buildx',
        description: 'Extended build capabilities with BuildKit. Required by docker build on modern CLIs',
        defaultSelected: true
    },
    {
        key: 'compose',
        formula: 'docker-compose',
        binary: 'docker-compose',
        subcommand: 'compose',
        displayName: 'Docker Compose',
        description: 'Run multi-container applications from a compose file',
        defaultSelected: true
    }
];

// Compare semantic versions (returns -1 if a < b, 0 if equal, 1 if a > b)
export function compareVersions(a: string, b: string): number {
    // Remove 'v' prefix if present
    const cleanA = a.replace(/^v/, '');
    const cleanB = b.replace(/^v/, '');

    const partsA = cleanA.split('.').map(p => parseInt(p, 10) || 0);
    const partsB = cleanB.split('.').map(p => parseInt(p, 10) || 0);

    const maxLen = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < maxLen; i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;

        if (numA < numB) return -1;
        if (numA > numB) return 1;
    }

    return 0;
}

// Check if version meets minimum requirement
export function meetsMinimum(version: string, minimum: string): boolean {
    return compareVersions(version, minimum) >= 0;
}

// ============================================================================
// Version Detection
// ============================================================================
// Parsers for the version strings each CLI prints. Kept here, separate from the
// shelling-out, so they can be exercised against real command output.

const withVPrefix = (version: string) => version.startsWith('v') ? version : `v${version}`;

/**
 * `colima version 0.9.1` / `colima version v0.9.1`, optionally followed by
 * `git commit: ...` on later lines.
 */
export function parseColimaVersion(output: string | null): string | null {
    if (!output) return null;
    const patterns = [
        /colima version (v?[\d.]+)/i,
        /^(v?[\d.]+)/m
    ];
    for (const pattern of patterns) {
        const match = output.match(pattern);
        if (match) return withVPrefix(match[1]);
    }
    return null;
}

/** `Docker version 27.5.1, build 9f9e405` */
export function parseDockerVersion(output: string | null): string | null {
    const match = output?.match(/Docker version ([\d.]+)/i);
    return match ? withVPrefix(match[1]) : null;
}

/**
 * `Homebrew 4.6.15`, but also `Homebrew >=4.5.0 (shallow or no git repository)`
 * when brew was installed from a shallow clone — hence the non-digit skip.
 */
export function parseHomebrewVersion(output: string | null): string | null {
    const match = output?.match(/Homebrew[^\d]*([\d.]+)/i);
    return match ? withVPrefix(match[1]) : null;
}

/** `github.com/docker/buildx v0.36.1 8fd4c0b1a2...` from `docker buildx version` */
export function parseBuildxVersion(output: string | null): string | null {
    const match = output?.match(/buildx\s+(v?[\d.]+)/i);
    return match ? withVPrefix(match[1]) : null;
}

/** `Docker Compose version v5.4.0` from `docker compose version` */
export function parseComposeVersion(output: string | null): string | null {
    const match = output?.match(/Docker Compose version\s+(v?[\d.]+)/i);
    return match ? withVPrefix(match[1]) : null;
}

/** Stable version of the first formula in `brew info --json=v2` output */
export function parseBrewInfoStableVersion(json: string | null): string | null {
    if (!json) return null;
    try {
        const version = JSON.parse(json).formulae?.[0]?.versions?.stable;
        return version ? withVPrefix(version) : null;
    } catch {
        return null;
    }
}
