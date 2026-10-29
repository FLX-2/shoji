// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MODELS } from "../src/models";
import { describeStacks, ROLES, STACKS } from "../src/stack";

describe("describeStacks", () => {
  const lines = describeStacks().split("\n");

  it("lists each stack's model and effort for every role, in role order", () => {
    for (const [name, stack] of Object.entries(STACKS)) {
      const line = lines.find((l) => l.startsWith(`  ${name} `));
      expect(line).toBeDefined();
      let from = 0;
      for (const role of ROLES) {
        const at = line!.indexOf(`${MODELS[stack[role].model].label} (${stack[role].effort})`, from);
        expect(at).toBeGreaterThanOrEqual(from);
        from = at + 1;
      }
    }
  });

  it("heads the columns with the roles in order", () => {
    let from = 0;
    for (const role of ["scout", "plan", "build", "review"]) {
      const at = lines[0].indexOf(role, from);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
  });
});
