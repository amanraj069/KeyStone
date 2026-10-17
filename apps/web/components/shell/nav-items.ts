import { Activity, ChartColumn, GitFork, type LucideIcon, Milestone, MessagesSquare, ScrollText } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

/** The rooms, grouped by what you do there, in the order they read in the sidebar. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Insights",
    items: [
      { href: "/", label: "Org Pulse", icon: Activity },
      { href: "/decisions", label: "Decisions", icon: Milestone },
    ],
  },
  {
    label: "Agent",
    items: [
      { href: "/ask", label: "Ask", icon: MessagesSquare },
      { href: "/whatif", label: "What-if", icon: GitFork },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/audit", label: "Audit", icon: ScrollText },
      { href: "/bench", label: "Benchmark", icon: ChartColumn },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Pages reachable from elsewhere (the top bar), named in the breadcrumb. */
export const OTHER_PAGES: Record<string, string> = { "/ingest": "Developer console" };

/** "/" matches only itself; other items also match their sub-pages. */
export const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** The page's name for the breadcrumb. */
export const pageName = (pathname: string) =>
  NAV_ITEMS.find((item) => isActive(item.href, pathname))?.label ?? OTHER_PAGES[pathname] ?? "Keystone";
