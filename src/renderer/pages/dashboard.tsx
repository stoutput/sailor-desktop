import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerData } from '@common/types';
import { useContainers } from '@renderer/hooks/useContainers';
import Spinner from '@components/spinner';
import ColimaDown from '@components/colimadown';
import { FiLayers, FiChevronDown, FiPlay, FiSquare } from 'react-icons/fi';

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
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
    const [actioningProjects, setActioningProjects] = useState<Set<string>>(new Set());
    const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
    const pendingProjects = useRef(new Set<string>());
    const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const previousPositions = useRef<Record<string, number>>({});
    const projectRefs = useRef(new Map<string, HTMLDivElement>());
    const projectPositions = useRef(new Map<string, DOMRect>());
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

    useLayoutEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            projectPositions.current.clear();
            return;
        }
        const animations: Animation[] = [];
        projectRefs.current.forEach((element, name) => {
            const previous = projectPositions.current.get(name);
            if (!previous) return;
            const current = element.getBoundingClientRect();
            const x = previous.left - current.left;
            const y = previous.top - current.top;
            if (x || y) animations.push(element.animate([
                { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
            ], { duration: 350, easing: 'cubic-bezier(.22, 1, .36, 1)' }));
        });
        projectPositions.current.clear();
        return () => animations.forEach(animation => animation.cancel());
    }, [expandedProjects]);

    const handleContainerClick = (id: string) => {
        navigate(`/container/${id}`);
    };

    const handleProjectClick = (projectName: string) => {
        projectPositions.current = new Map(Array.from(projectRefs.current, ([name, element]) => [name, element.getBoundingClientRect()]));
        setExpandedProjects(prev => {
            const next = new Set(prev);
            if (next.has(projectName)) next.delete(projectName);
            else next.add(projectName);
            return next;
        });
    };

    const handleComposeAction = async (projectName: string, action: 'up' | 'down') => {
        if (pendingProjects.current.has(projectName)) return;
        pendingProjects.current.add(projectName);
        setActioningProjects(new Set(pendingProjects.current));
        setActionErrors(prev => ({ ...prev, [projectName]: '' }));
        try {
            if (action === 'up') await window.api.composeUp(projectName);
            else await window.api.composeDown(projectName);
        } catch (err) {
            console.error(`Failed to compose ${action} project ${projectName}:`, err);
            setActionErrors(prev => ({ ...prev, [projectName]: `Could not ${action === 'up' ? 'start' : 'stop'} project. Please try again.` }));
        } finally {
            pendingProjects.current.delete(projectName);
            setActioningProjects(new Set(pendingProjects.current));
        }
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
        if (projectContainers.some(c => c.status === 'paused')) return 'paused';
        if (projectContainers.some(c => c.status === 'running')) return 'running';
        return 'stopped';
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

    const expansionOrder = new Map(Array.from(expandedProjects, (name, index) => [name, index]));
    const orderedProjects = [...composeProjects].sort((a, b) =>
        (expansionOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
        (expansionOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));

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
                {orderedProjects.map((project) => {
                    const projectContainers = containers.filter(c => c.composeProject === project.name);
                    const expanded = expandedProjects.has(project.name);
                    return <div key={project.name} ref={element => { if (element) projectRefs.current.set(project.name, element); else projectRefs.current.delete(project.name); }}
                        className={`compose-project ${expanded ? 'expanded' : ''}`}>
                        <div className={`project-header ${getProjectStatus(projectContainers)}`}>
                            <button
                                className="project-toggle"
                                onClick={() => handleProjectClick(project.name)}
                                aria-expanded={expanded}
                                aria-controls={`project-${project.name}`}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
                            >
                                <FiLayers className="project-icon" />
                                <div className="project-info">
                                    <div className="project-name">{project.name}</div>
                                    <div className="project-count">
                                        {projectContainers.filter(c => c.status === 'running').length}/{projectContainers.length} running
                                    </div>
                                </div>
                                <span className="project-expand"><FiChevronDown className="project-chevron" /></span>
                            </button>
                            <div className="project-actions">
                                <button className="up" disabled={actioningProjects.has(project.name) || projectContainers.every(c => c.status === 'running')}
                                    onClick={() => handleComposeAction(project.name, 'up')} aria-label={`Start ${project.name}`} title="Start all project containers">
                                    <FiPlay /><span className="action-label">Up</span>
                                </button>
                                <button className="down" disabled={actioningProjects.has(project.name) || !projectContainers.some(c => c.status === 'running' || c.status === 'paused')}
                                    onClick={() => handleComposeAction(project.name, 'down')} aria-label={`Stop ${project.name}`} title="Stop all project containers">
                                    <FiSquare /><span className="action-label">Down</span>
                                </button>
                            </div>
                        </div>
                        {actionErrors[project.name] && <div className="project-error" role="alert">{actionErrors[project.name]}</div>}
                        <div id={`project-${project.name}`} className="project-body"
                            aria-hidden={!expanded}
                            {...{ inert: expanded ? undefined : '' }}>
                            <div className="project-body-inner">
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
                        </div>
                    </div>;
                })}

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
