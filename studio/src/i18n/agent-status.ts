// Renders the texts the studio stores in data as { key, params } (dictionary: agent-texts.ts) in this page's
// language. A plain string — free text from the SDK or Claude, or a value written by earlier versions — is shown as it
// is; an unknown key shows the key.
//   {agentText(thread.agent.progress)}   {agentText(thread.agent.error)}   {storedText(revision.note)}
import { pick } from "./index";
import { STORED_TEXTS, renderStored, type StoredText } from "./agent-texts";

export type { StoredText };
const T = pick(STORED_TEXTS);

/** thread.agent.progress / thread.agent.error → text for this page (null when there is none). */
export const agentText = (x: StoredText | null | undefined): string | null => renderStored(T, x);
/** Any other text the studio stores the same way (history notes). */
export const storedText = agentText;
