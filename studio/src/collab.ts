// Co-editing, browser side: opens a Y.js document (= one file of a screen) through the studio server's /__collab.
// Who is editing: awareness.user = { name, email, color }; y-codemirror draws cursors and name labels from it.
// Names shown for people OTHER tabs report are derived again here from the email (withViewerName), so every viewer
// reads them in their own language.
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { personName, withViewerName } from "./i18n/shell";

export type Who = { name: string; email: string; color: string; colorLight: string };

const COLORS = ["#0f766e", "#7c3aed", "#c2410c", "#2563eb", "#be123c", "#4d7c0f", "#a16207", "#0e7490"];
export function whoFrom(email: string): Who {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = COLORS[h % COLORS.length];
  return { name: personName(email), email, color, colorLight: `${color}33` };
}

export type CollabDoc = { doc: Y.Doc; text: Y.Text; provider: HocuspocusProvider; destroy: () => void };

/** Document name = "<version>/<path inside boards>", e.g. "main/screens/orders/list.behavior.md". */
export function openDoc(name: string, me: Who): CollabDoc {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__collab`,
    name,
    document: doc,
  });
  provider.setAwarenessField("user", { name: me.name, email: me.email, color: me.color, colorLight: me.colorLight });
  return {
    doc,
    text: doc.getText("content"),
    provider,
    destroy() {
      provider.destroy();
      provider.configuration.websocketProvider?.destroy();
      doc.destroy();
    },
  };
}

/** A person from an awareness state, named for this viewer (an old client may have sent no email: keep its name). */
const seenHere = (user: Who): Who => (typeof user.email === "string" ? withViewerName(user) : user);

/** People who have the document open (from awareness): one per connection (one person with 2 tabs = 2). */
export function editorsOf(provider: HocuspocusProvider): Who[] {
  const seen = new Map<number, Who>();
  provider.awareness?.getStates().forEach((st, id) => { if (st.user) seen.set(id, seenHere(st.user as Who)); });
  return [...seen.values()];
}

export type Here = { v: string; entry?: string };
export type Peer = { id: number; who: Who; where: Here };

/** Presence across the studio (document "__presence", awareness only): each tab reports the version + screen it is on
 *  and receives the OTHER tabs (including the person's own other tabs). Closing a tab → the server removes it. */
export function usePresence(me: Who | null, here: Here | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  const ref = useRef<CollabDoc | null>(null);
  useEffect(() => {
    if (!me) return;
    const c = openDoc("__presence", me);
    ref.current = c;
    const aw = c.provider.awareness!;
    const sync = () => {
      const out: Peer[] = [];
      aw.getStates().forEach((st, id) => {
        if (id !== aw.clientID && st.user && st.where?.v) out.push({ id, who: seenHere(st.user as Who), where: st.where as Here });
      });
      setPeers(out);
    };
    aw.on("change", sync);
    return () => { aw.off("change", sync); c.destroy(); ref.current = null; setPeers([]); };
  }, [me?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (here?.v) ref.current?.provider.setAwarenessField("where", { v: here.v, entry: here.entry });
  }, [here?.v, here?.entry, me?.email]);
  return peers;
}
