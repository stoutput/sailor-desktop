import { useEffect, useState } from 'react';
import { ipcRenderer } from 'electron';
import * as Icon from 'react-feather';

import "./styles.scss";

const Sidebar = () => {
    const [statusContent, setStatusContent] = useState('');

    // useEffect(() => {
    //     ipcRenderer.on('status-updates', (event, content) => {
    //         setStatusContent(content);
    //     })
    //     return () => {
    //         ipcRenderer.removeAllListeners('');
    //     };
    // }, [statusContent]);

    // TODO: loop through data array, construct menu, assign active to first
    return (
        <nav id="sidebar">
            <ul>
                <li id="dashboard" className="active">
                    <a href="#">
                        <Icon.Compass strokeWidth='1.2px'/>
                        <span className="nav-text">
                            Dashboard
                        </span>
                    </a>
                </li>
                <li>
                    <a href="#">
                        <Icon.Settings strokeWidth='1.2px'/>
                        <span className="nav-text">
                            Settings
                        </span>
                    </a>
                </li>
            </ul>

            <div className="footer status-loading">
                <div className="icon"></div>
                <div id="status-content">
                    {statusContent}
                </div>
            </div>
        </nav>
    );
}

export default Sidebar
