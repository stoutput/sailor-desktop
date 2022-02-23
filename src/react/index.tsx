import ReactDOM from 'react-dom';
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";

import "./index.scss";

declare global {
  interface Window {
      api? : any
  }
}

const App = () => {
  return (
    <>
      <Header/>
      <Sidebar/>
    </>
  );
}

ReactDOM.render(<App />, document.getElementById('sailor-desktop'));