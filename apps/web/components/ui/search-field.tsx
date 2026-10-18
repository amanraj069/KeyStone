"use client";

import { Search, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

/** The search box above a picker: a quiet field that lights up on focus, with a clear button once typed in. */
export function SearchField({ value, onChange, placeholder, className }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      className={cn(
        "group flex h-9 items-center gap-2 rounded-lg border border-transparent bg-foreground/[0.04] px-2.5 transition-[background-color,border-color,box-shadow] duration-200 focus-within:border-ring/50 focus-within:bg-card focus-within:ring-3 focus-within:ring-ring/15",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-faint transition-colors group-focus-within:text-foreground" strokeWidth={1.9} />
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base placeholder:text-faint sm:text-sm focus:outline-none focus-visible:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          aria-label="Clear search"
          className="animate-page-in flex size-5 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}
