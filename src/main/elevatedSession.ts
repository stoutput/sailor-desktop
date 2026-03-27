import sudo from 'sudo-prompt';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SUDO_OPTIONS = { name: 'Sailor' };

/**
 * Executes a single command with elevated privileges using sudo-prompt.
 * Shows native macOS password dialog.
 */
export function sudoExec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        sudo.exec(command, SUDO_OPTIONS, (error, stdout) => {
            if (error) {
                reject(error);
            } else {
                resolve((stdout || '').toString().trim());
            }
        });
    });
}

/**
 * Executes multiple commands with elevated privileges in a single sudo-prompt call.
 * This batches all operations to avoid multiple password prompts.
 */
export async function sudoExecBatch(commands: string[]): Promise<{ results: (string | null)[]; errors: (string | null)[] }> {
    if (commands.length === 0) {
        return { results: [], errors: [] };
    }

    // Create a temporary script that runs all commands
    const scriptPath = path.join(os.tmpdir(), `sailor-batch-${Date.now()}.sh`);
    const delimiter = '___SAILOR_RESULT___';
    const errorDelimiter = '___SAILOR_ERROR___';

    // Build script that runs each command and captures output/errors
    const scriptContent = `#!/bin/bash
${commands.map((cmd, i) => `
# Command ${i}
OUTPUT_${i}=$(${cmd} 2>&1) && echo "${delimiter}$OUTPUT_${i}" || echo "${errorDelimiter}$OUTPUT_${i}"
`).join('\n')}
`;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    return new Promise((resolve, reject) => {
        sudo.exec(`bash "${scriptPath}"`, SUDO_OPTIONS, (error, stdout) => {
            // Clean up script
            try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }

            if (error) {
                reject(error);
                return;
            }

            const output = (stdout || '').toString();
            const results: (string | null)[] = [];
            const errors: (string | null)[] = [];

            // Parse output - look for our delimiters
            const lines = output.split('\n');

            for (const line of lines) {
                if (line.startsWith(delimiter)) {
                    results.push(line.substring(delimiter.length).trim() || null);
                    errors.push(null);
                } else if (line.startsWith(errorDelimiter)) {
                    results.push(null);
                    errors.push(line.substring(errorDelimiter.length).trim() || 'Unknown error');
                }
            }

            // Ensure we have the right number of results
            while (results.length < commands.length) {
                results.push(null);
                errors.push('No output captured');
            }

            resolve({ results, errors });
        });
    });
}

/**
 * Simple wrapper for elevated operations.
 * Each exec() call will prompt for password via native macOS dialog.
 */
class ElevatedSession {
    /**
     * Execute a command with elevated privileges.
     * Shows native macOS password dialog.
     */
    async exec(command: string): Promise<string> {
        return sudoExec(command);
    }

    /**
     * Execute multiple commands in a single elevated prompt.
     * Use this to batch operations and avoid multiple password dialogs.
     */
    async execBatch(commands: string[]): Promise<{ results: (string | null)[]; errors: (string | null)[] }> {
        return sudoExecBatch(commands);
    }
}

// Singleton instance
export const elevatedSession = new ElevatedSession();
export default ElevatedSession;
