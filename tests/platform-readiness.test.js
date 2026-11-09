import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateChecks, evaluateReadiness, readinessCategories } from "../src/platform-readiness.js";

const check = (status, required = true) => ({ status, required });
const platform = { id: "custom-test", name: "Test Platform", kind: "console", maker: "Test", year: "1990", tagline: "Test fixture" };
const snapshot = (checks, gameCount = null) =>
  evaluateReadiness({ evaluatedAt: 0, platforms: [{ platform, gameCount, checks }] }).platforms[0];
const observed = (status, explanation, detail) => ({ status, explanation, detail, source: "Fixture evidence" });

test("RAG aggregation separates required failures, optional failures, unverified and not applicable", () => {
  assert.deepEqual(aggregateChecks([check("green"), check("grey")]), { status: "green", passed: 1, applicable: 1 });
  assert.equal(aggregateChecks([check("red"), check("amber")]).status, "red");
  assert.equal(aggregateChecks([check("red", false), check("green")]).status, "amber");
  assert.equal(aggregateChecks([check("amber")]).status, "amber");
  assert.equal(aggregateChecks([check("grey")]).status, "grey");
});

test("missing evidence is amber and zero games never become full media coverage", () => {
  const row = snapshot({}, 0);
  assert.equal(row.gameCount, 0);
  assert.equal(row.checks["front-covers"].status, "amber");
  assert.equal(row.categories.media.passed, 0);
  assert.equal(row.overall.status, "amber");
  assert.equal(row.checks["settings-navigation"].applicable, false);
  assert.equal(row.checks["settings-navigation"].status, "grey");
  assert.equal(snapshot().gameCount, null);
});

test("a critical runtime failure is red overall, while a coverage failure is amber overall", () => {
  const missing = snapshot({ "emulator-installed": observed("red", "Executable is absent.") });
  assert.equal(missing.categories.launch.status, "red");
  assert.equal(missing.overall.status, "red");
  const coverage = snapshot({ "front-covers": observed("red", "No valid covers.", "0 / 17") }, 17);
  assert.equal(coverage.categories.media.status, "red");
  assert.equal(coverage.overall.status, "amber");
  assert.match(coverage.checks["front-covers"].evidence, /0 \/ 17/);
});

test("installed and verified are separate checks with traceable source and repair information", () => {
  const installed = observed("green", "Installed executable is present.", "fixture.exe");
  const row = snapshot({ "emulator-installed": installed, "default-runtime": observed("amber", "Multiple configured runtimes.") });
  assert.equal(row.checks["emulator-installed"].status, "green");
  assert.equal(row.checks["emulator-verification"].status, "amber");
  assert.equal(row.checks["emulator-verification"].destination, "emulators");
  assert.equal(row.checks["emulator-verification"].platformId, platform.id);
  assert.equal(row.checks["emulator-verification"].evaluatedAt, "1970-01-01T00:00:00.000Z");
  const verified = snapshot({ "emulator-installed": installed, "emulator-verification": observed("green", "Recorded successful verification.") });
  assert.equal(verified.checks["emulator-verification"].status, "green");
  assert.equal(verified.checks["launch-test"].status, "amber");
});

test("insertion animation readiness reflects a configured runtime route", () => {
  const configured = evaluateReadiness({
    evaluatedAt: 0,
    platforms: [{ platform: { ...platform, id: "snes" } }],
  }).platforms[0];
  assert.equal(configured.checks["insertion-animation"].status, "green");
  assert.match(configured.checks["insertion-animation"].explanation, /visual acceptance is recorded separately/);

  const unsupported = evaluateReadiness({
    evaluatedAt: 0,
    platforms: [{ platform: { ...platform, id: "computer" } }],
  }).platforms[0];
  assert.equal(unsupported.checks["insertion-animation"].status, "amber");
});

test("all nine groups evaluate stable unique check IDs for 100 platforms", t => {
  const ids = readinessCategories.flatMap(category => category.checks.map(check => check.id));
  assert.equal(readinessCategories.length, 9);
  assert.equal(new Set(ids).size, ids.length);
  const snapshot = evaluateReadiness({
    evaluatedAt: Date.now(),
    platforms: Array.from({ length: 100 }, (_, i) => ({ platform: { ...platform, id: `test-${i}` }, gameCount: i })),
  });
  assert.equal(snapshot.platforms.length, 100);
  assert.ok(snapshot.platforms.every(row => Object.keys(row.checks).length === ids.length));
  t.diagnostic(`Evaluated 100 platforms × ${ids.length} checks in ${snapshot.evaluationMs.toFixed(1)} ms`);
});
