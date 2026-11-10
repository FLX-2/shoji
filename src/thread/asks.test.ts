import { describe, expect, it } from "vitest";
import { readsAsQuestion } from "./asks";

describe("a message that reads as a question", () => {
  it("is answered rather than planned again", () => {
    for (const text of ["what model is being used right now", "Why did it change the header?", "is the test passing", "Does this touch the API?"])
      expect(readsAsQuestion(text)).toBe(true);
  });

  it("leaves requests as requests, question mark or not", () => {
    for (const text of ["Make the button blue", "can you make it blue?", "Could you add a test?", "please rename it", "How about a smaller font?", "Use Postgres instead.\nAnd add a test.", "Why is the header red? It should be blue."])
      expect(readsAsQuestion(text)).toBe(false);
  });
});
