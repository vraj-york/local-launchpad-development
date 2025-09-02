import { useState } from "react";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    console.log(message); 
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);

    const formData = new FormData();
    formData.append("project", file);

    try {
      const res = await fetch("http://localhost:4000/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error("❌ Build failed logs:", data.logs);
        alert("Build failed. Check console for details.");
      } else {
        console.log("✅ Build success logs:", data.logs);
        setPreviewUrl(`http://localhost:4000${data.previewUrl}`);
      }
    } catch (err) {
      console.error("❌ Upload error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-gray-100">
      <input
        type="file"
        accept=".zip"
        onChange={(e) => {
          const selectedFile = e.target.files?.[0] || null;
          setFile(selectedFile);
          if (selectedFile) {
            addLog(`📂 File chosen: ${selectedFile.name}`);
          } else {
            addLog("⚠️ No file selected");
          }
        }}
        className="border p-2 rounded"
      />

      <button
        onClick={handleUpload}
        disabled={!file || loading}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {loading ? "Building..." : "Upload & Preview"}
      </button>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="mt-6 w-full max-w-2xl bg-black text-green-400 font-mono text-sm p-4 rounded h-48 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}

      {/* Preview iframe */}
      {previewUrl && (
        <div className="mt-6 w-full h-[600px] border rounded overflow-hidden">
          <iframe src={previewUrl} className="w-full h-full" title="Preview" />
        </div>
      )}
    </div>
  );
}
