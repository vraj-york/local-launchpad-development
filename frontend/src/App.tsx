import { UploaderCore } from "./UploaderCore"
import { UploadCard } from "./UploadCard";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <UploaderCore template={UploadCard} />
    </div>
  )
}
