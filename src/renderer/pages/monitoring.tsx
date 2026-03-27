import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerData, ContainerStats } from '@common/types';
import { useContainers } from '@renderer/hooks/useContainers';
import Spinner from '@components/spinner';
import ColimaDown from '@components/colimadown';
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

// Round up to a nice tick value
const roundUpToNiceTick = (value: number): number => {
    if (value <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;

    let niceTick: number;
    if (normalized <= 1) niceTick = 1;
    else if (normalized <= 2) niceTick = 2;
    else if (normalized <= 5) niceTick = 5;
    else niceTick = 10;

    return niceTick * magnitude;
};

// Format time offset for X axis
const formatTimeOffset = (secondsAgo: number): string => {
    if (secondsAgo <= 0) return 'now';
    if (secondsAgo < 60) return `-${secondsAgo}s`;
    const minutes = Math.floor(secondsAgo / 60);
    const seconds = secondsAgo % 60;
    if (seconds === 0) return `-${minutes}m`;
    return `-${minutes}m${seconds}s`;
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
    const { isLoading, isColimaStopped, runningContainers } = useContainers();
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
            removeStatsListener?.();
            window.api.stopContainerStats();
        };
    }, []);

    // Draw graphs
    useEffect(() => {
        const drawGraph = (
            canvas: HTMLCanvasElement | null,
            dataKey: 'cpu' | 'memory',
            yLabelFormatter: (v: number) => string,
            unit: string
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
            const padding = { top: 10, right: 10, bottom: 25, left: 50 };
            const graphWidth = width - padding.left - padding.right;
            const graphHeight = height - padding.top - padding.bottom;

            // Calculate max value from data
            let dataMax = 0;
            runningContainers.forEach(container => {
                const history = statsHistory[container.id];
                if (history && history[dataKey].length > 0) {
                    const containerMax = Math.max(...history[dataKey]);
                    dataMax = Math.max(dataMax, containerMax);
                }
            });

            // Round up to nice tick value, minimum of 1 for percentage graphs
            const maxValue = Math.max(roundUpToNiceTick(dataMax * 1.1), unit === '%' ? 10 : 1);

            // Clear
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, width, height);

            // Draw horizontal grid lines and Y-axis labels
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 0.5;
            const yTickCount = 4;
            for (let i = 0; i <= yTickCount; i++) {
                const y = padding.top + (graphHeight * i / yTickCount);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                ctx.fillStyle = '#888';
                ctx.font = '10px SF Mono, Monaco, monospace';
                ctx.textAlign = 'right';
                const value = maxValue - (maxValue * i / yTickCount);
                ctx.fillText(yLabelFormatter(value), padding.left - 5, y + 3);
            }

            // Draw X-axis time labels
            const totalSeconds = (MAX_DATA_POINTS - 1) * 2; // 2 seconds per data point
            const xTickCount = 4;
            ctx.fillStyle = '#888';
            ctx.font = '10px SF Mono, Monaco, monospace';
            ctx.textAlign = 'center';
            for (let i = 0; i <= xTickCount; i++) {
                const x = padding.left + (graphWidth * i / xTickCount);
                const secondsAgo = Math.round(totalSeconds * (1 - i / xTickCount));
                ctx.fillText(formatTimeOffset(secondsAgo), x, height - 5);
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
                const dataLen = history[dataKey].length;
                history[dataKey].forEach((value, i) => {
                    // Offset x position based on how many data points we have
                    const xOffset = MAX_DATA_POINTS - dataLen;
                    const x = padding.left + (graphWidth * (i + xOffset) / (MAX_DATA_POINTS - 1));
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
            const padding = { top: 10, right: 10, bottom: 25, left: 60 };
            const graphWidth = width - padding.left - padding.right;
            const graphHeight = height - padding.top - padding.bottom;

            // Find max network rate for scaling
            let dataMax = 0;
            runningContainers.forEach(container => {
                const history = statsHistory[container.id];
                if (history) {
                    for (let i = 1; i < history.networkRx.length; i++) {
                        const rxRate = Math.max(0, history.networkRx[i] - history.networkRx[i-1]);
                        const txRate = Math.max(0, history.networkTx[i] - history.networkTx[i-1]);
                        dataMax = Math.max(dataMax, rxRate, txRate);
                    }
                }
            });

            // Round up to nice tick value, minimum 1KB
            const maxNetwork = Math.max(roundUpToNiceTick(dataMax * 1.1), 1024);

            // Clear
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(0, 0, width, height);

            // Draw horizontal grid lines and Y-axis labels
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 0.5;
            const yTickCount = 4;
            for (let i = 0; i <= yTickCount; i++) {
                const y = padding.top + (graphHeight * i / yTickCount);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                ctx.fillStyle = '#888';
                ctx.font = '10px SF Mono, Monaco, monospace';
                ctx.textAlign = 'right';
                const value = maxNetwork - (maxNetwork * i / yTickCount);
                ctx.fillText(formatBytes(value) + '/s', padding.left - 5, y + 3);
            }

            // Draw X-axis time labels
            const totalSeconds = (MAX_DATA_POINTS - 1) * 2;
            const xTickCount = 4;
            ctx.fillStyle = '#888';
            ctx.font = '10px SF Mono, Monaco, monospace';
            ctx.textAlign = 'center';
            for (let i = 0; i <= xTickCount; i++) {
                const x = padding.left + (graphWidth * i / xTickCount);
                const secondsAgo = Math.round(totalSeconds * (1 - i / xTickCount));
                ctx.fillText(formatTimeOffset(secondsAgo), x, height - 5);
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

                const dataLen = history.networkRx.length;
                const xOffset = MAX_DATA_POINTS - dataLen;

                ctx.beginPath();
                for (let i = 1; i < history.networkRx.length; i++) {
                    const rate = Math.max(0, history.networkRx[i] - history.networkRx[i-1]);
                    const x = padding.left + (graphWidth * (i + xOffset) / (MAX_DATA_POINTS - 1));
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
                    const rate = Math.max(0, history.networkTx[i] - history.networkTx[i-1]);
                    const x = padding.left + (graphWidth * (i + xOffset) / (MAX_DATA_POINTS - 1));
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

        drawGraph(cpuCanvasRef.current, 'cpu', v => `${v.toFixed(0)}%`, '%');
        drawGraph(memCanvasRef.current, 'memory', v => `${v.toFixed(0)}%`, '%');
        drawNetworkGraph(netCanvasRef.current);
    }, [runningContainers, statsHistory, hoveredContainerId, getContainerColor]);

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

    return (
        <div id="monitoring-page" onMouseMove={handleMouseMove}>
            <h2>Container Monitoring</h2>

            {isColimaStopped ? (
                <ColimaDown message="Colima runtime unexpectedly stopped" />
            ) : isLoading ? (
                <Spinner message="Loading containers..." />
            ) : runningContainers.length === 0 ? (
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
