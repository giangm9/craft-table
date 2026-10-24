// Task list: the team's shared to-do list, the first screen after signing in. A working prototype — adding, ticking
// off and filtering work on the board (the state lives in the board; nothing is saved).
// Scenarios (?s=): few-tasks · empty · many-tasks — see list.meta.json; rules R1…R9 in list.behavior.md.
import { useState, type FormEvent } from "react";
import { CalendarDays, ClipboardList, Plus } from "lucide-react";
import { Badge, Button, Card, Checkbox, TextField, cn } from "@ds";
import { Avatar } from "../../_kit/Avatar";
import { Shell, noNav } from "../../_kit/Shell";
import { FEW_TASKS, MANY_TASKS, ME, dueTone, type Task } from "../../_kit/fixtures";

type Filter = "all" | "open" | "done";
const SCENARIOS: Record<string, Task[]> = { "few-tasks": FEW_TASKS, empty: [], "many-tasks": MANY_TASKS };
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "open", label: "Open" }, { id: "done", label: "Done" }];

function TaskRow({ task, onToggle }: { task: Task; onToggle: (done: boolean) => void }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox checked={task.done} onChange={onToggle} aria-label={`Done: ${task.title}`} />
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        {/* R7: the title opens the task. */}
        <a href={`/tasks/${task.id}`} onClick={noNav} className={cn("block min-w-0 flex-1 text-sm", task.done ? "text-ink-400 line-through" : "text-ink-900 hover:text-accent-600")}>
          {task.title}
        </a>
        <div className="mt-1.5 sm:mt-0 flex items-center gap-2 shrink-0">
          {/* R5: due date colour, grey once done. R6: who does it. */}
          {task.due && <Badge tone={task.done ? "neutral" : dueTone(task.due)}><CalendarDays size={12} />{task.due.label}</Badge>}
          {task.assignee ? <Avatar person={task.assignee} size="sm" /> : <span className="text-xs text-ink-400">No one yet</span>}
        </div>
      </div>
    </li>
  );
}

export default function TaskList({ scenario }: { scenario?: string }) {
  const [tasks, setTasks] = useState<Task[]>(() => SCENARIOS[scenario ?? ""] ?? FEW_TASKS);
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const open = tasks.filter((t) => !t.done).length;
  const count: Record<Filter, number> = { all: tasks.length, open, done: tasks.length - open };
  const shown = tasks.filter((t) => filter === "all" || (filter === "done") === t.done);

  // R2: a new task goes on top, given to the person who wrote it, without a date.
  const add = (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setTasks((ts) => [{ id: `new-${ts.length}`, title, done: false, assignee: ME, due: null }, ...ts]);
    setDraft("");
  };
  const toggle = (id: string, done: boolean) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done } : t)));

  return (
    <Shell active="tasks">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink-900">Team tasks</h1>
        <p className="mt-0.5 text-sm text-ink-500">{tasks.length ? `${count.open} open · ${count.done} done` : "Nothing on the list yet"}</p>
      </div>

      <form onSubmit={add} className="flex items-start gap-2 mb-4">
        <TextField className="flex-1" aria-label="New task" placeholder="Add a task…" value={draft} onChange={(e) => setDraft(e.target.value)} icon={<Plus size={16} />} />
        <Button type="submit" disabled={!draft.trim()}>Add</Button>
      </form>

      {tasks.length === 0 ? (
        // R8: empty list.
        <Card className="px-6 py-12 text-center">
          <span className="mx-auto w-12 h-12 rounded-full bg-accent-50 text-accent-600 flex items-center justify-center"><ClipboardList size={22} /></span>
          <p className="mt-3 font-medium text-ink-900">No tasks yet</p>
          <p className="mt-1 text-sm text-ink-500">Add the first one above. Everyone on the team will see it here.</p>
        </Card>
      ) : (
        <>
          {/* R4: filters with their counts. */}
          <div role="group" aria-label="Show" className="inline-flex p-1 mb-3 rounded-lg bg-ink-100 gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn("h-8 px-3 rounded-md text-sm font-medium tabular-nums", filter === f.id ? "bg-surface text-ink-900 border border-ink-200" : "text-ink-600 hover:text-ink-900")}
              >
                {f.label} <span className="text-ink-400">{count[f.id]}</span>
              </button>
            ))}
          </div>
          {shown.length ? (
            <Card>
              <ul className="divide-y divide-ink-100">
                {shown.map((t) => <TaskRow key={t.id} task={t} onToggle={(done) => toggle(t.id, done)} />)}
              </ul>
            </Card>
          ) : (
            <Card className="px-6 py-10 text-center text-sm text-ink-500">{filter === "done" ? "Nothing finished yet." : "All done. Nice work."}</Card>
          )}
        </>
      )}
    </Shell>
  );
}
