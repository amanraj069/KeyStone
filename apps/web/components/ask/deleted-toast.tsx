"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface DeletedToastProps {
  onUndo: () => void;
  onDismiss: () => void;
}

/** How long "Undo" is offered. */
const VISIBLE_MS = 3000;
const EXIT_TRANSITION_MS = 200;

/** Intake's undo toast: sits just above the composer, as wide as it, after a message is deleted. */
export function DeletedToast({ onUndo, onDismiss }: DeletedToastProps) {
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, EXIT_TRANSITION_MS);
  }, [onDismiss]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    const timer = setTimeout(dismiss, VISIBLE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [dismiss]);

  return (
    <div
      role="status"
      className={cn(
        "mb-2 flex items-center justify-between rounded-2xl border border-foreground/10 bg-card px-4 py-2.5 shadow-card transition-all duration-200 ease-out sm:px-5",
        entered && !exiting ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <span className="text-xs font-medium sm:text-sm">Message deleted</span>
      <button type="button" onClick={onUndo} className="text-xs font-semibold text-signal hover:underline sm:text-sm">
        Undo
      </button>
    </div>
  );
}
