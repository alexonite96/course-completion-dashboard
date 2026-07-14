interface Props {
  onClose: () => void;
  onUploaded: (course: string) => void;
}

export default function UploadModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40" onClick={onClose}>
      <div className="rounded-lg bg-white p-6">Upload modal — built in Task 10</div>
    </div>
  );
}
