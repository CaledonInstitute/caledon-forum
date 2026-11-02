import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";

export default function MessageMenu({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    if (!disabled) pending.current = false;
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "Tab") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  return (
    <div className="dm-actions" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="icon-button dm-menu-trigger"
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={18} />
      </button>
      {open && (
        <div className="dm-action-menu" role="menu" aria-label="Message actions">
          <button
            ref={item}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              if (pending.current) return;
              pending.current = true;
              setOpen(false);
              trigger.current?.focus();
              onDelete();
              pending.current = false;
            }}
          >
            Delete message
          </button>
        </div>
      )}
    </div>
  );
}
