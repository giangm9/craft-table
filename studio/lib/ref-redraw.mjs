// Redraw a mark: clicking "Redraw" on a mark → the next mark drawn on the board REPLACES that mark (keeping
// its number) instead of adding a new one. A mark still being composed is replaced right in the list; a mark already
// sent → sent to the server (editRef).

/**
 * @param pending marks being composed
 * @param target null | { kind: "pending", i } | { kind: "sent", messageId, index, n }
 * @param ref the region just drawn
 * @returns {{ pending, sent: null | { messageId, index, ref } }}
 */
export function placeDrawn(pending, target, ref) {
  if (target?.kind === "sent") return { pending, sent: { messageId: target.messageId, index: target.index, ref } };
  if (target?.kind === "pending" && target.i < pending.length) return { pending: pending.map((x, i) => (i === target.i ? ref : x)), sent: null };
  return { pending: [...pending, ref], sent: null };
}

/** Drop composed mark i while a redraw is pending: that very mark → cancel the redraw; a mark after it → moves back one place. */
export function afterRemovePending(target, i) {
  if (target?.kind !== "pending") return target;
  if (target.i === i) return null;
  return target.i > i ? { kind: "pending", i: target.i - 1 } : target;
}
