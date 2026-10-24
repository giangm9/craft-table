// Fake data for the boards: a made-up team and its tasks. Dates are written as people read them; "today" on every
// board is Tuesday 21 October.

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
export type Person = { id: string; name: string; initials: string; email: string; tone: Tone };
/** overdue → red, today → amber, later → grey (Task list R5). */
export type Due = { label: string; when: "overdue" | "today" | "later" };
export type ChecklistItem = { text: string; done: boolean };
export type Comment = { by: Person; at: string; text: string };
export type Task = {
  id: string;
  title: string;
  done: boolean;
  assignee: Person | null;
  due: Due | null;
  notes?: string;
  checklist?: ChecklistItem[];
  comments?: Comment[];
  createdBy?: Person;
  doneBy?: { by: Person; at: string };
};

export const PEOPLE = {
  ana: { id: "ana", name: "Ana Lima", initials: "AL", email: "ana@acme.example", tone: "accent" },
  ben: { id: "ben", name: "Ben Okafor", initials: "BO", email: "ben@acme.example", tone: "success" },
  chen: { id: "chen", name: "Chen Wei", initials: "CW", email: "chen@acme.example", tone: "warning" },
  dara: { id: "dara", name: "Dara Novak", initials: "DN", email: "dara@acme.example", tone: "danger" },
} satisfies Record<string, Person>;
/** The person looking at the screens. */
export const ME: Person = PEOPLE.ana;

export const DUE = {
  overdue: { label: "Mon 20 Oct", when: "overdue" },
  today: { label: "Today", when: "today" },
  tomorrow: { label: "Tomorrow", when: "later" },
  friday: { label: "Fri 24 Oct", when: "later" },
  nextWeek: { label: "Tue 28 Oct", when: "later" },
} satisfies Record<string, Due>;

export const dueTone = (d: Due): Tone => (d.when === "overdue" ? "danger" : d.when === "today" ? "warning" : "neutral");

/** The task opened on the Task detail board. */
export const OPEN_TASK: Task = {
  id: "t-12",
  title: "Book a room for the quarterly planning",
  done: false,
  assignee: PEOPLE.chen,
  due: DUE.overdue,
  createdBy: PEOPLE.ana,
  notes: "We need space for twelve people and a screen for the whole afternoon. The usual room is taken on the 30th, so look at the library or the place across the street.",
  checklist: [
    { text: "Ask the library about Thursday 30 Oct", done: true },
    { text: "Get a second quote from across the street", done: false },
    { text: "Check that there is a screen and enough chairs", done: false },
  ],
  comments: [
    { by: PEOPLE.ana, at: "Mon 9:12", text: "Could we also have coffee in the room? The afternoon is long." },
    { by: PEOPLE.chen, at: "Mon 16:40", text: "The library has a free room on the 30th. Waiting for the second quote before I book." },
  ],
};

export const DONE_TASK: Task = {
  ...OPEN_TASK,
  id: "t-9",
  title: "Send the invoice to the print shop",
  done: true,
  assignee: PEOPLE.dara,
  due: DUE.overdue,
  createdBy: PEOPLE.ben,
  doneBy: { by: PEOPLE.dara, at: "Mon 20 Oct, 11:05" },
  notes: "Invoice number 2026-118 for the spring flyers. They want it as a document attached to an email, not on paper.",
  checklist: [
    { text: "Check the amount against the quote", done: true },
    { text: "Send it to the print shop's billing address", done: true },
  ],
  comments: [{ by: PEOPLE.dara, at: "Mon 11:05", text: "Sent. They confirmed it arrived." }],
};

/** A normal day: a few tasks, some finished. */
export const FEW_TASKS: Task[] = [
  { id: "t-14", title: "Draft the welcome email for new customers", done: false, assignee: PEOPLE.ana, due: DUE.today },
  { id: "t-13", title: "Review the pricing page text", done: false, assignee: PEOPLE.ben, due: DUE.tomorrow },
  { ...OPEN_TASK, notes: undefined, checklist: undefined, comments: undefined },
  { id: "t-11", title: "Find a new supplier for printer paper", done: false, assignee: null, due: null },
  { id: "t-10", title: "Update the team calendar for November", done: true, assignee: PEOPLE.ana, due: DUE.friday },
  { ...DONE_TASK, notes: undefined, checklist: undefined, comments: undefined },
];

const MORE = [
  "Plan the spring newsletter", "Fix the spelling mistake on the About page", "Order name tags for the fair",
  "Call the landlord about the heating", "Collect feedback from the last workshop", "Renew the domain name",
  "Prepare the slides for Monday's meeting", "Answer the question from the school in Leeds", "Clean up the shared drive",
  "Write the job post for a part-time designer", "Check the reviews on the shop page", "Send thank-you cards to the volunteers",
  "Count what is left in the storage room", "Translate the flyer into Spanish", "Photograph the new products",
  "Ask the bank about the card reader", "Choose a date for the summer party", "Archive last year's receipts",
  "Test the new booking form on a phone", "Write down how to open the office", "Compare two offers for the van",
  "Reply to the journalist from the local paper", "Repair the shelf in the kitchen", "Make a list of open invoices",
  "Plan the route for the deliveries", "Update the price list", "Book the train for the trade fair",
  "Pick new colours for the shop window", "Send the minutes of the board meeting", "Find out who has the spare key",
];
const PEOPLE_CYCLE: (Person | null)[] = [PEOPLE.ana, PEOPLE.ben, PEOPLE.chen, PEOPLE.dara, null];
const DUE_CYCLE: (Due | null)[] = [DUE.today, DUE.tomorrow, DUE.friday, null, DUE.nextWeek, DUE.overdue, null];

/** A busy week: more tasks than fit on a screen. */
export const MANY_TASKS: Task[] = [
  ...FEW_TASKS,
  ...MORE.map((title, i) => ({
    id: `old-${i}`,
    title,
    done: i % 4 === 3,
    assignee: PEOPLE_CYCLE[i % PEOPLE_CYCLE.length],
    due: DUE_CYCLE[i % DUE_CYCLE.length],
  })),
];
