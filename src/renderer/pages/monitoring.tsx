import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerData, ContainerStats } from '@common/types';
import "./monitoring.scss";

// Color palette for containers
const COLORS = [
    '#34c0f7', // blue
    '#4caf50', // green
    '#ff9800', // orange
    '#e91e63', // pink
    '#9c27b0', // purple
    '#00bcd4', // cyan
    '#f44336', // red
    '#ffeb3b', // yellow
    '#795548', // brown
    '#607d8b', // blue-grey
];

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

interface StatsHistory {
    [containerId: string]: {
        timestamps: number[];
        cpu: number[];
        memory: number[];
        networkRx: number[];
        networkTx: number[];
    };
}

interface HoverInfo {
    container: ContainerData | null;
    x: number;
    y: number;
}

const MAX_DATA_POINTS = 60; // 2 minutes at 2s intervals

const Monitoring = () => {
    const [containers, setContainers] = useState<ContainerData[]>([]);
    const [statsHistory, setStatsHistory] = useState<StatsHistory>({});
    const [hoverInfo, setHoverInfo] = useState<HoverInfo>({ container: null, x: 0, y: 0 });
    const [hoveredContainerId, setHoveredContainerId] = useState<string | null>(null);
    const navigate = useNavigate();

    const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
    const memCanvasRef = useRef<HTMLCanvasElement>(null);
    const netCanvasRef = useRef<HTMLCanvasElement>(null);

    const containerColorMap = useRef<Map<string, string>>(new Map());

    const getContainerColor = useCallback((containerId: string): string => {
        if (!containerColorMap.current.has(containerId)) {
            const colorIndex = containerColorMap.current.size % COLORS.length;
            containerColorMap.current.set(containerId, COLORS[colorIndex]);
        }
        return containerColorMap.current.get(containerId)!;
    }, []);

    useEffect(() => {
        // Initial container fetch
        window.api.getContainers().then(setContainers);

        // Listen for container updates
        const removeContainerListener = window.api.onContainersUpdate((_event, containers) => {
            setContainers(containers);
        });

        // Start stats streaming
        window.api.startContainerStats();

        // Listen for stats updates
        const removeStatsListener = window.api.onContainerStats((_event, stats: ContainerStats) => {
            setStatsHistory(prev => {
                const history = prev[stats.containerId] || {
                    timestamps: [],
                    cpu: [],
                    memory: [],
                    networkRx: [],
                    networkTx: []
                };

                const newHistory = {
                    timestamps: [...history.timestamps, stats.timestamp].slice(-MAX_DATA_POINTS),
                    cpu: [...history.cpu, stats.cpu].slice(-MAX_DATA_POINTS),
                    memory: [...history.memory, (stats.memory / stats.memoryLimit) * 100].slice(-MAX_DATA_POINTS),
                    networkRx: [...history.networkRx, stats.networkRx].slice(-MAX_DATA_POINTS),
                    networkTx: [...history.networkTx, stats.networkTx].slice(-MAX_DATA_POINTS)
                };

                return {
                    ...prev,
                    [stats.containerId]: newHistory
                };
            });
        });

        return () => {
            removeContainerListener?.();
            removeStatsListener?.();
            window.api.stopContainerStats();
        };
    }, []);

    // Draw graphs
    useEffect(() => {
        const runningContainers = containers.filter(c => c.status === 'running');

        const drawGraph = (
            canvas: HTMLCanvasElement | null,
            dataKey: 'cpu' | 'memory',
            maxValue: number,
            yLabelFormatter: (v: number) => string
        ) => {
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

            const width = rect.width;
            const height = rect.height;
            const padding = { top: 10, right: 10, bottom: 20, left: 50 };
            const graphWidth = width - padding.left - padding.right;
            const graphHeight = height - padding.top - padding.bottom;

            // Clear
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, width, height);

            // Draw grid
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= 4; i++) {
                const y = padding.top + (graphHeight * i / 4);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                ctx.fillStyle = '#888';
                ctx.font = '10px SF Mono, Monaco, monospace';
                ctx.textAlign = 'right';
                const value = maxValue - (maxValue * i / 4);
                ctx.fillText(yLabelFormatter(value), padding.left - 5, y + 3);
            }

            // Draw lines for each container
            runningContainers.forEach(container => {
                const history = statsHistory[container.id];
                if (!history || history[dataKey].length < 2) return;

                const color = getContainerColor(container.id);
                const isHovered = hoveredContainerId === container.id;

                ctx.strokeStyle = color;
                ctx.lineWidth = isHovered ? 3 : 1.5;
                ctx.globalAlpha = isHovered ? 1 : (hoveredContainerId ? 0.3 : 0.8);

                ctx.beginPath();
                history[dataKey].forEach((value, i) => {
                    const x = padding.left + (graphWidth * i / (MAX_DATA_POINTS - 1));
                    const y = padding.top + graphHeight - (graphHeight * Math.min(value, maxValue) / maxValue);

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                ctx.stroke();
                ctx.globalAlpha = 1;
            });
        };

        const drawNetworkGraph = (canvas: HTMLCanvasElement | null) => {
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

            const width = rect.width;
            const height = rect.height;
            const padding = { top: 10, right: 10, bottom: 20, left: 60 };
            const graphWidth = width - padding.left - padding.right;
            const graphHeight = height - padding.top - padding.bottom;

            // Find max network value for scaling
            let maxNetwork = 1024 * 1024; // 1MB minimum scale
            runningContainers.forEach(container => {
                const history = statsHistory[container.id];
                if (history) {
                    // Calculate rate (bytes per interval)
                    for (let i = 1; i < history.networkRx.length; i++) {
                        const rxRate = history.networkRx[i] - history.networkRx[i-1];
                        const txRate = history.networkTx[i] - history.networkTx[i-1];
                        maxNetwork = Math.max(maxNetwork, rxRate, txRate);
                    }
                }
            });

            // Clear
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, width, height);

            // Draw grid
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= 4; i++) {
                const y = padding.top + (graphHeight * i / 4);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                ctx.fillStyle = '#888';
                ctx.font = '10px SF Mono, Monaco, monospace';
                ctx.textAlign = 'right';
                const value = maxNetwork - (maxNetwork * i / 4);
                ctx.fillText(formatBytes(value) + '/s', padding.left - 5, y + 3);
            }

            // Draw lines for each container (network rate)
            runningContainers.forEach(container => {
                const history = statsHistory[container.id];
                if (!history || history.networkRx.length < 2) return;

                const color = getContainerColor(container.id);
                const isHovered = hoveredContainerId === container.id;

                // Draw RX (solid line)
                ctx.strokeStyle = color;
                ctx.lineWidth = isHovered ? 3 : 1.5;
                ctx.globalAlpha = isHovered ? 1 : (hoveredContainerId ? 0.3 : 0.8);
                ctx.setLineDash([]);

                ctx.beginPath();
                for (let i = 1; i < history.networkRx.length; i++) {
                    const rate = history.networkRx[i] - history.networkRx[i-1];
                    const x = padding.left + (graphWidth * i / (MAX_DATA_POINTS - 1));
                    const y = padding.top + graphHeight - (graphHeight * Math.min(rate, maxNetwork) / maxNetwork);

                    if (i === 1) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();

                // Draw TX (dashed line)
                ctx.setLineDash([4, 2]);
                ctx.beginPath();
                for (let i = 1; i < history.networkTx.length; i++) {
                    const rate = history.networkTx[i] - history.networkTx[i-1];
                    const x = padding.left + (graphWidth * i / (MAX_DATA_POINTS - 1));
                    const y = padding.top + graphHeight - (graphHeight * Math.min(rate, maxNetwork) / maxNetwork);

                    if (i === 1) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
            });
        };

        drawGraph(cpuCanvasRef.current, 'cpu', 100, v => `${v.toFixed(0)}%`);
        drawGraph(memCanvasRef.current, 'memory', 100, v => `${v.toFixed(0)}%`);
        drawNetworkGraph(netCanvasRef.current);
    }, [containers, statsHistory, hoveredContainerId, getContainerColor]);

    const handleContainerClick = (id: string) => {
        navigate(`/container/${id}`);
    };

    const handleKeyHover = (container: ContainerData | null, e?: React.MouseEvent) => {
        if (container && e) {
            setHoverInfo({ container, x: e.clientX, y: e.clientY });
            setHoveredContainerId(container.id);
        } else {
            setHoverInfo({ container: null, x: 0, y: 0 });
            setHoveredContainerId(null);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (hoverInfo.container) {
            setHoverInfo(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
        }
    };

    const runningContainers = containers.filter(c => c.status === 'running');

    return (
        <div id="monitoring-page" onMouseMove={handleMouseMove}>
            <h2>Container Monitoring</h2>

            {runningContainers.length === 0 ? (
                <div className="empty-state">
                    <p>No running containers to monitor</p>
                </div>
            ) : (
                <>
                    <div className="graphs-container">
                        <div className="graph-section">
                            <h3>CPU Usage (%)</h3>
                            <canvas ref={cpuCanvasRef} className="stats-graph" />
                        </div>
                        <div className="graph-section">
                            <h3>Memory Usage (%)</h3>
                            <canvas ref={memCanvasRef} className="stats-graph" />
                        </div>
                        <div className="graph-section">
                            <h3>Network I/O (solid: RX, dashed: TX)</h3>
                            <canvas ref={netCanvasRef} className="stats-graph" />
                        </div>
                    </div>

                    <div className="legend">
                        <h3>Containers</h3>
                        <div className="legend-items">
                            {runningContainers.map(container => (
                                <div
                                    key={container.id}
                                    className={`legend-item ${hoveredContainerId === container.id ? 'hovered' : ''}`}
                                    style={{ '--container-color': getContainerColor(container.id) } as React.CSSProperties}
                                    onMouseEnter={(e) => handleKeyHover(container, e)}
                                    onMouseLeave={() => handleKeyHover(null)}
                                    onClick={() => handleContainerClick(container.id)}
                                >
                                    <div className="color-indicator" />
                                    <span className="container-name">{container.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {hoverInfo.container && (
                <div
                    className="container-popup"
                    style={{
                        left: hoverInfo.x + 15,
                        top: hoverInfo.y + 15
                    }}
                >
                    <div className="popup-header">
                        <div className="status-indicator running" />
                        <span className="container-name">{hoverInfo.container.name}</span>
                    </div>
                    <div className="popup-details">
                        <div className="detail-row">
                            <span className="label">Image:</span>
                            <span className="value">{hoverInfo.container.image}</span>
                        </div>
                        <div className="detail-row">
                            <span className="label">ID:</span>
                            <span className="value monospace">{hoverInfo.container.id.slice(0, 12)}</span>
                        </div>
                        {hoverInfo.container.ports.length > 0 && (
                            <div className="detail-row">
                                <span className="label">Ports:</span>
                                <span className="value monospace">
                                    {hoverInfo.container.ports.map(p =>
                                        p.publicPort ? `${p.publicPort}:${p.privatePort}` : `${p.privatePort}`
                                    ).join(', ')}
                                </span>
                            </div>
                        )}
                        {hoverInfo.container.networks.length > 0 && (
                            <div className="detail-row">
                                <span className="label">Networks:</span>
                                <span className="value">{hoverInfo.container.networks.map(n => n.name).join(', ')}</span>
                            </div>
                        )}
                    </div>
                    <div className="popup-hint">Click to view details</div>
                </div>
            )}
        </div>
    );
};

export default Monitoring;
