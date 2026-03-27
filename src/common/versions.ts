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
