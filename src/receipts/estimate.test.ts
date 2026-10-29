import { describe, expect, it } from "vitest";
import { checkEstimate, formatCheck, type Spike } from "./estimateCheck";
import spike from "./fixtures/spike.json";

// The routing spike's six tasks, priced the way Receipts prices them. A change to the estimate or
// to the model prices moves these numbers; update them only alongside `pnpm estimate-check`.
describe("the one-model estimate against the spike", () => {
  const check = checkEstimate(spike as Spike);

  it("reprices the routed calls the way the spike billed them", () => {
    expect(check.total.routed).toBeCloseTo(0.7144, 3);
  });

  it("lands about 11% under the real Opus runs, so it understates the saving", () => {
    expect(check.total.estimate).toBeCloseTo(1.419, 3);
    expect(check.total.real).toBeCloseTo(1.594, 3);
    expect(check.estimateGap).toBeCloseTo(-0.11, 2);
    expect(check.estimatedSaving).toBeCloseTo(0.496, 3);
    expect(check.realSaving).toBeCloseTo(0.552, 3);
  });

  it("prints a table with every task and the total", () => {
    const table = formatCheck(check);
    for (const { task } of spike.tasks) expect(table).toContain(task);
    expect(table).toContain("11.0% under");
  });
});
