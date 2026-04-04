import React, { useEffect, useState, useRef } from 'react';

import "./statusbox.scss";

interface LogEntry {
    timestamp: Date;
    message: string;
    type: 'info' | 'error' | 'status';
}

const MAX_LOG_ENTRIES = 50;

const Statusbox = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [statusClass, setStatusClass] = useState('status-loading');
    const [displayStatus, setDisplayStatus] = useState('Initializing...');
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [colimaReady, setColimaReady] = useState(false);
    const [containersReady, setContainersReady] = useState(false);
    const logContainerRef = useRef<HTMLDivElement>(null);

    const addLog = (message: string, type: LogEntry['type'] = 'info') => {
        setLogs(prev => {
            const newLogs = [...prev, { timestamp: new Date(), message, type }];
            if (newLogs.length > MAX_LOG_ENTRIES) {
                return newLogs.slice(-MAX_LOG_ENTRIES);
            }
            return newLogs;
        });
    };

    const transitionToReady = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            setStatusClass('status-ready');
            setDisplayStatus('Anchors away!');
            setIsTransitioning(false);
        }, 600);
    };

    const updateStatus = (status: string) => {
        const lowerStatus = status.toLowerCase();

        addLog(status, 'status');

        if (lowerStatus === 'ready') {
            setColimaReady(true);
            setDisplayStatus('Polling containers...');
        } else if (lowerStatus === 'stopped') {
            setStatusClass('status-warning');
            setDisplayStatus('Runtime stopped');
            setColimaReady(false);
            setContainersReady(false);
        } else if (lowerStatus === 'error' || status.toLowerCase().includes('error')) {
            setStatusClass('status-error');
            setDisplayStatus(status);
        } else {
            setStatusClass('status-loading');
            setDisplayStatus(status);
            if (lowerStatus.includes('booting') || lowerStatus.includes('starting')) {
                setColimaReady(false);
                setContainersReady(false);
            }
        }
    };

    // Transition to ready only when both colima and containers are ready
    useEffect(() => {
        if (colimaReady && containersReady) {
            transitionToReady();
        }
    }, [colimaReady, containersReady]);

    useEffect(() => {
        window.api.getBufferedLogs().then(bufferedLogs => {
            if (bufferedLogs.length > 0) {
                setLogs(bufferedLogs.map(entry => ({
                    timestamp: new Date(entry.timestamp),
                    message: entry.message,
                    type: entry.type as LogEntry['type']
                })));
            } else {
                addLog('Starting Sailor Desktop...', 'info');
            }
        });

        window.api.getCurrentStatus().then(status => {
            if (status) updateStatus(status);
        });

        window.api.isColimaRunning().then(running => {
            if (running) setColimaReady(true);
        });

        window.api.getContainersReady().then(ready => {
            if (ready) setContainersReady(true);
        });

        const removeStatusListener = window.api.onUpdateStatus((_event, status: string) => {
            updateStatus(status);
        });

        const removeLogListener = window.api.onLogMessage((_event, message: string, type: string) => {
            addLog(message, type as LogEntry['type']);
        });

        const removeContainersReadyListener = window.api.onContainersReady(() => {
            setContainersReady(true);
        });

        return () => {
            if (removeStatusListener) removeStatusListener();
            if (removeLogListener) removeLogListener();
            if (removeContainersReadyListener) removeContainersReadyListener();
        };
    }, []);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    return (
        <div className={`footer ${statusClass} ${isTransitioning ? 'transitioning' : ''}`}>
            <div id="log" ref={logContainerRef}>
                {logs.map((entry, i) => (
                    <div key={i} className={`log-entry ${entry.type}`}>
                        <span className="log-time">{formatTime(entry.timestamp)}</span>
                        <span className="log-message">{entry.message}</span>
                    </div>
                ))}
            </div>
            <div className="icon-container">
                <div className="chain"></div>
                <div className="anchor"></div>
            </div>
            <div id="cur-status">
                <div className="status-text-container">
                    <span className="status-text">{displayStatus}</span>
                </div>
            </div>
        </div>
    );
};

export default Statusbox
