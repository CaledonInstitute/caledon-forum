import { useLayoutEffect, useRef, type RefObject } from "react";
import { attachmentMarker, removeAttachmentMarkers } from "./attachment-markers";
import type { Attachment } from "./upload-policy";

export function useAttachmentEditor(value: string, onChange: (value: string) => void, editor: RefObject<HTMLTextAreaElement | null>) {
  const latest = useRef(value);
  latest.current = value;
  const change = useRef(onChange);
  change.current = onChange;
  const caret = useRef<{ start: number; end: number; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!caret.current || !editor.current) return;
    const next = caret.current;
    caret.current = null;
    if (next.focus) editor.current.focus();
    editor.current.setSelectionRange(next.start, next.end);
  }, [value]);
  function update(next: string) {
    const previous = latest.current;
    if (previous === next) return;
    const el = editor.current;
    if (el && !caret.current) {
      let prefix = 0,
        suffix = 0;
      while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
      while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      const adjust = (position: number) => (position <= prefix ? position : position >= previous.length - suffix ? position + next.length - previous.length : next.length - suffix);
      caret.current = { start: adjust(el.selectionStart), end: adjust(el.selectionEnd), focus: false };
    }
    latest.current = next;
    change.current(next);
  }
  function insert(markers: string[]) {
    const el = editor.current;
    const body = latest.current;
    const start = el?.selectionStart ?? body.length,
      end = el?.selectionEnd ?? start;
    const block = `${start && body[start - 1] !== "\n" ? "\n" : ""}${markers.join("\n")}\n`;
    caret.current = { start: start + block.length, end: start + block.length, focus: true };
    update(body.slice(0, start) + block + body.slice(end));
  }
  return {
    onUploadStart: (files: { key: string; file: File }[]) => insert(files.map(({ key, file }) => attachmentMarker({ id: key, name: `Uploading ${file.name}…` }))),
    onUploadComplete: (key: string, file: Attachment) => {
      // Replacement uses the latest draft; typing during a transfer is preserved.
      const next = latest.current.replace(new RegExp(`^\\[.*\\]\\(attachment:${key}\\)[ \\t]*$`, "gm"), () => attachmentMarker(file));
      update(next);
    },
    onUploadCancel: (key: string) => update(removeAttachmentMarkers(latest.current, key)),
    onInsert: (file: Attachment) => insert([attachmentMarker(file)]),
    onRemove: (file: Attachment) => update(removeAttachmentMarkers(latest.current, file.id)),
  };
}
