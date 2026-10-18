"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy, EllipsisVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageActionsProps {
  /** Copied to the clipboard as plain text; Copy is left out when it is empty. */
  text: string;
  onDelete: () => void;
  /** "primary" sits the trigger on your own (filled) bubble; "surface" on Keystone's card. */
  variant?: "primary" | "surface";
  /** Positions the trigger within its message; the caller pins it to a corner. */
  className?: string;
}

/** Long enough to read "Copied" before the menu closes. */
const COPIED_LABEL_MS = 900;
/** The panel's height plus its gap from the trigger, rounded up. */
const PANEL_ROOM_PX = 104;

const TRIGGER_VARIANT: Record<"primary" | "surface", string> = {
  primary: "text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground",
  surface: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
};

const ITEM = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-foreground/5";

/** The bottom edge of the nearest ancestor that clips its content (the thread), or of the window. */
function visibleBottomEdge(element: HTMLElement): number {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) return node.getBoundingClientRect().bottom;
  }
  return window.innerHeight;
}

/** Whether the panel fits below the trigger, e.g. not on the newest message just above the composer. */
function hasRoomBelow(element: HTMLElement | null): boolean {
  if (!element) return true;
  return visibleBottomEdge(element) - element.getBoundingClientRect().bottom >= PANEL_ROOM_PX;
}

/**
 * Intake's "more" menu on a chat message: a trigger that shows on hover (always, faintly,
 * on touch screens) and opens Copy and Delete. It closes on an outside click or Escape.
 * The panel is only mounted while open, so a closed menu adds no space under the newest message.
 */
export function MessageActions({ text, onDelete, variant = "surface", className }: MessageActionsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [opensUpward, setOpensUpward] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const toggle = () => {
    if (!open) {
      clearTimeout(copiedTimer.current);
      setCopied(false);
      setOpensUpward(!hasRoomBelow(root.current));
    }
    setOpen((value) => !value);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The browser can block the clipboard; there is nothing more to offer here.
      close();
      return;
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      close();
      setCopied(false);
    }, COPIED_LABEL_MS);
  };

  /** Keystone's card selects its answer on click: clicks in here must not. */
  const keepClickInMenu = (event: MouseEvent) => event.stopPropagation();

  return (
    <div ref={root} className={cn("absolute", className)} onClick={keepClickInMenu}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Message actions"
        className={cn(
          "flex size-7 items-center justify-center rounded-full transition-opacity duration-150",
          TRIGGER_VARIANT[variant],
          open ? "opacity-100" : "opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
        )}
      >
        <EllipsisVertical className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Message actions"
          className={cn(
            "absolute right-0 z-30 w-32 rounded-xl border border-foreground/10 bg-popover p-1 text-popover-foreground shadow-overlay transition-[opacity,scale] duration-150 ease-out starting:scale-95 starting:opacity-0",
            opensUpward ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top",
          )}
        >
          {text.trim() && (
            <button type="button" role="menuitem" onClick={copy} className={ITEM}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onDelete();
            }}
            className={cn(ITEM, "text-destructive hover:bg-destructive/10")}
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
