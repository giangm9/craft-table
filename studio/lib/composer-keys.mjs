// The Enter key in the message composer. Normal box: Enter sends, Shift/Alt+Enter makes a new line. Large composer
// (multi-paragraph text): Enter makes a new line, Ctrl/⌘+Enter sends. While an input method is composing (typing
// Vietnamese diacritics) Enter never sends.
/** → "send" or null (let the browser make a new line as usual). */
export function enterAction(e, expanded) {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return null;
  if (e.ctrlKey || e.metaKey) return "send";
  if (expanded || e.shiftKey || e.altKey) return null;
  return "send";
}
