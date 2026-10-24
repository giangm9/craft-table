// Claude's queue PER SCREEN: only one Claude turn edits a screen at a time (key = "<version>:<screen>"), so two
// threads on the same screen do not overwrite each other's files. Other screens / other versions run in parallel.
// First in, first out. Calling a release function more than once only counts the first time.

export function createQueue() {
  const locks = new Map(); // key → array of the "let in" functions of the waiting turns (key present in the Map = a turn holds it)

  const grant = (key) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const waiters = locks.get(key);
      const next = waiters?.shift();
      if (next) next(grant(key));
      else locks.delete(key);
    };
  };

  return {
    /** Waits for its turn; resolves to the release function. */
    acquire(key) {
      if (!locks.has(key)) { locks.set(key, []); return Promise.resolve(grant(key)); }
      return new Promise((resolve) => locks.get(key).push(resolve));
    },
    /** A turn holds this screen. */
    busy: (key) => locks.has(key),
    /** Number of waiting turns (not counting the one holding it). */
    waiting: (key) => locks.get(key)?.length ?? 0,
  };
}
