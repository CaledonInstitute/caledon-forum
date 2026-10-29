import { useEffect } from "react";
import { CircleCheck, X } from "lucide-react";

export default function PublishToast({ message, url, persistent, onClose }: { message: string; url: string; persistent?: boolean; onClose: () => void }) {
  useEffect(() => {
    if (persistent) return;
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [message, persistent, onClose]);
  return (
    <div className="publish-toast">
      <CircleCheck size={20} aria-hidden="true" />
      <div>
        <p role="status">{message}</p>
        <a href={url}>View {message.startsWith("Reply") ? "reply" : "post"}</a>
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
