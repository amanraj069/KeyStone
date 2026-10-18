import { Activity, ChartColumn, GitFork, type LucideIcon, Milestone, MessagesSquare, ScrollText, Terminal } from "lucide-react";

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
const PRODUCT_GROUPS: readonly NavGroup[] = [
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

/**
 * The ops console (service health, full/replay ingest with a destructive full reset):
 * local development only. A production build (e.g. the deployed demo) never links to
 * it, so a visitor on the live link cannot find or trigger it from the nav; the /ingest
 * page itself also 404s in production (see app/ingest/page.tsx).
 */
const DEVELOPER_GROUP: NavGroup = {
  label: "Developer",
  items: [{ href: "/ingest", label: "Console", icon: Terminal }],
};

export const NAV_GROUPS: readonly NavGroup[] = process.env.NODE_ENV === "production" ? PRODUCT_GROUPS : [...PRODUCT_GROUPS, DEVELOPER_GROUP];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** "/" matches only itself; other items also match their sub-pages. */
export const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** The page's name for the breadcrumb. */
export const pageName = (pathname: string) =>
  NAV_ITEMS.find((item) => isActive(item.href, pathname))?.label ?? "Keystone";
