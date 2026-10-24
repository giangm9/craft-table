// Welcome: the first screen people see. A board is plain React: it default-exports one component that receives
// `scenario` (an id from welcome.meta.json) and draws exactly that situation, with made-up data. Boards import only
// react, lucide-react and "@ds" (the design system of this version, in ../../system/components).
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { Button, Card } from "@ds";

const PRODUCT = "{{name}}";

// Made-up data for the "returning" scenario.
const USER = { firstName: "Sam" };
const RECENT = [
  { title: "Spring launch plan", edited: "2 hours ago" },
  { title: "Onboarding guide", edited: "yesterday" },
  { title: "Pricing page draft", edited: "last week" },
];

export default function Welcome({ scenario = "first-visit" }: { scenario?: string }) {
  const returning = scenario === "returning";
  return (
    <main className="px-6 py-16 font-sans text-ink-900">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
            <Sparkles size={14} />
            {PRODUCT}
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            {returning ? `Welcome back, ${USER.firstName}` : `Welcome to ${PRODUCT}`}
          </h1>
          <p className="mt-2 text-ink-600">
            {returning ? "Pick up where you left off." : "Plan your work, share it with your team and keep everything in one place."}
          </p>
        </header>

        {returning ? (
          <Card className="p-2">
            <ul>
              {RECENT.map((r) => (
                <li key={r.title}>
                  <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-50">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    <span className="flex shrink-0 items-center gap-1 text-sm text-ink-500">
                      <Clock size={14} />
                      {r.edited}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card className="flex flex-col gap-3">
            <Button>
              Create an account
              <ArrowRight size={16} />
            </Button>
            <Button variant="secondary">I already have an account</Button>
          </Card>
        )}
      </div>
    </main>
  );
}
