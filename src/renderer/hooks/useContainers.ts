import { useEffect, useState } from 'react';
import { ContainerData } from '@common/types';

interface UseContainersResult {
    containers: ContainerData[];
    isLoading: boolean;
    isColimaStopped: boolean;
    unavailableMessage: string | null;
    runningContainers: ContainerData[];
    pausedContainers: ContainerData[];
    stoppedContainers: ContainerData[];
}

export function useContainers(): UseContainersResult {
    const [containers, setContainers] = useState<ContainerData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        let revision = 0;
        const applyStatus = (status: string) => {
            const unavailable = status === 'Stopped' || status.toLowerCase().includes('error');
            setUnavailableMessage(unavailable ? (status === 'Stopped' ? 'Colima runtime stopped' : status) : null);
            if (status !== 'Ready') setContainers([]);
            setIsLoading(!unavailable && status !== 'Ready');
        };
        const removeStatusListener = window.api.onUpdateStatus((_event, status) => {
            revision++;
            applyStatus(status);
        });
        const removeListener = window.api.onContainersUpdate((_event, containers) => {
            revision++;
            setContainers(containers);
            setIsLoading(false);
        });
        const initialRevision = revision;
        Promise.all([window.api.getCurrentStatus(), window.api.getContainers()]).then(([status, containers]) => {
            if (disposed || revision !== initialRevision) return;
            if (status) applyStatus(status);
            if (status === 'Ready') setContainers(containers);
        }).catch(err => {
            console.error('Failed to load containers:', err);
            if (!disposed && revision === initialRevision) {
                setUnavailableMessage('Error: Could not load containers');
                setIsLoading(false);
            }
        });

        return () => {
            disposed = true;
            removeListener();
            removeStatusListener();
        };
    }, []);

    const runningContainers = containers.filter(c => c.status === 'running');
    const pausedContainers = containers.filter(c => c.status === 'paused');
    const stoppedContainers = containers.filter(c => c.status === 'exited');

    return {
        containers,
        isLoading,
        isColimaStopped: unavailableMessage !== null,
        unavailableMessage,
        runningContainers,
        pausedContainers,
        stoppedContainers,
    };
}
