import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import Header from "@components/header";
import Sidebar from "@components/sidebar";
import ColimaStatsFooter from "@components/colimastats";

import Dashboard from "@pages/dashboard";
import Topology from "@pages/topology";
import ContainerDetails from "@pages/container";
import Monitoring from "@pages/monitoring";
import Settings from "@pages/settings";
import About from "@pages/about";

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
          <Route path="topology/*" element={<Topology/>}/>
          <Route path="container/:id" element={<ContainerDetails/>}/>
          <Route path="activity/*" element={<Monitoring/>}/>
          <Route path="settings/*" element={<Settings/>}/>
          <Route path="about/*" element={<About/>}/>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ColimaStatsFooter/>
      </div>
    </HashRouter>
  );
}

const container = document.getElementById('sailor-desktop')!;
const root = createRoot(container);
root.render(<App />);