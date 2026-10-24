/** Join class names, skipping empty ones: cn("px-4", active && "bg-accent-600"). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
