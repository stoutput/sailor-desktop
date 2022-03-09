import React from 'react';
import { NavLink } from "react-router-dom";
import * as Icon from 'react-feather';

import Statusbox from "./Statusbox"
import "./styles.scss";

const statusScrollback: number = 50; // TODO: Move to config

const Sidebar = () => {
    // TODO: loop through data array, construct menu, assign active to first
    return (
        <nav id="sidebar">
            <ul>
                <li>
                    <NavLink to="/dashboard" className={(nav) => nav.isActive ? "active" : "" }>
                        <Icon.Compass strokeWidth='1.2px'/>
                        <span className="nav-text">
                            Dashboard
                        </span>
                    </NavLink>
                </li>
                <li>
                    <NavLink to="/settings" className={(nav) => nav.isActive ? "active" : "" }>
                        <Icon.Settings strokeWidth='1.2px'/>
                        <span className="nav-text">
                            Settings
                        </span>
                    </NavLink>
                </li>
            </ul>
            <Statusbox/>
        </nav>
    );
}

export default Sidebar
