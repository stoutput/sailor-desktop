import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import Header from "@components/header";
import Sidebar from "@components/sidebar";
import AnchorIcon from "@components/anchoricon";

import Dashboard from "@pages/dashboard";
import Topology from "@pages/topology";
import ContainerDetails from "@pages/container";
import Composition from "@pages/composition";
import Terminal from "@pages/terminal";
import Monitoring from "@pages/monitoring";
import Settings from "@pages/settings";
import About from "@pages/about";

import "./app.scss";

type AppState = 'loading' | 'starting' | 'awaiting-containers' | 'ready';

const App = () => {
  const [appState, setAppState] = useState<AppState>('loading');

  useEffect(() => {
    // Listen for Colima status updates - transition to awaiting-containers when ready
    const cleanupStatus = window.api.onUpdateStatus((_, status) => {
      if (status === 'Ready') {
        setAppState(prev => prev === 'starting' ? 'awaiting-containers' : prev);
      }
    });

    // Listen for containers-ready event
    const cleanupReady = window.api.onContainersReady(() => {
      setAppState('ready');
    });

    // Determine initial state
    (async () => {
      let containersReady = await window.api.getContainersReady();
      if (containersReady) {
        setAppState('ready');
        return;
      }
      const isRunning = await window.api.isColimaRunning();
      if (isRunning) {
        containersReady = await window.api.getContainersReady();
        setAppState(containersReady ? 'ready' : 'awaiting-containers');
      } else {
        setAppState('starting');
      }
    })();

    return () => {
      cleanupStatus();
      cleanupReady();
    };
  }, []);

  switch (appState) {
    // Default app startup - show bouncing anchor
    case 'loading':
      return (
        <div id="loading-screen">
          <AnchorIcon className="bouncing" size={64} />
        </div>
      );

    // Runtimes starting - show app layout with "Weighing anchor..." in content area
    case 'starting':
      return (
        <HashRouter>
          <Header/>
          <Sidebar/>
          <div id="content" className="centered">
            <AnchorIcon className="bouncing" size={64} />
            <p className="loading-message">Weighing anchor...</p>
          </div>
        </HashRouter>
      );

    // Full application
    default:
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
              <Route path="composition/:projectName" element={<Composition/>}/>
              <Route path="cli/*" element={<Terminal/>}/>
              <Route path="activity/*" element={<Monitoring/>}/>
              <Route path="settings/*" element={<Settings/>}/>
              <Route path="about/*" element={<About/>}/>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </HashRouter>
      );
  }
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const container = document.getElementById('sailor-desktop')!;
const root = createRoot(container);
root.render(<App />);
