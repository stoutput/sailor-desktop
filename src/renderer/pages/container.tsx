import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiPlay, FiSquare } from 'react-icons/fi';
import { ContainerData } from '@common/types';

import "./container.scss";

const ContainerDetails = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [container, setContainer] = useState<ContainerData | null>(null);
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const fetchContainer = async () => {
        const containers = await window.api.getContainers();
        const found = containers.find(c => c.id === id);
        setContainer(found || null);
    };

    // Auto-scroll logs to bottom
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        fetchContainer();

        const removeContainerListener = window.api.onContainersUpdate((_event, containers) => {
            const found = containers.find(c => c.id === id);
            setContainer(found || null);
        });

        // Start log streaming
        if (id) {
            window.api.startContainerLogs(id);
        }

        const removeLogListener = window.api.onContainerLogLine((_event, containerId, line) => {
            if (containerId === id) {
                setLogs(prev => [...prev, line]);
            }
        });

        return () => {
            if (removeContainerListener) removeContainerListener();
            if (removeLogListener) removeLogListener();
            // Stop log streaming when leaving page
            if (id) {
                window.api.stopContainerLogs(id);
            }
        };
    }, [id]);

    const handleStart = async () => {
        if (!id) return;
        setLoading(true);
        try {
            await window.api.startContainer(id);
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        if (!id) return;
        setLoading(true);
        try {
            await window.api.stopContainer(id);
        } finally {
            setLoading(false);
        }
    };

    if (!container) {
        return (
            <div id="page-content" className="container-details">
                <button className="back-btn" onClick={() => navigate(-1)}>
                    <FiArrowLeft /> Back
                </button>
                <div className="not-found">Container not found</div>
            </div>
        );
    }

    const isRunning = container.status === 'running';

    return (
        <div id="page-content" className="container-details">
            <button className="back-btn" onClick={() => navigate(-1)}>
                <FiArrowLeft /> Back
            </button>

            <div className="details-layout">
                <div className="details-panel">
                    <div className="container-header">
                        <div className={`status-badge ${container.status}`}>
                            {container.status}
                        </div>
                        <h1>{container.name}</h1>
                        <p className="container-id">{container.id.slice(0, 12)}</p>
                    </div>

                    <div className="actions">
                        {isRunning ? (
                            <button
                                className="action-btn stop"
                                onClick={handleStop}
                                disabled={loading}
                            >
                                <FiSquare /> Stop
                            </button>
                        ) : (
                            <button
                                className="action-btn start"
                                onClick={handleStart}
                                disabled={loading}
                            >
                                <FiPlay /> Start
                            </button>
                        )}
                    </div>

                    <div className="details-grid">
                        <div className="detail-card">
                            <h3>Image</h3>
                            <p>{container.image}</p>
                        </div>

                        <div className="detail-card">
                            <h3>Created</h3>
                            <p>{new Date(container.created * 1000).toLocaleString()}</p>
                        </div>

                        {container.ports.length > 0 && (
                            <div className="detail-card">
                                <h3>Ports</h3>
                                <ul>
                                    {container.ports.map((port, i) => (
                                        <li key={i}>
                                            {port.publicPort ? `${port.publicPort}:` : ''}{port.privatePort}/{port.type}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {container.networks.length > 0 && (
                            <div className="detail-card">
                                <h3>Networks</h3>
                                <ul>
                                    {container.networks.map((net, i) => (
                                        <li key={i}>
                                            <strong>{net.name}</strong>
                                            {net.ipAddress && <span className="ip"> ({net.ipAddress})</span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>

                <div className="logs-panel">
                    <div className="logs-header">
                        <h3>Logs</h3>
                        {!isRunning && <span className="logs-status">Container stopped</span>}
                    </div>
                    <div className="logs-container monospace">
                        {logs.length === 0 ? (
                            <div className="logs-empty">
                                {isRunning ? 'Waiting for logs...' : 'No logs available'}
                            </div>
                        ) : (
                            logs.map((line, i) => (
                                <div key={i} className="log-line">{line}</div>
                            ))
                        )}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ContainerDetails;
