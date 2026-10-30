import type { CheckResult } from "../src/events";

/** A small change for the reviewer to judge. The checks pass on every case, so only the
 *  review can catch a planted bug. Controls are correct and should be approved. */
export interface ReviewCase {
  name: string;
  task: string;
  before: Record<string, string>;
  after: Record<string, string>;
  /** What's wrong, and words a review that found it would use. Unset for a control. */
  bug?: { what: string; named: RegExp };
  /** The checks as the reviewer sees them, when they don't all simply pass. */
  checks?: CheckResult[];
}

const pricing = `export interface Plan {
  name: string;
  /** Dollars per month. */
  monthly: number;
}

export function priceLabel(plan: Plan): string {
  return \`$\${plan.monthly}/mo\`;
}
`;

const annual = (factor: string) => `export interface Plan {
  name: string;
  /** Dollars per month. */
  monthly: number;
}

export function priceLabel(plan: Plan): string {
  return \`$\${plan.monthly}/mo\`;
}

/** A year paid up front, with 20% off. */
export function annualPrice(plan: Plan): number {
  return plan.monthly * 12 * ${factor};
}

export function annualLabel(plan: Plan): string {
  return \`$\${annualPrice(plan).toFixed(0)}/yr\`;
}
`;

const list = `export function sortByDate<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date));
}
`;

const paginated = (start: string) => `export function sortByDate<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date));
}

/** One page of items. Pages are numbered from 1. */
export function paginate<T>(items: T[], page: number, size: number): T[] {
  const start = ${start};
  return items.slice(start, start + size);
}
`;

const checkout = `export interface User {
  id: string;
  isMember: boolean;
}

export function total(user: User, prices: number[]): number {
  return prices.reduce((sum, p) => sum + p, 0);
}
`;

const customers = `import { db } from "./db";

export function customerById(id: string) {
  return db.query("SELECT * FROM customers WHERE id = ?", [id]);
}
`;

const profile = `import { api } from "./api";
import { toast } from "./toast";

export interface Profile {
  name: string;
}

export function onSubmit(form: Profile) {
  toast("Saving…");
}

export async function saveProfile(profile: Profile): Promise<void> {
  await api.put("/profile", profile);
}
`;

export const CASES: ReviewCase[] = [
  {
    name: "annual price",
    task: "Add an annual price to each plan: twelve months paid up front, with 20% off.",
    before: { "src/pricing.ts": pricing },
    after: { "src/pricing.ts": annual("0.2") },
    bug: { what: "charges 20% of the year instead of taking 20% off", named: /0\.8|80\s?%|\* ?0\.2|20% of/i },
  },
  {
    name: "pagination",
    task: "Add a paginate(items, page, size) helper. Pages are numbered from 1.",
    before: { "src/list.ts": list },
    after: { "src/list.ts": paginated("page * size") },
    bug: { what: "page 1 skips the first page of items", named: /page\s*-\s*1|off.by.one|skip|first page|1-based|one-based/i },
  },
  {
    name: "member discount",
    task: "Give members 10% off their checkout total.",
    before: { "src/checkout.ts": checkout },
    after: {
      "src/checkout.ts": checkout.replace(
        "  return prices.reduce((sum, p) => sum + p, 0);",
        "  const sum = prices.reduce((sum, p) => sum + p, 0);\n  return !user.isMember ? sum * 0.9 : sum;",
      ),
    },
    bug: { what: "the discount goes to non-members", named: /non-?member|invert|negat|!user\.isMember|backwards|opposite|wrong (users|people)/i },
  },
  {
    name: "customer search",
    task: "Add a search for customers by name.",
    before: { "src/customers.ts": customers },
    after: {
      "src/customers.ts":
        customers +
        `
export function searchCustomers(name: string) {
  return db.query("SELECT * FROM customers WHERE name LIKE '%" + name + "%'");
}
`,
    },
    bug: { what: "builds SQL from the search text", named: /inject|parameteri|placeholder|escap|sanitiz|\?\s*\]/i },
  },
  {
    name: "save profile",
    task: "Save the profile when the form is submitted. Show \"Saved\" once it's saved, or \"Couldn't save\" if it fails.",
    before: { "src/profile.ts": profile },
    after: {
      "src/profile.ts": profile.replace(
        '  toast("Saving…");\n}',
        '  toast("Saving…");\n  try {\n    saveProfile(form);\n    toast("Saved");\n  } catch {\n    toast("Couldn\'t save");\n  }\n}',
      ),
    },
    bug: { what: "never awaits the save, so failures aren't caught", named: /await|async|promise/i },
  },
  {
    name: "annual price, correct",
    task: "Add an annual price to each plan: twelve months paid up front, with 20% off.",
    before: { "src/pricing.ts": pricing },
    after: { "src/pricing.ts": annual("0.8") },
  },
  {
    name: "pagination, correct",
    task: "Add a paginate(items, page, size) helper. Pages are numbered from 1.",
    before: { "src/list.ts": list },
    after: { "src/list.ts": paginated("(page - 1) * size") },
  },
  {
    // A correct change in a project whose tests were already broken: the review shouldn't
    // ask for that failure to be fixed, as it did on Bob's Axon theme run.
    name: "annual price, old failure",
    task: "Add an annual price to each plan: twelve months paid up front, with 20% off.",
    before: { "src/pricing.ts": pricing },
    after: { "src/pricing.ts": annual("0.8") },
    checks: [
      {
        command: "npm run test",
        ok: false,
        failedBefore: true,
        output:
          ' FAIL  src/settings.test.ts [ src/settings.test.ts ]\nError: Failed to resolve import "../store/useSettingsStore" from "src/settings.test.ts". Does the file exist?\n\n Test Files  1 failed | 4 passed (5)',
      },
    ],
  },
];
