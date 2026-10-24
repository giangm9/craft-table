import { cn } from "@ds";
import type { Person, Tone } from "./fixtures";

const TONE: Record<Tone, string> = {
  neutral: "bg-ink-100 border-ink-200 text-ink-700",
  accent: "bg-accent-50 border-accent-200 text-accent-600",
  success: "bg-success-50 border-success-200 text-success-700",
  warning: "bg-warning-50 border-warning-200 text-warning-700",
  danger: "bg-danger-50 border-danger-200 text-danger-700",
};

/** A person's initials in a coloured circle (the boards have no photos). */
export function Avatar({ person, size = "md" }: { person: Person; size?: "sm" | "md" }) {
  return (
    <span
      title={person.name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full border font-semibold", TONE[person.tone], size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs")}
    >
      {person.initials}
    </span>
  );
}
