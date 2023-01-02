import { platform } from 'os';

export default function getPlatform() {
    switch (platform()) {
        case 'aix':
        case 'freebsd':
        case 'linux':
        case 'openbsd':
        case 'android':
            return 'linux';
        case 'darwin':
        case 'sunos':
            return process.arch == 'arm64' ? 'mac-arm' : 'mac-intel';
        case 'win32':
            return 'win';
        default:
            return '';
    }
};