import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/lib/agents.js";

test("slugify lowercases and hyphenates", () => {
  assert.equal(slugify("Senior Engineer"), "senior-engineer");
});

test("slugify strips characters that aren't a-z0-9", () => {
  assert.equal(slugify("QA / Reviewer!!"), "qa-reviewer");
});

test("slugify trims leading and trailing hyphens", () => {
  assert.equal(slugify("--already-hyphenated--"), "already-hyphenated");
});

test("slugify truncates to 48 characters", () => {
  const long = "a".repeat(80);
  assert.equal(slugify(long).length, 48);
});

test("slugify falls back to 'agent' for empty or all-punctuation input", () => {
  assert.equal(slugify(""), "agent");
  assert.equal(slugify("!!!"), "agent");
  assert.equal(slugify(null), "agent");
  assert.equal(slugify(undefined), "agent");
});
