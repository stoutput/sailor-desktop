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

    const updateStatus = (status: string) => {
        const lowerStatus = status.toLowerCase();

        // Add status change to logs
        addLog(status, 'status');

        if (lowerStatus === 'ready') {
            // Trigger transition animation
            setIsTransitioning(true);
            setTimeout(() => {
                setStatusClass('status-ready');
                setDisplayStatus('Anchors away!');
                setIsTransitioning(false);
            }, 600); // Match animation duration
        } else if (lowerStatus === 'error' || status.toLowerCase().includes('error')) {
            setStatusClass('status-error');
            setDisplayStatus(status);
        } else {
            setStatusClass('status-loading');
            setDisplayStatus(status);
        }
    };

    useEffect(() => {
        // Add initial log
        addLog('Starting Sailor Desktop...', 'info');

        const removeStatusListener = window.api.onUpdateStatus((_event, status: string) => {
            updateStatus(status);
        });

        const removeLogListener = window.api.onLogMessage((_event, message: string, type: string) => {
            addLog(message, type as LogEntry['type']);
        });

        return () => {
            if (removeStatusListener) removeStatusListener();
            if (removeLogListener) removeLogListener();
        };
    }, []);

    // Auto-scroll logs to bottom when new entries added
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
