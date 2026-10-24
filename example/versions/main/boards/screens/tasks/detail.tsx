// Task detail: one task on its own screen — who, when, notes, a checklist and comments. A working prototype:
// ticking the checklist, marking done / reopening and adding a comment work on the board (nothing is saved).
// Scenarios (?s=): open-task · done-task — see detail.meta.json; rules R1…R6 in detail.behavior.md.
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, Check, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, Checkbox, TextField } from "@ds";
import { Avatar } from "../../_kit/Avatar";
import { Shell, noNav } from "../../_kit/Shell";
import { DONE_TASK, ME, OPEN_TASK, dueTone, type Task } from "../../_kit/fixtures";

const SCENARIOS: Record<string, Task> = { "open-task": OPEN_TASK, "done-task": DONE_TASK };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 text-sm text-ink-900">{children}</dd>
    </div>
  );
}

export default function TaskDetail({ scenario }: { scenario?: string }) {
  const start = SCENARIOS[scenario ?? ""] ?? OPEN_TASK;
  const [done, setDone] = useState(start.done);
  const [checklist, setChecklist] = useState(start.checklist ?? []);
  const [comments, setComments] = useState(start.comments ?? []);
  const [draft, setDraft] = useState("");
  const ticked = checklist.filter((c) => c.done).length;

  // R5: a comment is added under the others, signed and timed.
  const comment = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setComments((cs) => [...cs, { by: ME, at: "Just now", text: draft.trim() }]);
    setDraft("");
  };

  return (
    <Shell active="tasks">
      <a href="/tasks" onClick={noNav} className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900 mb-4">
        <ArrowLeft size={16} /> Team tasks
      </a>

      {/* R1: title, done or open, and the one main action. */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-5">
        <div className="min-w-0 flex-1">
          <h1 className={done ? "text-xl font-semibold text-ink-500 line-through" : "text-xl font-semibold text-ink-900"}>{start.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {done ? <Badge tone="success"><Check size={12} />Done</Badge> : <Badge tone="accent">Open</Badge>}
            {done && start.doneBy && <span className="text-xs text-ink-500">by {start.doneBy.by.name} on {start.doneBy.at}</span>}
          </div>
        </div>
        {done
          ? <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={() => setDone(false)}>Reopen</Button>
          : <Button icon={<Check size={16} />} onClick={() => setDone(true)}>Mark as done</Button>}
      </div>

      <div className="space-y-4">
        {/* R2: who, when, who wrote it. */}
        <Card>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
            <Field label="Assigned to">
              {start.assignee ? <><Avatar person={start.assignee} size="sm" />{start.assignee.name}</> : <span className="text-ink-400">No one yet</span>}
            </Field>
            <Field label="Due">
              {start.due ? <Badge tone={done ? "neutral" : dueTone(start.due)}><CalendarDays size={12} />{start.due.label}</Badge> : <span className="text-ink-400">No date</span>}
            </Field>
            {start.createdBy && <Field label="Written by">{start.createdBy.name}</Field>}
          </dl>
          {start.notes && <p className="px-4 pb-4 text-sm leading-relaxed text-ink-700">{start.notes}</p>}
        </Card>

        {/* R3: the checklist and its progress. */}
        {checklist.length > 0 && (
          <Card title="Checklist" actions={<span className="text-xs text-ink-500 tabular-nums">{ticked} of {checklist.length} done</span>}>
            <ul className="divide-y divide-ink-100">
              {checklist.map((c, i) => (
                <li key={c.text} className="px-4 py-2.5">
                  <Checkbox
                    checked={c.done}
                    onChange={(v) => setChecklist((cl) => cl.map((x, j) => (j === i ? { ...x, done: v } : x)))}
                    label={<span className={c.done ? "text-ink-400 line-through" : undefined}>{c.text}</span>}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* R4, R5: comments, oldest first, and a box to add one. */}
        <Card title="Comments" actions={<span className="text-xs text-ink-500 tabular-nums">{comments.length}</span>}>
          <ul className="divide-y divide-ink-100">
            {comments.map((c, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <Avatar person={c.by} size="sm" />
                <div className="min-w-0">
                  <p className="text-xs text-ink-500"><span className="font-medium text-ink-800">{c.by.name}</span> · {c.at}</p>
                  <p className="mt-0.5 text-sm text-ink-800">{c.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <form onSubmit={comment} className="flex items-start gap-2 p-4 border-t border-ink-100">
            <TextField className="flex-1" aria-label="Comment" placeholder="Write a comment…" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!draft.trim()}>Send</Button>
          </form>
        </Card>

        {/* R6: deleting is out of the way, at the bottom. */}
        <div className="flex justify-end">
          <Button variant="danger" size="sm" icon={<Trash2 size={14} />}>Delete task</Button>
        </div>
      </div>
    </Shell>
  );
}
