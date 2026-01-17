import React, { useEffect, useState } from 'react';
import { ColimaStats } from '@common/types';
import "./colimastats.scss";

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const ColimaStatsFooter = () => {
    const [stats, setStats] = useState<ColimaStats | null>(null);

    useEffect(() => {
        // Initial fetch
        window.api.getColimaStats().then(setStats);

        // Poll every 10 seconds
        const interval = setInterval(() => {
            window.api.getColimaStats().then(setStats);
        }, 10000);

        return () => clearInterval(interval);
    }, []);

    if (!stats) {
        return null;
    }

    return (
        <div id="colima-stats-footer" className="monospace">
            <div className="stat-item">
                <span className="stat-label">CPU</span>
                <span className="stat-value">{stats.cpu}</span>
            </div>
            <div className="stat-item">
                <span className="stat-label">MEM</span>
                <span className="stat-value">{formatBytes(stats.memory * 1024 * 1024 * 1024)}</span>
            </div>
            <div className="stat-item">
                <span className="stat-label">DISK</span>
                <span className="stat-value">{formatBytes(stats.disk * 1024 * 1024 * 1024)}</span>
            </div>
        </div>
    );
};

export default ColimaStatsFooter;
