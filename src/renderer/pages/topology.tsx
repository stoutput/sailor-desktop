import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContainerData } from '@common/types';

import "./topology.scss";

// Predefined colors for networks
const NETWORK_COLORS = [
    { bg: 'rgba(52, 192, 247, 0.15)', border: '#34c0f7' },   // blue
    { bg: 'rgba(76, 175, 80, 0.15)', border: '#4caf50' },    // green
    { bg: 'rgba(156, 39, 176, 0.15)', border: '#9c27b0' },   // purple
    { bg: 'rgba(255, 152, 0, 0.15)', border: '#ff9800' },    // orange
    { bg: 'rgba(233, 30, 99, 0.15)', border: '#e91e63' },    // pink
    { bg: 'rgba(0, 188, 212, 0.15)', border: '#00bcd4' },    // cyan
];

interface NetworkGroup {
    name: string;
    containers: ContainerData[];
    color: { bg: string; border: string };
}

const Topology = () => {
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

    // Group containers by network
    const networkGroups = useMemo(() => {
        const networkMap = new Map<string, ContainerData[]>();

        // Only show running containers in topology
        const runningContainers = containers.filter(c => c.status === 'running');

        runningContainers.forEach(container => {
            if (container.networks.length === 0) {
                // Container with no network (shouldn't happen often)
                const existing = networkMap.get('none') || [];
                networkMap.set('none', [...existing, container]);
            } else {
                container.networks.forEach(net => {
                    const existing = networkMap.get(net.name) || [];
                    if (!existing.find(c => c.id === container.id)) {
                        networkMap.set(net.name, [...existing, container]);
                    }
                });
            }
        });

        const groups: NetworkGroup[] = [];
        let colorIndex = 0;

        networkMap.forEach((containers, name) => {
            groups.push({
                name,
                containers,
                color: NETWORK_COLORS[colorIndex % NETWORK_COLORS.length]
            });
            colorIndex++;
        });

        // Sort by network name
        return groups.sort((a, b) => a.name.localeCompare(b.name));
    }, [containers]);

    const handleContainerClick = (id: string) => {
        navigate(`/container/${id}`);
    };

    const runningCount = containers.filter(c => c.status === 'running').length;

    return (
        <div id="page-content" className="topology">
            <div className="topology-header">
                <h2>Network Topology</h2>
                <span className="container-count">{runningCount} running container{runningCount !== 1 ? 's' : ''}</span>
            </div>

            {networkGroups.length === 0 ? (
                <div className="empty-state">
                    <p>No running containers</p>
                </div>
            ) : (
                <div className="networks">
                    {networkGroups.map((group) => (
                        <div
                            key={group.name}
                            className="network-region"
                            style={{
                                backgroundColor: group.color.bg,
                                borderColor: group.color.border
                            }}
                        >
                            <div className="network-header">
                                <span
                                    className="network-indicator"
                                    style={{ backgroundColor: group.color.border }}
                                />
                                <span className="network-name">{group.name}</span>
                                <span className="network-count">{group.containers.length}</span>
                            </div>
                            <div className="network-containers">
                                {group.containers.map((container) => (
                                    <div
                                        key={container.id}
                                        className="container-node"
                                        onClick={() => handleContainerClick(container.id)}
                                    >
                                        <div className="node-status running" />
                                        <div className="node-name">{container.name}</div>
                                        <div className="node-image">{container.image}</div>
                                        {container.networks.find(n => n.name === group.name)?.ipAddress && (
                                            <div className="node-ip">
                                                {container.networks.find(n => n.name === group.name)?.ipAddress}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Topology;
