import React from 'react';
import { useEffect, useState, useRef } from 'react';
import Dockerode from 'dockerode';

import "./dashboard.scss";

const statusScrollback = 50

const Dashboard = () => {
    const [containers, setContainers] = useState(new Object())

    // const updateContainer = (container: Dockerode.Container) => {
    //     if(typeof containers[container.id] === 'undefined') {
    //         // does not exist
    //         containers[container.id] = container
    //     }
    // }
      
    // useEffect(() => {
    //     const removeListener = window.api.onContainerChange((_event: Event, status: string, container: Dockerode.Container) => {
    //         updateContainer(container)
    //     })
    //     return () => {
    //         if(removeListener) removeListener();
    //     }
    // }, []);

    return (
        <div id='page-content'>
            {Object.entries(containers).map(([id, container]) => (
                <div className='container-info'>
                    <div className='container-name'>{container.name}</div>
                    <div className='container-image'>{container.image}</div>
                    <div className='container-status'>{container.status}</div>
                </div>
            ))}
        </div>
    );
}

export default Dashboard