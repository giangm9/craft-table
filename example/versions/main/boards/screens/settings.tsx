// Settings: the person's name and email, and the reminders the app sends them. A working prototype: fields and
// boxes can be changed and Save shows that it saved (nothing is stored).
// Scenarios (?s=): default · reminders-off — see settings.meta.json; rules R1…R5 in settings.behavior.md.
import { useState } from "react";
import { BellOff, Check } from "lucide-react";
import { Button, Card, Checkbox, TextField } from "@ds";
import { Shell } from "../_kit/Shell";
import { ME } from "../_kit/fixtures";

type Reminders = { assigned: boolean; daily: boolean; dayBefore: boolean };
const SCENARIOS: Record<string, Reminders> = {
  default: { assigned: true, daily: true, dayBefore: true },
  "reminders-off": { assigned: false, daily: false, dayBefore: false },
};
const REMINDERS: { key: keyof Reminders; label: string; hint: string }[] = [
  { key: "assigned", label: "Someone gives me a task", hint: "An email as soon as it happens." },
  { key: "daily", label: "A summary every morning", hint: "At 9:00, the tasks due today and the late ones." },
  { key: "dayBefore", label: "The day before a task is due", hint: "Only for tasks given to me." },
];

export default function Settings({ scenario }: { scenario?: string }) {
  const [name, setName] = useState(ME.name);
  const [email, setEmail] = useState(ME.email);
  const [reminders, setReminders] = useState<Reminders>(() => SCENARIOS[scenario ?? ""] ?? SCENARIOS.default);
  const [saved, setSaved] = useState(false);
  const allOff = !reminders.assigned && !reminders.daily && !reminders.dayBefore;
  // R2: an email needs an @ and a dot after it.
  const emailError = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? undefined : "Write a whole email address, like name@example.com.";
  const nameError = name.trim() ? undefined : "Your name is shown next to your tasks.";
  const change = (fn: () => void) => { fn(); setSaved(false); };

  return (
    <Shell active="settings">
      <h1 className="text-xl font-semibold text-ink-900 mb-5">Settings</h1>
      <div className="space-y-4">
        {/* R1, R2: profile. */}
        <Card title="Profile">
          <div className="grid sm:grid-cols-2 gap-4 p-4">
            <TextField label="Name" value={name} onChange={(e) => change(() => setName(e.target.value))} error={nameError} />
            <TextField label="Email" type="email" value={email} onChange={(e) => change(() => setEmail(e.target.value))} error={emailError} hint="Reminders go to this address." />
          </div>
        </Card>

        {/* R3: reminders, each on or off. */}
        <Card title="Reminders">
          <ul className="divide-y divide-ink-100">
            {REMINDERS.map((r) => (
              <li key={r.key} className="px-4 py-3">
                <Checkbox
                  checked={reminders[r.key]}
                  onChange={(on) => change(() => setReminders((x) => ({ ...x, [r.key]: on })))}
                  label={<><span className="block font-medium text-ink-900">{r.label}</span><span className="block text-ink-500">{r.hint}</span></>}
                />
              </li>
            ))}
          </ul>
          {/* R4: every reminder off → a warning, not a block. */}
          {allOff && (
            <p role="status" className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <BellOff size={16} className="mt-0.5 shrink-0" />
              You will not get any reminders. Late tasks will only show on the list.
            </p>
          )}
        </Card>

        {/* R5: nothing is kept before Save; "Saved" until the next change. */}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="inline-flex items-center gap-1 text-sm text-success-700"><Check size={16} />Saved</span>}
          <Button disabled={!!(emailError || nameError)} onClick={() => setSaved(true)}>Save changes</Button>
        </div>
      </div>
    </Shell>
  );
}
