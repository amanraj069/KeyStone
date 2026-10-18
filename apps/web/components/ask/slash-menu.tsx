"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** The listbox id the composer points at (aria-controls). */
export const SLASH_MENU_ID = "ask-slash-menu";

export interface SlashMenuItem {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  detail: string | null;
}

interface SlashMenuProps {
  title: string;
  items: SlashMenuItem[];
  highlighted: number;
  /** Shown instead of rows: still loading, nothing matches, or the directory failed. */
  emptyText: string;
  onPick: (index: number) => void;
  onHighlight: (index: number) => void;
}

/** The list that opens above the composer while a slash command is typed. */
export function SlashMenu({ title, items, highlighted, emptyText, onPick, onHighlight }: SlashMenuProps) {
  const list = useRef<HTMLUListElement>(null);

  // Keep the highlighted row in view while the arrow keys move it.
  useEffect(() => {
    list.current?.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-overlay">
      <p className="border-b px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul ref={list} id={SLASH_MENU_ID} role="listbox" aria-label={title} className="max-h-[min(18rem,40dvh)] overflow-y-auto p-1.5">
          {items.map((item, index) => (
            <li
              key={item.key}
              role="option"
              aria-selected={index === highlighted}
              // mousedown, not click: the textarea must keep focus.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(index);
              }}
              onMouseMove={() => index !== highlighted && onHighlight(index)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm",
                index === highlighted ? "bg-foreground/[0.07]" : "",
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-[11px] font-semibold text-muted-foreground">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              {item.detail && <span className="max-w-[45%] truncate text-xs text-muted-foreground">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="hidden gap-3 border-t px-4 py-1.5 text-[11px] text-faint sm:flex">
        <span>
          <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
        </span>
        <span>
          <kbd className="kbd">Enter</kbd> to pick
        </span>
        <span>
          <kbd className="kbd">Esc</kbd> to close
        </span>
      </p>
    </div>
  );
}
