import React from 'react';
import * as Icon from 'react-feather';

import Statusbox from "./Statusbox"
import "./styles.scss";

const statusScrollback: number = 50; // TODO: Move to config

const Sidebar = () => {
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
            <Statusbox></Statusbox>
        </nav>
    );
}

export default Sidebar
