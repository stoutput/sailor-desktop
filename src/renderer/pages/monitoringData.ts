import { ContainerStats } from '@common/types';

export const WINDOW_MS = 120000;

export interface Sample {
    timestamp: number;
    cpu: number;
    memory: number;
    rx: number | null;
    tx: number | null;
    networkRx: number;
    networkTx: number;
    blockRead: number | null;
    blockWrite: number | null;
    read: number | null;
    write: number | null;
}

export function appendSample(history: Sample[], stats: ContainerStats): Sample[] {
    const previous = history[history.length - 1];
    if (!Number.isFinite(stats.timestamp) || (previous && stats.timestamp <= previous.timestamp)) return history;
    const seconds = previous ? (stats.timestamp - previous.timestamp) / 1000 : 0;
    const rate = (total: number, prior: number) => Math.max(0, total - prior) / seconds;
    const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
    const blockRate = (total: number | null, prior: number | null | undefined) =>
        typeof total === 'number' && Number.isFinite(total) && typeof prior === 'number' && Number.isFinite(prior)
            ? finite(rate(total, prior)) : null;
    const sample: Sample = {
        timestamp: stats.timestamp,
        cpu: finite(stats.cpu),
        memory: stats.memoryLimit > 0 ? finite(stats.memory / stats.memoryLimit * 100) : 0,
        rx: previous ? finite(rate(stats.networkRx, previous.networkRx)) : null,
        tx: previous ? finite(rate(stats.networkTx, previous.networkTx)) : null,
        networkRx: finite(stats.networkRx),
        networkTx: finite(stats.networkTx),
        blockRead: stats.blockRead,
        blockWrite: stats.blockWrite,
        read: blockRate(stats.blockRead, previous?.blockRead),
        write: blockRate(stats.blockWrite, previous?.blockWrite),
    };
    // Keep one sample before the visible window so lines reach the left edge.
    const cutoff = stats.timestamp - WINDOW_MS;
    const firstVisible = history.findIndex(point => point.timestamp >= cutoff);
    return [...history.slice(firstVisible < 0 ? -1 : Math.max(0, firstVisible - 1)), sample];
}

export function timeWindow(start: number, latest: number): [number, number] {
    const end = Math.max(start + WINDOW_MS, latest);
    return [end - WINDOW_MS, end];
}

export function axisMaximum(values: number[]): number {
    return Math.max(0.1, ...values.filter(Number.isFinite)) * 1.1;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
    return `${Number((bytes / Math.pow(1024, index)).toFixed(1))} ${units[index]}`;
}
