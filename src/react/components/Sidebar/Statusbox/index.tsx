import React from 'react';
import { useEffect, useState, useRef } from 'react';

import "./styles.scss";

const statusScrollback: number = 50; // TODO: Move to config

const Statusbox = () => {
    const curStatus = useRef('')
    const statusQueue = useRef(new Array())
    const [, forceRerender] = useState(false)

    const updateStatus = (status: string) => {
        if (curStatus.current) {
            if (statusQueue.current.length > statusScrollback) {
                statusQueue.current.pop()
            }
            statusQueue.current.push(curStatus.current)
        }
        curStatus.current = status;
        forceRerender(true)
    }
      
    useEffect(() => {
        const removeListener = window.api.onUpdateStatus((_event: Event, status: string) => {
            updateStatus(status)
        })
        return () => {
            if(removeListener) removeListener();
        }
    }, []);

    return (
        <div className="footer status-loading">
            <div className="icon"></div>
            <div id="cur-status">{curStatus.current}</div>
        </div>
    );
}

export default Statusbox
