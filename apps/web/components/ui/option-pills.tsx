"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface PillOption<T extends string> {
  value: T;
  label: string;
}

interface OptionPillsProps<T extends string> {
  label: string;
  options: readonly PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** Stretch to fill the width of its container, spacing options evenly instead of hugging their labels. */
  fill?: boolean;
}

/**
 * A segmented control: a recessed track with a raised thumb that glides to the chosen
 * option (Intake's OptionPills). Used for every "one of a few" choice: graph, tabs,
 * filters. A trailing number in a label ("Change 2") is set apart as a count.
 */
export function OptionPills<T extends string>({ label, options, value, onChange, size = "sm", className, fill }: OptionPillsProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, animate: false });

  useLayoutEffect(() => {
    const update = () => {
      const index = options.findIndex((o) => o.value === value);
      const button = container.current?.querySelectorAll("button")[index];
      if (button) setIndicator((current) => ({ left: button.offsetLeft, width: button.offsetWidth, animate: current.width > 0 }));
    };
    update();
    const observer = new ResizeObserver(update);
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div
      ref={container}
      role="radiogroup"
      aria-label={label}
      // On a narrow screen the track scrolls sideways (scrollbar hidden) rather than spilling out of its card.
      className={cn(
        "relative max-w-full items-center overflow-x-auto rounded-lg bg-foreground/[0.05] p-0.5 [scrollbar-width:none] dark:bg-foreground/[0.06] [&::-webkit-scrollbar]:hidden",
        fill ? "flex" : "inline-flex",
        size === "sm" ? "h-8" : "h-9",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 rounded-md bg-card shadow-raised ring-1 ring-black/[0.04] dark:bg-foreground/[0.11] dark:ring-white/[0.06]",
          indicator.animate && "transition-[left,width] duration-300 ease-out-expo",
        )}
        style={{ left: indicator.left, width: indicator.width, opacity: indicator.width > 0 ? 1 : 0 }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        const [, text, count] = /^(.*?)(?:\s+(\d+))?$/.exec(option.label) ?? [];
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 flex h-full shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-200 select-none",
              fill ? "flex-1 justify-center" : undefined,
              size === "sm" ? "px-3 text-xs" : "px-3.5 text-[13px]",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {text}
            {count !== undefined && <span className={cn("tabular-nums transition-colors", selected ? "text-muted-foreground" : "text-faint")}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
