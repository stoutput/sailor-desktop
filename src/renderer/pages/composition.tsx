import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ContainerData } from '@common/types';
import { useContainers } from '@renderer/hooks/useContainers';
import Spinner from '@components/spinner';
import { FiArrowLeft, FiPlay, FiSquare } from 'react-icons/fi';

import "./composition.scss";

const Composition = () => {
    const { projectName } = useParams<{ projectName: string }>();
    const decodedProjectName = decodeURIComponent(projectName || '');
    const { containers, isLoading } = useContainers();
    const navigate = useNavigate();
    const [isActioning, setIsActioning] = useState(false);

    const projectContainers = useMemo(() => {
        return containers.filter(c => c.composeProject === decodedProjectName);
    }, [containers, decodedProjectName]);

    const runningCount = projectContainers.filter(c => c.status === 'running').length;
    const totalCount = projectContainers.length;

    const getStatusIndicatorClass = (container: ContainerData): string => {
        if (container.status === 'running') return 'running';
        if (container.status === 'paused') return 'paused';
        return 'stopped';
    };

    const getProjectStatus = (): string => {
        if (runningCount === totalCount) return 'running';
        if (runningCount === 0) return 'stopped';
        return 'partial';
    };

    const handleContainerClick = (id: string) => {
        navigate(`/container/${id}`);
    };

    const handleBack = () => {
        navigate('/dashboard');
    };

    const handleComposeUp = async () => {
        setIsActioning(true);
        try {
            await window.api.composeUp(decodedProjectName);
        } catch (err) {
            console.error('Failed to start project:', err);
        } finally {
            setIsActioning(false);
        }
    };

    const handleComposeDown = async () => {
        setIsActioning(true);
        try {
            await window.api.composeDown(decodedProjectName);
        } catch (err) {
            console.error('Failed to stop project:', err);
        } finally {
            setIsActioning(false);
        }
    };

    if (isLoading) {
        return (
            <div id="composition-page">
                <Spinner message="Loading project..." />
            </div>
        );
    }

    if (projectContainers.length === 0) {
        return (
            <div id="composition-page">
                <div className="composition-header">
                    <button className="back-btn" onClick={handleBack}>
                        <FiArrowLeft />
                    </button>
                    <h2>{decodedProjectName}</h2>
                </div>
                <div className="empty-state">
                    <p>No containers found for this project</p>
                </div>
            </div>
        );
    }

    return (
        <div id="composition-page">
            <div className="composition-header">
                <button className="back-btn" onClick={handleBack}>
                    <FiArrowLeft />
                </button>
                <div className="header-info">
                    <h2>{decodedProjectName}</h2>
                    <span className={`status-badge ${getProjectStatus()}`}>
                        {runningCount}/{totalCount} running
                    </span>
                </div>
                <div className="header-actions">
                    <button
                        className="action-btn up"
                        onClick={handleComposeUp}
                        disabled={isActioning || runningCount === totalCount}
                        title="Start all containers"
                    >
                        <FiPlay />
                        <span>Up</span>
                    </button>
                    <button
                        className="action-btn down"
                        onClick={handleComposeDown}
                        disabled={isActioning || runningCount === 0}
                        title="Stop all containers"
                    >
                        <FiSquare />
                        <span>Down</span>
                    </button>
                </div>
            </div>

            <div className="services-list">
                <h3>Services</h3>
                <div className="services-grid">
                    {projectContainers.map((container) => (
                        <div
                            key={container.id}
                            className="service-card clickable"
                            onClick={() => handleContainerClick(container.id)}
                        >
                            <div className={`status-indicator ${getStatusIndicatorClass(container)}`} />
                            <div className="service-info">
                                <div className="service-name">{container.composeService || container.name}</div>
                                <div className="service-image">{container.image}</div>
                                <div className="service-status">{container.status}</div>
                            </div>
                            {container.ports.length > 0 && (
                                <div className="service-ports">
                                    {container.ports.map((port, i) => (
                                        <span key={i} className="port-badge">
                                            {port.publicPort ? `${port.publicPort}:${port.privatePort}` : port.privatePort}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Composition;
