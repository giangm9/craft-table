/** Joins class names, skipping the empty ones: cn("a", done && "b"). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
