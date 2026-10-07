import React from 'react';
import { NavLink } from "react-router-dom";
import {FiInfo} from 'react-icons/fi';
import { IconContext } from "react-icons";

import "./header.scss";

const sailorLogo = require("@assets/sailor-logo.svg");

const Header = () => {
  return (
    <div id="header">
        <img id="logo" src={sailorLogo} alt="Sailor" draggable={false} />
        <IconContext.Provider value={{ size: '1.4em' }}>
          <NavLink to="/about" className={(nav) => nav.isActive ? "active" : "" }>
              <FiInfo strokeWidth='1.2px'/>
          </NavLink>
        </IconContext.Provider>
    </div>
  );
}

export default Header
