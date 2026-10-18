"use client";

import { type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The label beside a sidebar item while the sidebar is a rail. It renders in a portal,
 * so the rail's clipping cannot hide it, and it opens on focus as well as hover.
 * When `show` is false it never opens. The wrapper stays mounted either way, so
 * collapsing or expanding does not remount the item (which would drop its focus).
 */
export function SidebarTooltip({ label, show, children }: { label: ReactNode; show: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={show && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={14} className="font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
