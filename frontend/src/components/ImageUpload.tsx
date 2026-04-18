import { useCallback, useEffect, useRef, useState } from "react";
import { deleteUpload, fetchUploads, uploadImage, uploadImageUrl } from "../api";
import type { Upload, UploadKind } from "../types";

interface Props {
  kind: UploadKind;
  date: string;
  label: string;
  hint?: string;
}

export function ImageUpload({ kind, date, label, hint }: Props) {
  const [items, setItems] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await fetchUploads(kind, date));
    } catch {
      setItems([]);
    }
  }, [kind, date]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) {
          setError(`${f.name} is not an image`);
          continue;
        }
        if (f.size > 5 * 1024 * 1024) {
          setError(`${f.name} exceeds 5 MB`);
          continue;
        }
        await uploadImage(kind, date, f);
      }
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete(id: number) {
    await deleteUpload(id);
    await reload();
  }

  return (
    <div className="image-upload">
      <div className="image-upload-header">
        <span className="stat-label">{label}</span>
      </div>
      <label className="image-upload-button">
        Take photo
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => onFiles(e.target.files)}
          className="visually-hidden"
        />
      </label>
      {hint && <p className="journal-hint">{hint}</p>}
      {uploading && <p className="journal-hint">Uploading…</p>}
      {error && <p className="journal-err">{error}</p>}
      {items.length === 0 ? (
        <p className="journal-hint">No {kind === "meal" ? "meal" : "form"} photos yet.</p>
      ) : (
        <ul className="image-upload-list">
          {items.map((u) => (
            <li key={u.id}>
              <img src={uploadImageUrl(u.id)} alt="" loading="lazy" />
              <button
                type="button"
                className="supplement-delete"
                aria-label="Delete image"
                onClick={() => onDelete(u.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
