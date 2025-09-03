import React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export type UploaderUIProps = {
  file: File | null;
  loading: boolean;
  previewUrl: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
};

export type UploaderTemplate = (props: UploaderUIProps) => React.ReactNode;

export function UploaderCore({ template }: { template: UploaderTemplate }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append("project", file);

    setLoading(true);
    const res = await fetch("http://localhost:4000/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    console.log(data);
    if (data.success) {
      navigate(`/project/${data.projectId}`);
      setPreviewUrl(`/project/${data.projectId}`);
    } else {
      console.error("Upload failed");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
  };

  return (
    <>
      {template({
        file,
        loading,
        previewUrl,
        onFileChange,
        onUpload: handleUpload,
      })}
    </>
  );
}
