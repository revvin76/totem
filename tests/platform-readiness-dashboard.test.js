import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortReadiness, gridNavigationTarget, readinessColumns, toggleReadinessCategory } from "../src/platform-readiness-dashboard.js";
import { readinessCategories } from "../src/platform-readiness.js";

test("only the selected category expands at its original position, preserving full check headings", () => {
  const categoryIds = readinessCategories.map(({ id }) => id);
  let expanded = null;
  const columns = () => readinessColumns(readinessCategories, expanded);
  assert.deepEqual(columns().map(({ id }) => id), categoryIds);

  expanded = toggleReadinessCategory(expanded, "game-artwork");
  const artwork = readinessCategories.find(({ id }) => id === "game-artwork");
  const artworkColumns = columns();
  const artworkStart = categoryIds.indexOf(artwork.id);
  assert.deepEqual(artworkColumns.slice(artworkStart, artworkStart + artwork.checks.length).map(({ check }) => check), artwork.checks);
  assert.equal(artworkColumns[artworkStart].check.label, "Front Covers");
  assert.equal(artworkColumns[artworkStart].check.destination, "game-artwork");
  assert.deepEqual(artworkColumns.slice(artworkStart + artwork.checks.length).map(({ id }) => id), categoryIds.slice(artworkStart + 1));

  expanded = toggleReadinessCategory(expanded, "metadata");
  const metadata = readinessCategories.find(({ id }) => id === "metadata");
  assert.deepEqual(columns().filter(({ check }) => check).map(({ check }) => check), metadata.checks);
  assert.equal(columns()[metadata.checks.length].id, categoryIds[1]);

  expanded = toggleReadinessCategory(expanded, "metadata");
  assert.deepEqual(columns().map(({ id }) => id), categoryIds);
});

test("grid navigation moves across a category span and retains column alignment between platforms", () => {
  const control = (rdRow, rdColumn, rdSpan = 1) => ({ dataset: { rdRow, rdColumn, rdSpan } });
  const headers = [control(0, 3), control(0, 4, 3), control(0, 7)];
  const first = [3, 4, 5, 6, 7].map(column => control(1, column));
  const second = [3, 4, 5, 6, 7].map(column => control(2, column));
  const grid = [headers, first, second];
  assert.equal(gridNavigationTarget(grid, headers[1], "down"), first[1]);
  assert.equal(gridNavigationTarget(grid, first[3], "up"), headers[1]);
  assert.equal(gridNavigationTarget(grid, first[3], "down"), second[3]);
  assert.equal(gridNavigationTarget(grid, first[3], "right"), first[4]);
  assert.equal(gridNavigationTarget(grid, first[0], "left"), undefined);
});

test("filters use loaded platform evidence and can sort without changing the original rows", () => {
  const platform = (id, name, type, gameCount, status) => ({ id, name, type, gameCount, overall: { status } });
  const platforms = [
    platform("ps2", "PlayStation 2", "console", 12, "amber"),
    platform("gba", "Game Boy Advance", "handheld", 5, "green"),
    platform("ps3", "PlayStation 3", "console", 1, "red"),
    platform("out-of-scope", "Outside scope", "computer", null, "grey"),
  ];
  const ids = rows => rows.map(({ id }) => id);
  assert.deepEqual(ids(filterAndSortReadiness(platforms, { search: " Playstation ", type: "console", issuesOnly: true, sort: "games" })), ["ps3", "ps2"]);
  assert.deepEqual(ids(filterAndSortReadiness(platforms, { status: "grey" })), ["out-of-scope"]);
  assert.deepEqual(ids(filterAndSortReadiness(platforms, { sort: "status" })), ["ps3", "ps2", "gba", "out-of-scope"]);
  assert.deepEqual(ids(platforms), ["ps2", "gba", "ps3", "out-of-scope"]);
});
