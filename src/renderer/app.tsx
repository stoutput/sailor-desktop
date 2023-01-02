import React from 'react';
import { render } from 'react-dom';
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import Header from "@components/header";
import Sidebar from "@components/sidebar";

import Dashboard from "@pages/dashboard";
import Settings from "@pages/settings";
import About from "@pages/about";
//import { createRoot } from 'react-dom/client';

import "./app.scss";

const App = () => {
  return (
    <HashRouter>
      <Header/>
      <Sidebar/>
      <div id="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />}/>
          <Route path="dashboard/*" element={<Dashboard/>}/>
          <Route path="settings/*" element={<Settings/>}/>
          <Route path="about/*" element={<About/>}/>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

render(<App />, document.getElementById('sailor-desktop'));

// Console reports we should use the below for React 18 compat
//createRoot(<App />, document.getElementById('sailor-desktop'));