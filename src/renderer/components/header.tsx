import React from 'react';
import { NavLink } from "react-router-dom";
import {FiInfo} from 'react-icons/fi';
import { IconContext } from "react-icons";

import "./header.scss";

const Header = () => {
  return (
    <div id="header">
        <span id="logo">SAILOR</span>
        <IconContext.Provider value={{ size: '1.4em' }}>
          <NavLink to="/about" className={(nav) => nav.isActive ? "active" : "" }>
              <FiInfo strokeWidth='1.2px'/>
          </NavLink>
        </IconContext.Provider>
    </div>
  );
}

export default Header