// The app around every screen: a top bar with the name, the two sections and the person signed in. Links keep the
// app's real addresses in href but do not navigate (a board is one screen).
import type { MouseEvent, ReactNode } from "react";
import { ListChecks, Settings } from "lucide-react";
import { cn } from "@ds";
import { Avatar } from "./Avatar";
import { ME } from "./fixtures";

export const noNav = (e: MouseEvent) => e.preventDefault();

function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={noNav}
      aria-current={active ? "page" : undefined}
      className={cn("inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium", active ? "bg-accent-50 text-accent-600" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900")}
    >
      <span className="hidden sm:inline-flex">{icon}</span>
      {children}
    </a>
  );
}

export function Shell({ active, children }: { active: "tasks" | "settings"; children: ReactNode }) {
  return (
    <div className="bg-ink-50 text-ink-900">
      <header className="bg-surface border-b border-ink-200">
        <div className="max-w-3xl mx-auto h-14 px-4 flex items-center gap-3">
          <a href="/tasks" onClick={noNav} className="flex items-center gap-2 font-semibold text-ink-900 whitespace-nowrap">
            <span className="w-7 h-7 rounded-lg bg-accent-700 text-white inline-flex items-center justify-center"><ListChecks size={16} /></span>
            Acme Tasks
          </a>
          <nav className="ml-auto flex items-center gap-1">
            <NavLink href="/tasks" active={active === "tasks"} icon={<ListChecks size={16} />}>Tasks</NavLink>
            <NavLink href="/settings" active={active === "settings"} icon={<Settings size={16} />}>Settings</NavLink>
          </nav>
          <Avatar person={ME} />
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
