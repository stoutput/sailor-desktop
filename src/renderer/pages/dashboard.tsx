import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerData } from '@common/types';

import "./dashboard.scss";

const Dashboard = () => {
    const [containers, setContainers] = useState<ContainerData[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        // Initial fetch
        window.api.getContainers().then(setContainers);

        // Listen for updates
        const removeListener = window.api.onContainersUpdate((_event, containers) => {
            setContainers(containers);
        });

        return () => {
            if (removeListener) removeListener();
        };
    }, []);

    const runningContainers = containers.filter(c => c.status === 'running');
    const stoppedContainers = containers.filter(c => c.status !== 'running');

    const handleContainerClick = (id: string) => {
        navigate(`/container/${id}`);
    };

    return (
        <div id='page-content'>
            <div className="stats-bar">
                <div className="stat">
                    <span className="stat-value running">{runningContainers.length}</span>
                    <span className="stat-label">Running</span>
                </div>
                <div className="stat">
                    <span className="stat-value stopped">{stoppedContainers.length}</span>
                    <span className="stat-label">Stopped</span>
                </div>
            </div>

            {runningContainers.length > 0 && (
                <section className="container-section">
                    <h3>Running Containers</h3>
                    <div className="container-list">
                        {runningContainers.map((container) => (
                            <div
                                key={container.id}
                                className='container-info clickable'
                                onClick={() => handleContainerClick(container.id)}
                            >
                                <div className="status-indicator running" />
                                <div className='container-name'>{container.name}</div>
                                <div className='container-image'>{container.image}</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {stoppedContainers.length > 0 && (
                <section className="container-section">
                    <h3>Stopped Containers</h3>
                    <div className="container-list">
                        {stoppedContainers.map((container) => (
                            <div
                                key={container.id}
                                className='container-info clickable'
                                onClick={() => handleContainerClick(container.id)}
                            >
                                <div className="status-indicator stopped" />
                                <div className='container-name'>{container.name}</div>
                                <div className='container-image'>{container.image}</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {containers.length === 0 && (
                <div className="empty-state">
                    <p>No containers found</p>
                </div>
            )}
        </div>
    );
}

export default Dashboard