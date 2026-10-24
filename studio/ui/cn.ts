// Joins class names: drops falsy parts, joins the rest with a space. Used almost everywhere.
export function cn(...parts: (string | undefined | false | null)[]): string {
  return parts.filter(Boolean).join(" ");
}
