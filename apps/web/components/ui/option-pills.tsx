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
}

/**
 * A segmented control with a sliding ink indicator under the chosen option
 * (Intake's OptionPills). Used for every "one of a few" choice: graph, tabs, filters.
 */
export function OptionPills<T extends string>({ label, options, value, onChange, size = "sm", className }: OptionPillsProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const update = () => {
      const index = options.findIndex((o) => o.value === value);
      const button = container.current?.querySelectorAll("button")[index];
      if (button) setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
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
      className={cn(
        "relative inline-flex items-center overflow-hidden rounded-xl border bg-card p-1 shadow-2xs dark:shadow-none",
        size === "sm" ? "h-9" : "h-11",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 rounded-lg bg-primary shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: indicator.left, width: indicator.width, opacity: indicator.width > 0 ? 1 : 0 }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 flex h-full items-center rounded-lg font-semibold whitespace-nowrap transition-colors duration-200 select-none",
              size === "sm" ? "px-3.5 text-xs" : "px-5 text-sm",
              selected ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
