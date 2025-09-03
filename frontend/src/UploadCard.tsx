import type { UploaderUIProps } from "./UploaderCore";

export const UploadCard = ({ file, loading, previewUrl, onFileChange, onUpload }: UploaderUIProps) => {
  return (
    <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-4">
      <section className="w-full max-w-xl border border-gray-200 rounded-lg p-6 space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-balance">Upload project</h1>
          <p className="text-sm text-gray-600">Upload a .zip to build and preview.</p>
        </header>

        <div className="grid gap-3">
          <label className="text-sm font-medium" htmlFor="file">
            Project file (.zip)
          </label>
          <input
            id="file"
            type="file"
            accept=".zip"
            onChange={onFileChange}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          {file && (
            <p className="text-xs text-gray-600">
              Selected: <span className="font-medium">{file.name}</span>
            </p>
          )}
        </div>

        <button
          onClick={onUpload}
          disabled={!file || loading}
          className="w-full rounded bg-blue-600 text-white px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Building..." : "Upload & Preview"}
        </button>

        {previewUrl && (
          <div className="grid gap-2">
            <h2 className="text-sm font-medium">Preview</h2>
            <div className="h-96 border rounded overflow-hidden">
              <iframe src={previewUrl} className="w-full h-full" title="Preview" />
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
