import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";

interface TextInputDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initialValue: string;
  confirmLabel?: string;
  cancelLabel?: string;
  allowEmpty?: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export function TextInputDialog({
  isOpen,
  title,
  description,
  label,
  placeholder,
  initialValue,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  allowEmpty = false,
  onClose,
  onConfirm,
}: TextInputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setValue(initialValue);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const canConfirm = allowEmpty || value.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-night/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-cloud p-6 text-night shadow-2xl">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}

        {label ? (
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        ) : null}
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConfirm) {
              return;
            }
            onConfirm(value);
          }}
        >
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            className="bg-sand/60 text-night placeholder:text-muted"
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" className="text-night" onClick={onClose}>
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
