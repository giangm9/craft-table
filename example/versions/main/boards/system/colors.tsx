// Design system documentation: every colour token of this version, read live from tokens.css, so the page is
// right in both themes (switch Light / Dark in the studio) and after any change to the tokens.
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Card } from "@ds";

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const STATUS = ["success", "warning", "danger"] as const;

/** Current value of a CSS variable (re-read when the theme changes). */
function useVar(name: string) {
  const [v, setV] = useState("");
  useEffect(() => {
    const read = () => setV(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    read();
    const o = new MutationObserver(read);
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, [name]);
  return v;
}

function Swatch({ token, label }: { token: string; label?: string }) {
  const value = useVar(`--color-${token}`);
  return (
    <div className="min-w-0">
      <div className="h-12 rounded-lg border border-ink-200" style={{ background: `var(--color-${token})` }} />
      <p className="mt-1 text-xs font-medium text-ink-800 truncate">{label ?? token}</p>
      <p className="text-[11px] text-ink-500 font-mono">{value}</p>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <p className="text-sm text-ink-500">{desc}</p>
      </div>
      {children}
    </section>
  );
}

const USAGE: [string, string, string][] = [
  ["Page background", "bg-ink-50", "Behind everything"],
  ["Card, input", "bg-surface border-ink-200", "Raised planes, never a shadow"],
  ["Heading, body text", "text-ink-900 · text-ink-700", "Secondary text text-ink-500"],
  ["Primary button", "bg-accent-700 hover:bg-accent-800", "White text, one per screen"],
  ["Link, selected item", "text-accent-600 · bg-accent-50", "Same in both themes"],
  ["Late, error", "danger-50 / 200 / 700", "Fill, border, text"],
];

export default function Colors() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-8 text-ink-900">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-600">Acme Tasks · design system</p>
        <h1 className="text-2xl font-semibold">Colors</h1>
        <p className="max-w-2xl text-sm text-ink-600">
          Components use these names only, never a raw colour. The dark theme gives the same names other values, so nothing
          needs a dark variant. Values below are read from tokens.css as it is now.
        </p>
      </header>

      <Section title="Ink — text, borders, grey planes" desc="50 page background · 100 dividers · 200 borders · 400 icons and placeholders · 500 secondary text · 700 body · 900 headings.">
        <div className="grid grid-cols-5 md:grid-cols-10 gap-2">{STEPS.map((s) => <Swatch key={s} token={`ink-${s}`} label={String(s)} />)}</div>
      </Section>

      <Section title="Accent — the brand" desc="600 links and selected items · 700 primary fills under white text · 800 their hover · 500 focus rings · 50–200 tints.">
        <div className="grid grid-cols-5 md:grid-cols-10 gap-2">{STEPS.map((s) => <Swatch key={s} token={`accent-${s}`} label={String(s)} />)}</div>
      </Section>

      <Section title="Surface" desc="Planes raised above the page: cards, inputs, the top bar.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Swatch token="surface" label="surface — cards, inputs" />
          <Swatch token="surface-2" label="surface-2 — a plane inside a card" />
        </div>
      </Section>

      <Section title="Status" desc="One meaning each: success = done, warning = needs attention today, danger = late or wrong. Three steps: fill, border, text.">
        <div className="grid sm:grid-cols-3 gap-3">
          {STATUS.map((t) => (
            <div key={t} className="grid grid-cols-3 gap-2">
              {[50, 200, 700].map((s) => <Swatch key={s} token={`${t}-${s}`} label={`${t} ${s}`} />)}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Done</Badge>
          <Badge tone="warning">Today</Badge>
          <Badge tone="danger">Mon 20 Oct</Badge>
          <Badge tone="accent">Open</Badge>
          <Badge>Tue 28 Oct</Badge>
        </div>
      </Section>

      <Section title="Where each colour goes" desc="The usual pairs. Anything else is probably a new token, not a new hex value.">
        <Card>
          <ul className="divide-y divide-ink-100">
            {USAGE.map(([what, cls, note]) => (
              <li key={what} className="grid sm:grid-cols-[180px_1fr_1fr] gap-1 sm:gap-4 px-4 py-2.5 text-sm">
                <span className="font-medium text-ink-900">{what}</span>
                <code className="text-xs font-mono text-ink-700 break-words">{cls}</code>
                <span className="text-ink-500">{note}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
      </Section>
    </div>
  );
}
