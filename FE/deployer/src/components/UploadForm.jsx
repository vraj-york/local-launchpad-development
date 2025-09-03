import React, { useState } from "react";

function UploadForm({ onDeployed }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) return alert("Please choose a zip file!");

    const formData = new FormData();
    formData.append("project", file);

    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        onDeployed(data.url);
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    }
    setLoading(false);
  };

  return (
    <div style={{ marginBottom: "20px" }}>
      <input
        type="file"
        accept=".zip"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <button onClick={handleUpload} disabled={loading}>
        {loading ? "Building..." : "Upload & Deploy"}
      </button>
    </div>
  );
}

export default UploadForm;
