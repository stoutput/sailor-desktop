import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerData } from '@common/types';
import { useContainers } from '@renderer/hooks/useContainers';
import Spinner from '@components/spinner';
import ColimaDown from '@components/colimadown';
import { FiLayers } from 'react-icons/fi';

import "./dashboard.scss";

type StatusFilter = 'running' | 'paused' | 'stopped' | null;

interface FilterChip {
    status: StatusFilter;
    label: string;
}

interface ComposeProject {
    name: string;
    containers: ContainerData[];
}

const FILTER_CHIPS: FilterChip[] = [
    { status: 'running', label: 'Running' },
    { status: 'paused', label: 'Paused' },
    { status: 'stopped', label: 'Stopped' },
];

const Dashboard = () => {
    const { containers, isLoading, isColimaStopped, runningContainers, pausedContainers, stoppedContainers } = useContainers();
    const [selectedStatuses, setSelectedStatuses] = useState<Set<StatusFilter>>(new Set());
    const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const previousPositions = useRef<Record<string, number>>({});
    const navigate = useNavigate();

    // After render, calculate position deltas and animate using direct DOM manipulation
    useLayoutEffect(() => {
        const elements = chipRefs.current;
        const elementsToAnimate: { el: HTMLDivElement; delta: number }[] = [];

        Object.entries(elements).forEach(([key, el]) => {
            if (el && previousPositions.current[key] !== undefined) {
                const newLeft = el.getBoundingClientRect().left;
                const delta = previousPositions.current[key] - newLeft;
                if (Math.abs(delta) > 1) {
                    elementsToAnimate.push({ el, delta });
                }
            }
        });

        if (elementsToAnimate.length > 0) {
            // Apply inverse transform immediately (disable transitions)
            elementsToAnimate.forEach(({ el, delta }) => {
                el.style.transition = 'none';
                el.style.transform = `translateX(${delta}px)`;
            });

            // Force reflow
            void document.body.offsetHeight;

            // Re-enable transitions and animate to final position
            requestAnimationFrame(() => {
                elementsToAnimate.forEach(({ el }) => {
                    el.style.transition = '';
                    el.style.transform = '';
                });
            });
        }

        // Clear previous positions
        previousPositions.current = {};
    }, [selectedStatuses]);

    const handleContainerClick = (id: string) => {
        navigate(`/container/${id}`);
    };

    const handleProjectClick = (projectName: string) => {
        navigate(`/composition/${encodeURIComponent(projectName)}`);
    };

    const handleStatusClick = (status: StatusFilter) => {
        // Capture current positions before state change (FLIP First)
        Object.entries(chipRefs.current).forEach(([key, el]) => {
            if (el) {
                previousPositions.current[key] = el.getBoundingClientRect().left;
            }
        });

        setSelectedStatuses(prev => {
            const next = new Set(prev);
            if (next.has(status)) {
                next.delete(status);
            } else {
                next.add(status);
            }
            return next;
        });
    };

    // Sort chips: active ones first (in original order), then inactive ones
    const sortedChips = useMemo(() => {
        if (selectedStatuses.size === 0) return FILTER_CHIPS;
        const active = FILTER_CHIPS.filter(c => selectedStatuses.has(c.status));
        const inactive = FILTER_CHIPS.filter(c => !selectedStatuses.has(c.status));
        return [...active, ...inactive];
    }, [selectedStatuses]);

    const getChipCount = (status: StatusFilter): number | string => {
        if (isLoading) return '-';
        switch (status) {
            case 'running': return runningContainers.length;
            case 'paused': return pausedContainers.length;
            case 'stopped': return stoppedContainers.length;
            default: return 0;
        }
    };

    const getSelectedContainers = (): ContainerData[] => {
        if (selectedStatuses.size === 0) return containers;

        const result: ContainerData[] = [];
        if (selectedStatuses.has('running')) result.push(...runningContainers);
        if (selectedStatuses.has('paused')) result.push(...pausedContainers);
        if (selectedStatuses.has('stopped')) result.push(...stoppedContainers);
        return result;
    };

    const getStatusIndicatorClass = (container: ContainerData): string => {
        if (container.status === 'running') return 'running';
        if (container.status === 'paused') return 'paused';
        return 'stopped';
    };

    const getEmptyMessage = (): string => {
        if (selectedStatuses.size === 0) return 'No containers to show';

        const labels: string[] = [];
        if (selectedStatuses.has('running')) labels.push('running');
        if (selectedStatuses.has('paused')) labels.push('paused');
        if (selectedStatuses.has('stopped')) labels.push('stopped');

        return `No ${labels.join(' or ')} containers to show`;
    };

    const getProjectStatus = (projectContainers: ContainerData[]): string => {
        const running = projectContainers.filter(c => c.status === 'running').length;
        const total = projectContainers.length;
        if (running === total) return 'running';
        if (running === 0) return 'stopped';
        return 'partial';
    };

    const selectedContainers = getSelectedContainers();

    // Group containers by compose project
    const { composeProjects, standaloneContainers } = useMemo(() => {
        const projectMap = new Map<string, ContainerData[]>();
        const standalone: ContainerData[] = [];

        for (const container of selectedContainers) {
            if (container.composeProject) {
                const existing = projectMap.get(container.composeProject) || [];
                existing.push(container);
                projectMap.set(container.composeProject, existing);
            } else {
                standalone.push(container);
            }
        }

        const projects: ComposeProject[] = Array.from(projectMap.entries())
            .map(([name, containers]) => ({ name, containers }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return { composeProjects: projects, standaloneContainers: standalone };
    }, [selectedContainers]);

    const renderTabContent = () => {
        if (isColimaStopped) {
            return <ColimaDown message="Colima runtime unexpectedly stopped" />;
        }

        if (isLoading) {
            return <Spinner message="Loading containers..." />;
        }

        if (selectedContainers.length === 0) {
            return (
                <div className="empty-message">
                    {getEmptyMessage()}
                </div>
            );
        }

        return (
            <div className="container-list">
                {/* Compose Projects */}
                {composeProjects.map((project) => (
                    <div key={project.name} className="compose-project">
                        <div
                            className={`project-header clickable ${getProjectStatus(project.containers)}`}
                            onClick={() => handleProjectClick(project.name)}
                        >
                            <FiLayers className="project-icon" />
                            <div className="project-info">
                                <div className="project-name">{project.name}</div>
                                <div className="project-count">
                                    {project.containers.filter(c => c.status === 'running').length}/{project.containers.length} running
                                </div>
                            </div>
                            <div className={`project-status-indicator ${getProjectStatus(project.containers)}`} />
                        </div>
                        <div className="project-containers">
                            {project.containers.map((container) => (
                                <div
                                    key={container.id}
                                    className='container-info clickable nested'
                                    onClick={() => handleContainerClick(container.id)}
                                >
                                    <div className={`status-indicator ${getStatusIndicatorClass(container)}`} />
                                    <div className='container-name'>{container.composeService || container.name}</div>
                                    <div className='container-image'>{container.image}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Standalone Containers */}
                {standaloneContainers.map((container) => (
                    <div
                        key={container.id}
                        className='container-info clickable'
                        onClick={() => handleContainerClick(container.id)}
                    >
                        <div className={`status-indicator ${getStatusIndicatorClass(container)}`} />
                        <div className='container-name'>{container.name}</div>
                        <div className='container-image'>{container.image}</div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div id='page-content'>
            <div className="content-box">
                <div className="filter-chips">
                    {sortedChips.map((chip) => (
                        <div
                            key={chip.status}
                            ref={(el) => { chipRefs.current[chip.status ?? ''] = el; }}
                            className={`filter-chip ${chip.status} ${selectedStatuses.has(chip.status) ? 'active' : ''}`}
                            onClick={() => handleStatusClick(chip.status)}
                        >
                            <span className="chip-dot" />
                            <span className="chip-label">{chip.label}</span>
                            <span className="chip-count">{getChipCount(chip.status)}</span>
                        </div>
                    ))}
                </div>

                <div className="content-area">
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
}

export default Dashboard
