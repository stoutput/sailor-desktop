import React from 'react';
import { render } from 'react-dom';
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import Header from "@components/header";
import Sidebar from "@components/sidebar";

// import Dashboard from "@pages/Dashboard";
// import Settings from "@pages/Settings";
// import About from "@pages/About";

import "./app.scss";

const App = () => {
  return (
    <HashRouter>
      <Header/>
      <Sidebar/>
      <div id="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />}/>
          {/* <Route path="dashboard/*" element={<Dashboard/>}/>
          <Route path="settings/*" element={<Settings/>}/>
          <Route path="about/*" element={<About/>}/> */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

render(<App />, document.getElementById('sailor-desktop'));