import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/frontmatter.js";

test("parseFrontmatter reads scalars, inline lists, and the body", () => {
  const text = `---
name: Senior Engineer
model: sonnet
tools: [Read, Edit, Write]
---

You are a senior engineer.`;

  const { data, body } = parseFrontmatter(text);
  assert.equal(data.name, "Senior Engineer");
  assert.equal(data.model, "sonnet");
  assert.deepEqual(data.tools, ["Read", "Edit", "Write"]);
  assert.equal(body, "You are a senior engineer.");
});

test("parseFrontmatter reads a block list", () => {
  const text = `---
name: x
aliases:
  - se
  - senior
---
body`;
  const { data } = parseFrontmatter(text);
  assert.deepEqual(data.aliases, ["se", "senior"]);
});

test("parseFrontmatter coerces booleans, null, and numbers, but not quoted numbers", () => {
  const text = `---
enabled: true
disabled: false
missing: null
count: 42
quoted: "42"
---
body`;
  const { data } = parseFrontmatter(text);
  assert.equal(data.enabled, true);
  assert.equal(data.disabled, false);
  assert.equal(data.missing, null);
  assert.equal(data.count, 42);
  assert.equal(data.quoted, "42");
});

test("parseFrontmatter treats a fence-less file as all-body", () => {
  const { data, body } = parseFrontmatter("just a prompt, no frontmatter");
  assert.deepEqual(data, {});
  assert.equal(body, "just a prompt, no frontmatter");
});

test("stringifyFrontmatter -> parseFrontmatter round-trips scalars and lists", () => {
  const data = { name: "Bug Fixer", model: "opus", tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "*"] };
  const body = "You are a debugging specialist.";
  const text = stringifyFrontmatter(data, body);

  const parsed = parseFrontmatter(text);
  assert.equal(parsed.data.name, data.name);
  assert.equal(parsed.data.model, data.model);
  assert.deepEqual(parsed.data.tools, data.tools);
  assert.equal(parsed.body, body);
});

test("stringifyFrontmatter quotes a value that would otherwise re-parse wrong", () => {
  const text = stringifyFrontmatter({ description: "-1 wrong turns" }, "body");
  // A bare leading "-1" would coerce back to the number -1, not the string.
  const { data } = parseFrontmatter(text);
  assert.equal(data.description, "-1 wrong turns");
});
