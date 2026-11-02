import { useState } from "react";
import FileUpload from "./FileUpload";
import { fileUrl, type Attachment } from "../lib/upload-policy";
export default function ProfileImageField({
  name,
  initial,
  username,
  onBusy,
  disabled,
}: {
  name: "image" | "coverImage";
  initial?: string | null;
  username?: string | null;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState(initial || ""),
    [files, setFiles] = useState<Attachment[]>([]);
  const label = name === "image" ? "Profile photo" : "Cover photo";
  return (
    <div className="profile-upload-field">
      <h3>{label}</h3>
      <input type="hidden" name={name} value={url} />
      {url && (
        <img
          className={name === "image" ? "profile-upload-avatar" : "profile-upload-cover"}
          src={files[0] ? fileUrl(files[0].id) : `/api/${name === "image" ? "avatar" : "cover"}/${encodeURIComponent(username || "")}`}
          alt={label}
        />
      )}
      <FileUpload
        purpose={name === "image" ? "avatar" : "cover"}
        value={files}
        onBusy={onBusy}
        disabled={disabled}
        onChange={(next) => {
          setFiles(next);
          setUrl(next[0] ? new URL(fileUrl(next[0].id), location.origin).href : "");
        }}
      />
      {url && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setUrl("");
            setFiles([]);
          }}
        >
          Remove {label.toLowerCase()}
        </button>
      )}
      <details>
        <summary>Use an image URL</summary>
        <label>
          Direct HTTPS image URL
          <input
            type="url"
            value={url}
            maxLength={2048}
            placeholder="https://"
            disabled={disabled}
            onChange={(e) => {
              setUrl(e.target.value);
              setFiles([]);
            }}
          />
        </label>
        <p className="help">JPEG, PNG, GIF or WebP, up to 2 MB. The forum fetches the image for you.</p>
      </details>
    </div>
  );
}
