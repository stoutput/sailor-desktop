import React from 'react';
import { render } from 'react-dom';
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";

import "./index.scss";
import "./api.d.ts"

const App = () => {
  return (
    <>
      <Header/>
      <Sidebar/>
    </>
  );
}

render(<App />, document.getElementById('sailor-desktop'));