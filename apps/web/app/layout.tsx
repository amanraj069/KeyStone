// globals.css must load before any component CSS: the theme toggle ships its own
// Tailwind build, and whichever file declares the cascade layers first fixes their order.
import "./globals.css";
import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveGraphProvider } from "@/contexts/live-graph";
import { ThemeProvider } from "@/contexts/theme-context";

// One family for everything (Inter, as in Intake), and a monospace for ids only.
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Keystone · Apex Athletics",
  description: "Company Brain agent built on FalkorDB.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${code.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved (or system) theme before first paint, so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var d=document.documentElement;if(s==='dark'||(!s&&window.matchMedia('(prefers-color-scheme: dark)').matches)){d.classList.add('dark');d.style.colorScheme='dark';}else{d.classList.remove('dark');d.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider>
            <LiveGraphProvider>
              <AppShell>{children}</AppShell>
            </LiveGraphProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
