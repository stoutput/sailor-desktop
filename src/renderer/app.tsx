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
import Composition from "@pages/composition";
import Terminal from "@pages/terminal";
import Monitoring from "@pages/monitoring";
import Settings from "@pages/settings";
import About from "@pages/about";

import "./app.scss";

type AppState = 'loading' | 'setup' | 'starting' | 'awaiting-containers' | 'ready';

const App = () => {
  const [appState, setAppState] = useState<AppState>('loading');

  useEffect(() => {
    // Listen for setup-required event from main process
    const cleanupSetup = window.api.onSetupRequired(() => {
      setAppState('setup');
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

    // Check if setup is required
    window.api.isSetupRequired().then(async (required) => {
      if (required) {
        setAppState('setup');
      } else {
        // Check if containers are already ready
        let containersReady = await window.api.getContainersReady();
        if (containersReady) {
          setAppState('ready');
        } else {
          // Check if Colima is already running
          const isRunning = await window.api.isColimaRunning();
          if (isRunning) {
            // Colima running - check containers again (might have loaded during async calls)
            containersReady = await window.api.getContainersReady();
            setAppState(containersReady ? 'ready' : 'awaiting-containers');
          } else {
            setAppState('starting');
          }
        }
      }
    });

    return () => {
      cleanupSetup();
      cleanupStatus();
      cleanupReady();
    };
  }, []);

  const handleSetupComplete = () => {
    // After setup, go to starting state until runtimes are ready
    setAppState('starting');
  };

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

    // Show setup wizard if dependencies need to be resolved
    case 'setup':
      return <SetupWizard onComplete={handleSetupComplete} />;

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

const container = document.getElementById('sailor-desktop')!;
const root = createRoot(container);
root.render(<App />);