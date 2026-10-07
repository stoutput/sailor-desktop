import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import Header from "@components/header";
import Sidebar from "@components/sidebar";
import SetupWizard from "@components/setupwizard";
import AnchorIcon from "@components/anchoricon";

import Dashboard from "@pages/dashboard";
import Topology from "@pages/topology";
import ContainerDetails from "@pages/container";
import Terminal from "@pages/terminal";
import Monitoring from "@pages/monitoring";
import Settings from "@pages/settings";
import About from "@pages/about";

import "./app.scss";

type AppState = 'loading' | 'setup' | 'starting' | 'awaiting-containers' | 'ready';

const App = () => {
  const [appState, setAppState] = useState<AppState>('loading');

  useEffect(() => {
    // Determine the runtime state once dependencies are known to be present
    const resolveRuntimeState = async () => {
      const containersReady = await window.api.getContainersReady();
      if (containersReady) {
        setAppState('ready');
        return;
      }
      // getCurrentStatus() reads a cached value — no blocking execSync
      const currentStatus = await window.api.getCurrentStatus();
      setAppState(currentStatus === 'Ready' ? 'awaiting-containers' : 'starting');
    };

    // Main process reports whether Colima/Docker need installing
    const cleanupSetup = window.api.onSetupState((_, required) => {
      if (required) {
        setAppState('setup');
      } else {
        resolveRuntimeState();
      }
    });

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

    // Determine initial state without blocking the main process
    (async () => {
      const setupRequired = await window.api.getSetupRequired();
      // null means the dependency check is still running - stay on the loading
      // screen until the setup-state event arrives
      if (setupRequired === null) return;
      if (setupRequired) {
        setAppState('setup');
        return;
      }
      await resolveRuntimeState();
    })();

    return () => {
      cleanupSetup();
      cleanupStatus();
      cleanupReady();
    };
  }, []);

  const isStarting = appState === 'starting' || appState === 'awaiting-containers';
  const startupView = (
    <div className="startup-view" role="status">
      <AnchorIcon className="bouncing" size={64} />
      <p className="loading-message">Weighing anchor...</p>
    </div>
  );

  switch (appState) {
    // Default app startup - show bouncing anchor
    case 'loading':
      return (
        <div id="loading-screen">
          <AnchorIcon className="bouncing" size={64} />
        </div>
      );

    // Dependencies missing - walk the user through installing them
    case 'setup':
      return <SetupWizard onComplete={() => setAppState('starting')} />;

    // Full application
    default:
      return (
        <HashRouter>
          <Header/>
          <Sidebar/>
          <div id="content" className={isStarting ? 'starting' : ''}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />}/>
              <Route path="dashboard/*" element={isStarting ? startupView : <Dashboard/>}/>
              <Route path="topology/*" element={isStarting ? startupView : <Topology/>}/>
              <Route path="container/:id" element={isStarting ? startupView : <ContainerDetails/>}/>
              <Route path="cli/*" element={isStarting ? startupView : <Terminal/>}/>
              <Route path="activity/*" element={isStarting ? startupView : <Monitoring/>}/>
              <Route path="settings/*" element={<Settings runtimeReady={!isStarting}/>}/>
              <Route path="about/*" element={<About/>}/>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </HashRouter>
      );
  }
}

document.documentElement.dataset.platform = window.api.platform;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const container = document.getElementById('sailor-desktop')!;
const root = createRoot(container);
root.render(<App />);
