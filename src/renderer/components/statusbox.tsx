import React, { useEffect, useState, useRef } from 'react';
import { FiCheck } from 'react-icons/fi';
import { DependencyNotification } from '@common/types';

import "./statusbox.scss";

interface LogEntry {
    timestamp: Date;
    message: string;
    type: 'info' | 'error' | 'status';
}

const MAX_LOG_ENTRIES = 50;

type NotificationState = 'none' | 'has_notifications' | 'acknowledging' | 'acknowledged';

const Statusbox = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [statusClass, setStatusClass] = useState('status-loading');
    const [displayStatus, setDisplayStatus] = useState('Initializing...');
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [colimaReady, setColimaReady] = useState(false);
    const [containersReady, setContainersReady] = useState(false);
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Notification state
    const [notifications, setNotifications] = useState<DependencyNotification[]>([]);
    const [notificationState, setNotificationState] = useState<NotificationState>('none');
    const [showNotifications, setShowNotifications] = useState(false);

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
            // Check for notifications after ready
            checkNotifications();
        }, 600);
    };

    const checkNotifications = async () => {
        try {
            const allNotifications = await window.api.getUntestedVersionNotifications();

            // Filter out acknowledged notifications
            const unacknowledged: DependencyNotification[] = [];
            for (const notif of allNotifications) {
                const isAcknowledged = await window.api.isNotificationAcknowledged(notif.id, notif.version);
                if (!isAcknowledged) {
                    unacknowledged.push(notif);
                }
            }

            setNotifications(unacknowledged);
            if (unacknowledged.length > 0) {
                setNotificationState('has_notifications');
            }
        } catch (err) {
            console.error('Failed to check notifications:', err);
        }
    };

    const handleAcknowledgeAll = async () => {
        setNotificationState('acknowledging');

        try {
            for (const notif of notifications) {
                await window.api.acknowledgeNotification(notif.id, notif.version);
            }

            setNotificationState('acknowledged');
            setShowNotifications(false);

            // After showing checkmark, transition back to normal
            setTimeout(() => {
                setNotifications([]);
                setNotificationState('none');
            }, 1500);
        } catch (err) {
            console.error('Failed to acknowledge notifications:', err);
            setNotificationState('has_notifications');
        }
    };

    const updateStatus = (status: string) => {
        const lowerStatus = status.toLowerCase();

        // Add status change to logs
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
            // Reset ready states when restarting
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
        // Load buffered logs from before component mounted
        window.api.getBufferedLogs().then(bufferedLogs => {
            if (bufferedLogs.length > 0) {
                setLogs(bufferedLogs.map(entry => ({
                    timestamp: new Date(entry.timestamp),
                    message: entry.message,
                    type: entry.type as LogEntry['type']
                })));
            } else {
                // No buffered logs, add initial log
                addLog('Starting Sailor Desktop...', 'info');
            }
        });

        // Check current status (may have been sent before mount)
        window.api.getCurrentStatus().then(status => {
            if (status) {
                updateStatus(status);
            }
        });

        // Check if Colima is already running (ready status may have been sent before mount)
        window.api.isColimaRunning().then(running => {
            if (running) setColimaReady(true);
        });

        // Check if containers are already ready
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

    const hasNotifications = notificationState === 'has_notifications' && notifications.length > 0;
    const isAcknowledged = notificationState === 'acknowledged';

    const handleMouseEnter = () => {
        if (hasNotifications) {
            setShowNotifications(true);
        }
    };

    const handleMouseLeave = () => {
        setShowNotifications(false);
    };

    return (
        <div
            className={`footer ${statusClass} ${isTransitioning ? 'transitioning' : ''} ${hasNotifications ? 'has-notifications' : ''} ${isAcknowledged ? 'acknowledged' : ''}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div id="log" ref={logContainerRef}>
                {showNotifications && hasNotifications ? (
                    <div className="notification-content">
                        <div className="notification-header">
                            <span className="notification-title">Untested versions detected</span>
                        </div>
                        <div className="notification-list">
                            {notifications.map((notif, i) => (
                                <div key={i} className="notification-item">
                                    <span className="notification-message">{notif.message}</span>
                                </div>
                            ))}
                        </div>
                        <div className="notification-actions">
                            <button className="acknowledge-button" onClick={handleAcknowledgeAll}>
                                Acknowledge
                            </button>
                        </div>
                    </div>
                ) : (
                    logs.map((entry, i) => (
                        <div key={i} className={`log-entry ${entry.type}`}>
                            <span className="log-time">{formatTime(entry.timestamp)}</span>
                            <span className="log-message">{entry.message}</span>
                        </div>
                    ))
                )}
            </div>
            <div className="icon-container">
                <div className="chain"></div>
                <div className={`anchor ${hasNotifications ? 'bouncing' : ''}`}></div>
                {hasNotifications && (
                    <div className="notification-badge">{notifications.length}</div>
                )}
                {isAcknowledged && (
                    <div className="acknowledged-check">
                        <FiCheck />
                    </div>
                )}
            </div>
            <div id="cur-status">
                <div className="status-text-container">
                    <span className="status-text">
                        {hasNotifications ? `${notifications.length} notification${notifications.length > 1 ? 's' : ''}` : displayStatus}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default Statusbox
