import React, { useState } from "react";
import UploadForm from "./components/UploadForm.jsx";

function App() {
  const [apps, setApps] = useState([]);

  const handleNewApp = (url) => {
    setApps([...apps, url]);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>🚀 React Project Deployer</h1>
      <UploadForm onDeployed={handleNewApp} />
      <h2>Live Apps</h2>
      <ul>
        {apps.map((url, idx) => (
          <li key={idx}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
