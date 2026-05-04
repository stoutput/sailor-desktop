import React from 'react';
import { NavLink } from "react-router-dom";
import { FiCompass, FiGrid, FiTerminal, FiActivity, FiSettings } from 'react-icons/fi';
import { IconContext } from "react-icons";
import Statusbox from './statusbox';

import "./sidebar.scss";

const Sidebar = () => {
    // TODO: loop through data array, construct menu, assign active to first
    return (
        <nav id="sidebar">
            <IconContext.Provider value={{ size: '1.6em' }}>
                <ul>
                    <li>
                        <NavLink to="/dashboard" className={(nav) => nav.isActive ? "active" : "" }>
                            <FiCompass strokeWidth='1.2px'/>
                            <span className="nav-text">
                                Dashboard
                            </span>
                        </NavLink>
                    </li>
                    <li>
                        <NavLink to="/topology" className={(nav) => nav.isActive ? "active" : "" }>
                            <FiGrid strokeWidth='1.2px'/>
                            <span className="nav-text">
                                Topology
                            </span>
                        </NavLink>
                    </li>
                    <li>
                        <NavLink to="/cli" className={(nav) => nav.isActive ? "active" : "" }>
                            <FiTerminal strokeWidth='1.2px'/>
                            <span className="nav-text">
                                Terminal
                            </span>
                        </NavLink>
                    </li>
                    <li>
                        <NavLink to="/activity" className={(nav) => nav.isActive ? "active" : "" }>
                            <FiActivity strokeWidth='1.2px'/>
                            <span className="nav-text">
                                Monitoring
                            </span>
                        </NavLink>
                    </li>
                    <li>
                        <NavLink to="/settings" className={(nav) => nav.isActive ? "active" : "" }>
                            <FiSettings strokeWidth='1.2px'/>
                            <span className="nav-text">
                                Settings
                            </span>
                        </NavLink>
                    </li>
                </ul>
            </IconContext.Provider>
            <Statusbox />
        </nav>
    );
}

export default Sidebar
