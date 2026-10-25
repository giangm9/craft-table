import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFORTS, modelChoices, cleanRunWith, effectiveRun } from "./run-options.mjs";

test("modelChoices: built-in Claude models by default; the studio's default model is named, whatever it is", () => {
  const c = modelChoices({});
  assert.deepEqual(c.models.map((m) => m.id), ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);
  assert.deepEqual(c.defaultModel, { id: "sonnet", label: "sonnet" }, "an alias nobody listed is shown as it is");
  const named = modelChoices({ STUDIO_AGENT_MODEL: "claude-sonnet-5-5" });
  assert.deepEqual(named.defaultModel, { id: "claude-sonnet-5-5", label: "Sonnet 5.5" }, "a listed default shows its label");
});

test("modelChoices: STUDIO_AGENT_MODELS = id[:label], …", () => {
  const c = modelChoices({ STUDIO_AGENT_MODELS: "claude-opus-5-5:Opus, claude-fable-5-1 ,bad id,", STUDIO_AGENT_MODEL: "claude-fable-5-1" });
  assert.deepEqual(c.models, [{ id: "claude-opus-5-5", label: "Opus" }, { id: "claude-fable-5-1", label: "claude-fable-5-1" }], "ids that are not model names are dropped");
  assert.equal(c.defaultModel.id, "claude-fable-5-1");
});

test("cleanRunWith: empty means 'the default'; only listed models and the known efforts are accepted", () => {
  const { models } = modelChoices({});
  assert.deepEqual(cleanRunWith({}, models), { ok: true, runWith: {} });
  assert.deepEqual(cleanRunWith({ model: "", effort: "" }, models), { ok: true, runWith: {} });
  assert.deepEqual(cleanRunWith({ model: "claude-opus-5-5", effort: "xhigh" }, models), { ok: true, runWith: { model: "claude-opus-5-5", effort: "xhigh" } });
  assert.deepEqual(cleanRunWith(null, models), { ok: true, runWith: {} });
  assert.deepEqual(cleanRunWith({ model: "gpt-9" }, models), { ok: false, code: "apiBadRunModel" });
  assert.deepEqual(cleanRunWith({ effort: "turbo" }, models), { ok: false, code: "apiBadRunEffort" });
  assert.deepEqual(EFFORTS, ["low", "medium", "high", "xhigh", "max"]);
});

test("effectiveRun: the thread's choice, else the default; a model that is no longer offered falls back to the default", () => {
  const choices = modelChoices({ STUDIO_AGENT_MODEL: "claude-sonnet-5-5" });
  assert.deepEqual(effectiveRun({}, choices), { model: "claude-sonnet-5-5", effort: undefined });
  assert.deepEqual(effectiveRun({ runWith: { model: "claude-opus-5-5", effort: "max" } }, choices), { model: "claude-opus-5-5", effort: "max" });
  assert.deepEqual(effectiveRun({ runWith: { model: "claude-gone-1", effort: "bogus" } }, choices), { model: "claude-sonnet-5-5", effort: undefined });
});
