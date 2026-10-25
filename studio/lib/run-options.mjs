// What a conversation turn runs WITH: the Claude model and the reasoning effort the person picks in the message box.
// The studio offers a short list of models (STUDIO_AGENT_MODELS = id[:label], …; built-in: the current Sonnet, Opus and
// Haiku) and the five effort levels of the Claude API; a thread keeps its choice (thread.runWith = { model?, effort? }),
// empty means "the studio's default" (STUDIO_AGENT_MODEL, default the alias "sonnet"; no effort = the model's own default).
// A model that is not in the list is refused: the list is also the person's cost control.
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,60}$/;

/** → { models: [{ id, label }], defaultModel: { id, label } } from the environment. */
export function modelChoices(env = process.env) {
  const raw = String(env.STUDIO_AGENT_MODELS ?? "").trim();
  let models = DEFAULT_MODELS;
  if (raw) {
    const listed = raw.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf(":");
      const id = (i < 0 ? x : x.slice(0, i)).trim();
      return { id, label: (i < 0 ? "" : x.slice(i + 1).trim()) || id };
    }).filter((m) => MODEL_ID.test(m.id));
    if (listed.length) models = listed;
  }
  const id = String(env.STUDIO_AGENT_MODEL || "sonnet").trim();
  return { models, defaultModel: { id, label: models.find((m) => m.id === id)?.label ?? id } };
}

/** A thread's choice as sent by a page → { ok: true, runWith } (empty strings mean "the default") | { ok: false, code }. */
export function cleanRunWith(input, models) {
  const model = typeof input?.model === "string" ? input.model.trim() : "";
  const effort = typeof input?.effort === "string" ? input.effort.trim() : "";
  if (model && !models.some((m) => m.id === model)) return { ok: false, code: "apiBadRunModel" };
  if (effort && !EFFORTS.includes(effort)) return { ok: false, code: "apiBadRunEffort" };
  return { ok: true, runWith: { ...(model ? { model } : {}), ...(effort ? { effort } : {}) } };
}

/** What the next turn of a thread really uses: its choice, else the default; a model no longer offered falls back to the default. */
export function effectiveRun(thread, { models, defaultModel }) {
  const rw = thread?.runWith ?? {};
  return {
    model: rw.model && models.some((m) => m.id === rw.model) ? rw.model : defaultModel.id,
    effort: EFFORTS.includes(rw.effort) ? rw.effort : undefined,
  };
}
