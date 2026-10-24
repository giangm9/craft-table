// Applies text to a Y.js document (co-editing) without overwriting what someone else is typing.
//   applyText: turns a Y.Text into a new string with a diff (inserts/deletes only what differs).
//   mergeExternal: the file on disk was changed from outside (Claude, git) — that change is treated as ONE MORE
//   PERSON EDITING AT THE SAME TIME, starting from the state when the file was last written (baseUpdate): rebuild the
//   document in that state, apply the base→next diff to the rebuild, then merge it into the open document with Y.js's
//   CRDT. People typing keep their text; when both sides delete the same passage it is deleted only once.
import * as Y from "yjs";
import fastDiff from "fast-diff";

/** Turn `ytext` into `next`, inserting/deleting only what differs, in one transaction (origin optional). */
export function applyText(ytext, next, origin) {
  const cur = ytext.toString();
  if (cur === next) return;
  const ops = fastDiff(cur, next);
  const run = () => {
    let i = 0;
    for (const [kind, text] of ops) {
      if (kind === fastDiff.EQUAL) i += text.length;
      else if (kind === fastDiff.DELETE) ytext.delete(i, text.length);
      else { ytext.insert(i, text); i += text.length; }
    }
  };
  if (ytext.doc) ytext.doc.transact(run, origin); else run();
}

/**
 * Merge the file's new content (`next`) into document `doc` (the Y.Text named `name`).
 * `baseUpdate` = the Y state whose content equals the file as last known (when the file was written, or the result
 * of the previous merge). Returns the NEW base (the state whose content = `next`) for the next merge to start from —
 * otherwise the previous change would be applied again, doubling the text.
 */
export function mergeExternal(doc, name, baseUpdate, next, origin) {
  const fork = new Y.Doc(); // a new clientID — an "editor" of its own
  Y.applyUpdate(fork, baseUpdate);
  const before = Y.encodeStateVector(fork);
  applyText(fork.getText(name), next);
  const delta = Y.encodeStateAsUpdate(fork, before);
  const nextBase = Y.encodeStateAsUpdate(fork);
  fork.destroy();
  Y.applyUpdate(doc, delta, origin);
  return nextBase;
}
