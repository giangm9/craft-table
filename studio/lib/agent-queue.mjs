// Claude's queue: a turn on a SCREEN holds "<version>:<screen>" — only one turn edits a screen at a time, so two threads on
// the same screen do not overwrite each other's files; other screens / other versions run in parallel. A WHOLE-DESIGN turn
// holds "<version>:*" — the whole version: it waits for every running turn of that version and blocks the rest of that
// version until it is done. Strictly first in, first out among turns that conflict (a design turn waiting is never overtaken
// by a screen turn that came later, so it cannot be starved). Calling a release function more than once only counts the first time.

const DESIGN = "*";
const split = (key) => { const i = String(key).indexOf(":"); return { version: key.slice(0, i), screen: key.slice(i + 1) }; };
const conflicts = (a, b) => a.version === b.version && (a.screen === DESIGN || b.screen === DESIGN || a.screen === b.screen);

export function createQueue() {
  const active = new Set();   // requests holding the queue
  const pending = [];         // requests waiting, in arrival order

  const pump = () => {
    for (let i = 0; i < pending.length; ) {
      const req = pending[i];
      const blocked = [...active].some((a) => conflicts(a, req)) || pending.slice(0, i).some((p) => conflicts(p, req));
      if (blocked) { i++; continue; }
      pending.splice(i, 1);
      active.add(req);
      let done = false;
      req.resolve(() => { if (done) return; done = true; active.delete(req); pump(); });
    }
  };

  const same = (r, key) => r.key === key;
  return {
    /** Waits for its turn; resolves to the release function. */
    acquire(key) {
      return new Promise((resolve) => { pending.push({ key, ...split(key), resolve }); pump(); });
    },
    /** A turn started now with this key would have to wait (a design turn conflicts with every turn of its version). */
    busy: (key) => { const k = split(key); return [...active, ...pending].some((r) => conflicts(r, k)); },
    /** Number of waiting turns of this key (not counting the one holding it). */
    waiting: (key) => pending.filter((p) => same(p, key)).length,
  };
}
