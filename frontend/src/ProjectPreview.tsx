import { useParams } from 'react-router-dom';

export default function ProjectPreview() {
  const { projectId } = useParams();

  if (!projectId) {
    return <p>Invalid project ID</p>;
  }

  const previewUrl = `http://localhost:4000/preview/${projectId}`;

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <h1 className="text-xl font-bold mb-4">Project Preview</h1>
      <iframe
        src={previewUrl}
        title="Project Preview"
        className="w-full h-[90vh] border"
      />
    </div>
  );
}
