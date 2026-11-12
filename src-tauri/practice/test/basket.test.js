import { test } from "node:test";
import assert from "node:assert/strict";
import { money, total } from "../src/basket.js";

test("counts each item as many times as its quantity", () => {
  assert.equal(total([{ price: 2, quantity: 3 }], 0), 6);
});

test("keeps the cents when it adds the tax", () => {
  assert.equal(total([{ price: 10, quantity: 1 }], 0.0825), 10.83);
});

test("shows two places after the point", () => {
  assert.equal(money(4.5), "$4.50");
});

test("adds up an empty basket to nothing", () => {
  assert.equal(total([], 0.1), 0);
});
