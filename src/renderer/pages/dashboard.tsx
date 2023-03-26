import React, { useEffect, useState } from 'react';
import Dockerode from 'dockerode';

import './dashboard.scss';

const Dashboard = () => {
  const [containers, setContainers] = useState<Dockerode.ContainerInspectInfo[]>([]);

  useEffect(() => {
    const docker = new Dockerode();
    docker.listContainers({ all: true }, (err, containers) => {
      if (err) {
        console.log(err);
      } else {
        Promise.all(
          containers.map((container) => docker.getContainer(container.Id).inspect())
        ).then((containerInfos) => setContainers(containerInfos));
      }
    });
  }, []);

  return (
    <div id="page-content">
      {containers.map((container) => (
        <div className="container-info" key={container.Id}>
          <div className="container-name">{container.Name}</div>
          <div className="container-image">{container.Config?.Image}</div>
          <div className="container-status">{container.State?.Status}</div>
        </div>
      ))}
    </div>
  );
};

export default Dashboard;
// import React from 'react';
// import { useEffect, useState, useRef } from 'react';
// import Dockerode from 'dockerode';

// import "./dashboard.scss";

// const statusScrollback = 50

// type ContainerId = string

// interface Containers {
//     [index: ContainerId]: Dockerode.Container
// }

// const Dashboard = () => {
//     const [containers, setContainers] = useState<Containers>({})

//     const updateContainer = (container: Dockerode.Container) => {
//         if(typeof containers[container.id] === 'undefined') {
//             // does not exist
//             containers[container.id] = container
//         }
//     }
      
//     useEffect(() => {
//         const removeListener = window.api.onContainerChange((_event: Event, status: string, container: Dockerode.Container) => {
//             updateContainer(container)
//         })
//         return () => {
//             if(removeListener) removeListener();
//         }
//     }, []);

//     return (
//         <div id='page-content'>
//             {
//                 Object.entries(containers).map(([id, container]) => 
//                     container.inspect(function(err, info) => (
//                         <div className='container-info'>
//                             <div className='container-name'>{info.Name}</div>
//                             <div className='container-image'>{container.image}</div>
//                             <div className='container-status'>{container.status}</div>
//                         </div>
//                     )
//                 )
//             }
//         </div>
//     );
// }

// export default Dashboard