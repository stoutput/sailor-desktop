import { useEffect, useState } from 'react';
import { ContainerData } from '@common/types';

interface UseContainersResult {
    containers: ContainerData[];
    isLoading: boolean;
    isColimaStopped: boolean;
    runningContainers: ContainerData[];
    pausedContainers: ContainerData[];
    stoppedContainers: ContainerData[];
}

export function useContainers(): UseContainersResult {
    const [containers, setContainers] = useState<ContainerData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isColimaStopped, setIsColimaStopped] = useState(false);

    useEffect(() => {
        // Check if containers are already ready
        window.api.getContainersReady().then(ready => {
            if (ready) {
                setIsLoading(false);
                window.api.getContainers().then(setContainers);
            }
        });

        // Listen for containers ready
        const removeReadyListener = window.api.onContainersReady(() => {
            setIsLoading(false);
            setIsColimaStopped(false);
        });

        // Listen for updates
        const removeListener = window.api.onContainersUpdate((_event, containers) => {
            setContainers(containers);
        });

        // Listen for status updates to detect when colima stops
        const removeStatusListener = window.api.onUpdateStatus((_event, status: string) => {
            const lowerStatus = status.toLowerCase();
            if (lowerStatus === 'stopped') {
                setIsColimaStopped(true);
                setContainers([]);
            } else if (lowerStatus.includes('booting') || lowerStatus.includes('starting')) {
                setIsColimaStopped(false);
                setIsLoading(true);
            }
        });

        return () => {
            if (removeReadyListener) removeReadyListener();
            if (removeListener) removeListener();
            if (removeStatusListener) removeStatusListener();
        };
    }, []);

    const runningContainers = containers.filter(c => c.status === 'running');
    const pausedContainers = containers.filter(c => c.status === 'paused');
    const stoppedContainers = containers.filter(c => c.status === 'exited');

    return {
        containers,
        isLoading,
        isColimaStopped,
        runningContainers,
        pausedContainers,
        stoppedContainers,
    };
}
