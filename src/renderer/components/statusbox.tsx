import React from 'react';
import { useEffect, useState, useRef } from 'react';

import "./statusbox.scss";

const statusScrollback: number = 50; // TODO: Move to config

const Statusbox = () => {
    const curStatus = useRef('')
    const statusClass = useRef('status-loading')
    const statusQueue = useRef(new Array())
    const [status, setStatus] = useState(curStatus.current)

    const updateStatus = (status: string) => {
        if (curStatus.current) {
            if (statusQueue.current.length > statusScrollback) {
                statusQueue.current.pop()
            }
            statusQueue.current.push(curStatus.current)
        }
        curStatus.current = status;
        switch(status.toLowerCase()) {
            case 'ready':
                statusClass.current = 'status-ready';
                break;
            case 'error':
                statusClass.current = 'status-error';
                break;
            default:
                statusClass.current ='status-loading'
        }
        setStatus(status)
    }
      
    // useEffect(() => {
    //     const removeListener = window.api.onUpdateStatus((_event: Event, status: string) => {
    //         updateStatus(status)
    //     })
    //     return () => {
    //         if(removeListener) removeListener();
    //     }
    // }, []);

    return (
        <div className={"footer " + statusClass.current}>
            <div id="log">
                {statusQueue.current.map((object, i) => [object, <br/>])}
            </div>
            <div className="icon"></div>
            <div id="cur-status">{curStatus.current}</div>
        </div>
    );
}

export default Statusbox
