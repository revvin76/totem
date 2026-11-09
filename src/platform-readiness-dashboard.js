import { loadReadiness, readinessCategories } from "./platform-readiness.js";
import { readinessTarget, settingsIcon } from "./settings-navigation.js";

const statusInfo = {
  green: { label: "Verified", glyph: "✓", help: "The specific condition was confirmed by evidence" },
  amber: { label: "Review", glyph: "!", help: "Evidence is incomplete, absent, stale or unverified" },
  red: { label: "Issue", glyph: "×", help: "Required evidence confirms an issue" },
  grey: { label: "Not applicable", glyph: "−", help: "Explicitly outside the check's scope" },
};
const statusOrder = ["red", "amber", "green", "grey"];
const number = new Intl.NumberFormat();
const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const categoryIcons = [
  "M6 2h8l4 4v14H6z M14 2v5h5 M9 11h6 M9 15h6",
  "M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10",
  "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M10 8l6 4-6 4z",
  "M4 4h16v16H4z M8 9h.1 M5 17l4-4 2 2 4-5 4 7",
];

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}

function button(label, className, activate) {
  const element = node("button", className, label);
  element.type = "button";
  element.addEventListener("click", activate);
  return element;
}

function categoryIcon(index) {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  const path = document.createElementNS(namespace, "path");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  path.setAttribute("d", categoryIcons[index]);
  icon.append(path);
  return icon;
}

function statusDot(status) {
  const dot = node("span", `rd-dot rd-${status}`, statusInfo[status].glyph);
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

function scoreText({ passed, applicable }) {
  return applicable > 0 ? `${passed}/${applicable} checks complete · ${Math.round(100 * passed / applicable)}%` : "";
}

function formatEvidence(value) {
  if (typeof value === "string") return value;
  return value == null ? "" : JSON.stringify(value, null, 2);
}

export function filterAndSortReadiness(platforms, { search = "", type = "", status = "", issuesOnly = false, activeOnly = false, sort = "name", ascending = true } = {}) {
  const query = search.trim().toLowerCase();
  const compare = {
    name: (a, b) => a.name.localeCompare(b.name),
    type: (a, b) => a.type.localeCompare(b.type),
    games: (a, b) => (a.gameCount ?? -1) - (b.gameCount ?? -1),
    status: (a, b) => statusOrder.indexOf(a.overall.status) - statusOrder.indexOf(b.overall.status),
  }[sort];
  return platforms
    .filter(platform => (!type || platform.type === type)
      && (!status || platform.overall.status === status)
      && (!issuesOnly || ["amber", "red"].includes(platform.overall.status))
      && (!activeOnly || platform.active)
      && (!query || `${platform.name} ${platform.id}`.toLowerCase().includes(query)))
    .sort((a, b) => (ascending ? 1 : -1) * compare(a, b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function readinessColumns(categories, expandedId) {
  return categories.flatMap(category => category.id === expandedId
    ? category.checks.map((check, index) => ({
      id: check.id,
      category,
      check,
      expandedClass: `rd-expanded${index === 0 ? " rd-expanded-first" : ""}${index === category.checks.length - 1 ? " rd-expanded-last" : ""}`,
    }))
    : [{ id: category.id, category }]);
}

export function toggleReadinessCategory(expandedId, categoryId) {
  return expandedId === categoryId ? null : categoryId;
}

export function gridNavigationTarget(rows, current, direction) {
  const row = Number(current.dataset.rdRow);
  const column = Number(current.dataset.rdColumn);
  const currentRow = rows[row];
  if (direction === "left" || direction === "right") {
    return currentRow[currentRow.indexOf(current) + (direction === "right" ? 1 : -1)];
  }
  const next = rows[row + (direction === "down" ? 1 : -1)];
  return next?.find(item => {
    const start = Number(item.dataset.rdColumn);
    return start <= column && column < start + Number(item.dataset.rdSpan);
  }) ?? next?.[0];
}

export function mountPlatformReadinessDashboard(root, { onDrillThrough, loadSnapshot = loadReadiness } = {}) {
  root.classList.add("readiness-dashboard");
  const heading = node("h2", "", "Platform Readiness");
  heading.id = "readiness-title";
  root.setAttribute("aria-labelledby", heading.id);
  const title = node("div", "rd-title");
  title.append(heading, node("p", "", "Platform info, models, playback and game artwork"));
  const brandTitle = node("div", "rd-brand-title");
  brandTitle.append(settingsIcon("readiness"), title);
  const summary = node("div", "rd-summary");
  const header = node("header", "rd-header");
  header.append(brandTitle, summary);

  function field(label, input) {
    const wrapper = node("label", "rd-field");
    wrapper.append(node("span", "rd-field-label", label), input);
    return wrapper;
  }
  const search = node("input");
  search.type = "search";
  search.placeholder = "Search platforms…";
  const type = node("select");
  type.add(new Option("All categories", ""));
  const status = node("select");
  status.add(new Option("All statuses", ""));
  for (const key of statusOrder) status.add(new Option(statusInfo[key].label, key));
  const issues = node("input");
  issues.type = "checkbox";
  const issueField = node("label", "rd-issue-filter");
  issueField.append(issues, node("span", "", "Only platforms with issues"));
  const activeOnly = node("input");
  activeOnly.type = "checkbox";
  activeOnly.checked = true;
  const activeField = node("label", "rd-issue-filter");
  activeField.append(activeOnly, node("span", "", "Only platforms on the rail"));
  const refresh = button("Refresh status", "rd-refresh", refreshSnapshot);
  const toolbar = node("div", "rd-toolbar");
  const filterPanel = node("details", "rd-filters");
  filterPanel.open = true;
  const filterToggle = node("summary", "", "Filters");
  const filterFields = node("div", "rd-toolbar");
  filterFields.append(field("Category", type), field("Status", status), issueField, activeField);
  filterPanel.append(filterToggle, filterFields);
  const toolbarControls = [search, filterToggle, type, status, issues, activeOnly, refresh];
  toolbar.append(field("Search platforms", search), filterPanel, refresh);
  const info = node("div", "rd-info");
  const timestamp = node("time");
  const liveStatus = node("span", "rd-live");
  liveStatus.setAttribute("role", "status");
  const warning = node("p", "rd-warning");
  warning.hidden = true;
  info.append(liveStatus, timestamp, warning);

  const viewport = node("div", "rd-viewport");
  const table = node("table", "rd-matrix");
  table.setAttribute("aria-label", "Platform readiness matrix");
  table.setAttribute("aria-describedby", "readiness-instructions");
  viewport.append(table);
  const inspector = node("section", "rd-inspector");
  inspector.setAttribute("aria-label", "Selected platform readiness");
  inspector.hidden = true;
  const legend = node("footer", "rd-legend");
  const instructions = node("p", "", "Expand a category in the matrix. Select a status for evidence and repair options. Use the arrow keys to move between cells.");
  instructions.id = "readiness-instructions";
  legend.append(instructions);
  for (const [key, { label, help }] of Object.entries(statusInfo)) {
    const entry = node("span", "rd-legend-entry");
    entry.title = help;
    entry.append(statusDot(key), document.createTextNode(label));
    legend.append(entry);
  }

  const diagnostics = node("dialog", "rd-diagnostics");
  diagnostics.addEventListener("cancel", event => {
    event.preventDefault();
    cancel();
  });
  diagnostics.setAttribute("aria-labelledby", "readiness-diagnostics-title");
  diagnostics.addEventListener("close", () => {
    if (restoreAfterClose && !root.hidden) {
      if (inspectorTrigger?.isConnected) inspectorTrigger.focus();
      else restoreFocus();
    }
    inspectorTrigger = null;
  });
  const matrixPanel = node("section", "rd-matrix-panel");
  matrixPanel.append(header, toolbar, info, viewport);
  root.replaceChildren(matrixPanel, inspector, legend, diagnostics);

  let snapshot;
  let expandedId = null;
  let sort = "name";
  let ascending = true;
  let gridRows = [];
  let gridEntry;
  let lastGridKey;
  let originCellKey;
  let selectedPlatform;
  let inspectorTrigger;
  let restoreAfterClose = true;
  let adjustingSelect;
  let pending;
  let duration = 0;
  let showingDiagnostics = null;
  let visiblePlatforms = [];
  let visibleColumns = [];

  function drawSummary(platforms) {
    const counts = { green: 0, amber: 0, red: 0, grey: 0 };
    for (const { overall } of platforms) counts[overall.status]++;
    const cards = snapshot.browserPreview ? [[null, "Bundled platforms", platforms.length]] : [
      [null, "Total platforms", platforms.length],
      ["green", "Fully verified", counts.green],
      ["amber", "Needs review", counts.amber],
      ["red", "With confirmed issues", counts.red],
    ];
    summary.replaceChildren(...cards.map(([key, label, count]) => {
      const card = node("div", `rd-summary-card${key ? ` rd-summary-${key}` : ""}`);
      card.append(key ? statusDot(key) : settingsIcon("readiness"));
      const value = node("span");
      value.append(node("strong", "", number.format(count)), node("small", "", label));
      card.append(value);
      return card;
    }));
  }

  function updateFilters(platforms) {
    const chosenType = type.value;
    const categories = [...new Set(platforms.map(platform => platform.type))].sort((a, b) => a.localeCompare(b));
    type.replaceChildren(new Option("All categories", ""), ...categories.map(value => new Option(value, value)));
    if (categories.includes(chosenType)) type.value = chosenType;
  }

  function refreshSnapshot() {
    if (pending) return pending;
    refresh.setAttribute("aria-disabled", "true");
    refresh.textContent = "Refreshing…";
    viewport.setAttribute("aria-busy", "true");
    liveStatus.textContent = "Evaluating platform evidence…";
    pending = Promise.resolve().then(loadSnapshot).then(next => {
      snapshot = next;
      const date = new Date(snapshot.evaluatedAt);
      timestamp.dateTime = snapshot.evaluatedAt;
      timestamp.textContent = `Last evaluated ${date.toLocaleString()}`;
      warning.textContent = snapshot.warnings?.join(" · ") ?? "";
      warning.hidden = !warning.textContent;
      drawSummary(snapshot.platforms);
      updateFilters(snapshot.platforms);
      renderMatrix();
    }).catch(error => {
      warning.hidden = false;
      warning.textContent = `${snapshot ? "Refresh failed. Showing the previous evaluation." : "Readiness evidence unavailable."} ${String(error?.message ?? error)}`;
      liveStatus.textContent = "Evaluation unavailable";
    }).finally(() => {
      pending = null;
      refresh.removeAttribute("aria-disabled");
      refresh.textContent = "Refresh status";
      viewport.removeAttribute("aria-busy");
    });
    return pending;
  }

  function markGridButton(element, key, row, column, span = 1) {
    element.tabIndex = -1;
    element.dataset.rdKey = key;
    element.dataset.rdRow = row;
    element.dataset.rdColumn = column;
    element.dataset.rdSpan = span;
    gridRows[row].push(element);
    return element;
  }

  function sortHeader(label, key, column, className) {
    const cell = node("th", className);
    cell.scope = "col";
    cell.rowSpan = 2;
    if (key === sort) cell.setAttribute("aria-sort", ascending ? "ascending" : "descending");
    const control = button(`${label} ${key === sort ? ascending ? "↑" : "↓" : "↕"}`, "rd-sort", () => {
      ascending = key === sort ? !ascending : key !== "games";
      sort = key;
      renderMatrix();
    });
    control.title = `Sort by ${label.toLowerCase()}`;
    cell.append(markGridButton(control, `sort:${key}`, 0, column));
    return cell;
  }

  function buildHeader(columns) {
    const header = node("thead");
    const top = node("tr");
    const bottom = node("tr");
    top.append(
      sortHeader("Platform", "name", 0, "rd-pin rd-platform"),
      sortHeader("Category", "type", 1, "rd-pin rd-type"),
      sortHeader("Games", "games", 2, "rd-pin rd-games"),
      sortHeader("Overall", "status", 3, "rd-pin rd-overall"),
    );
    let columnIndex = 4;
    readinessCategories.forEach((category, index) => {
      const expanded = expandedId === category.id;
      const group = node("th", expanded ? "rd-group rd-expanded rd-expanded-first rd-expanded-last" : "rd-category");
      group.scope = expanded ? "colgroup" : "col";
      group.rowSpan = expanded ? 1 : 2;
      group.colSpan = expanded ? category.checks.length : 1;
      const control = button("", "rd-category-button", () => {
        expandedId = toggleReadinessCategory(expandedId, category.id);
        renderMatrix();
      });
      control.setAttribute("aria-expanded", String(expanded));
      control.append(categoryIcon(index), node("span", "", category.label), node("span", "rd-caret", expanded ? "⌃" : "⌄"));
      control.lastElementChild.setAttribute("aria-hidden", "true");
      group.append(markGridButton(control, `category:${category.id}`, 0, columnIndex, group.colSpan));
      top.append(group);
      columnIndex += group.colSpan;
    });
    for (const { check, expandedClass } of columns) {
      if (!check) continue;
      const label = node("th", `rd-check ${expandedClass}`, check.label);
      label.scope = "col";
      bottom.append(label);
    }
    header.append(top, bottom);
    return header;
  }

  function buildColumnGroups() {
    const pinned = node("colgroup");
    for (const key of ["platform", "type", "games", "overall"]) {
      pinned.append(node("col", `rd-col-${key}`));
    }
    return [pinned, ...readinessCategories.map(category => {
      const expanded = expandedId === category.id;
      const group = node("colgroup");
      const column = node("col", expanded ? "rd-col-expanded" : "rd-col-category");
      column.span = expanded ? category.checks.length : 1;
      group.append(column);
      return group;
    })];
  }

  function statusCell(platform, result, label, key, row, column, className) {
    const cell = node("td", className);
    const status = result.status;
    const score = typeof result.applicable === "number" ? scoreText(result) : "";
    const control = node("button", "rd-cell-button");
    control.type = "button";
    control.title = [label, statusInfo[status].label, score, result.explanation].filter(Boolean).join(" · ");
    control.setAttribute("aria-label", `${platform.name}, ${control.title}`);
    control.append(statusDot(status));
    if (className.includes("rd-overall") && result.applicable > 0) {
      control.append(node("span", "rd-score", `${Math.round(100 * result.passed / result.applicable)}%`));
    }
    cell.append(markGridButton(control, `${platform.id}:${key}`, row, column));
    return cell;
  }

  function platformMark(platform) {
    const monogram = node("span", "rd-monogram", platform.name.trim().slice(0, 2).toUpperCase());
    monogram.setAttribute("aria-hidden", "true");
    if (!platform.logo) return monogram;
    const image = node("img", "rd-logo");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.replaceWith(monogram), { once: true });
    image.src = platform.logo;
    return image;
  }

  function selectPlatform(platform) {
    if (platform.id === selectedPlatform) return;
    selectedPlatform = platform.id;
    table.querySelector(".rd-selected")?.classList.remove("rd-selected");
    findGridButton(`${platform.id}:platform`)?.closest("tr").classList.add("rd-selected");
    drawInspector(platform);
  }

  function buildRow(platform, columns, row) {
    const tr = node("tr");
    tr.dataset.platform = platform.id;
    if (platform.id === selectedPlatform) tr.classList.add("rd-selected");
    const platformCell = node("th", "rd-pin rd-platform");
    platformCell.scope = "row";
    const identity = button("", "rd-identity", () => selectPlatform(platform));
    identity.setAttribute("aria-label", `Show readiness for ${platform.name}`);
    identity.append(platformMark(platform), node("span", "", platform.name));
    platformCell.append(markGridButton(identity, `${platform.id}:platform`, row, 0));
    tr.append(
      platformCell,
      node("td", "rd-pin rd-type", platform.type),
      node("td", "rd-pin rd-games", platform.gameCount == null ? "—" : number.format(platform.gameCount)),
      statusCell(platform, platform.overall, "Overall", "overall", row, 3, "rd-pin rd-overall"),
    );
    columns.forEach(({ id, category, check, expandedClass }, index) => {
      const result = check ? platform.checks[check.id] : platform.categories[category.id];
      tr.append(statusCell(platform, result, check?.label ?? category.label, id, row, index + 4, expandedClass ?? ""));
    });
    return tr;
  }

  function drawInspector(platform) {
    inspector.hidden = !platform;
    if (!platform) { inspector.replaceChildren(); return; }
    const header = node("header", "rd-inspector-header");
    const identity = node("div", "rd-inspector-identity");
    const copy = node("div");
    copy.append(node("h3", "", platform.name), node("small", "", [
      platform.type,
      platform.gameCount == null ? "" : `${number.format(platform.gameCount)} games`,
    ].filter(Boolean).join(" · ")));
    identity.append(platformMark(platform), copy);
    header.append(identity, resultBadge(platform.overall), node("small", "rd-inspector-score", scoreText(platform.overall)));
    const list = node("div", "rd-inspector-list");
    readinessCategories.forEach((category, index) => {
      const result = platform.categories[category.id];
      const row = button("", "rd-inspector-row", () => {
        inspectorTrigger = row;
        showDiagnostics(platform, category);
      });
      const progress = node("progress", `rd-progress rd-progress-${result.status}`);
      progress.max = result.applicable || 1;
      progress.value = result.passed;
      progress.setAttribute("aria-hidden", "true");
      const arrow = node("span", "rd-inspector-arrow", "›");
      arrow.setAttribute("aria-hidden", "true");
      row.append(categoryIcon(index), node("strong", "", category.label),
        node("span", "rd-inspector-description", category.checks.map(check => check.label).join(" · ")),
        node("span", "rd-inspector-count", result.applicable ? `${result.passed} / ${result.applicable}` : "—"),
        progress, resultBadge(result), arrow);
      list.append(row);
    });
    inspector.replaceChildren(header, list);
  }

  function resultBadge(result) {
    const badge = node("span", `rd-badge rd-badge-${result.status}`);
    badge.append(statusDot(result.status), document.createTextNode(statusInfo[result.status].label));
    return badge;
  }

  function renderMatrix() {
    if (!snapshot) return;
    const start = performance.now();
    const active = table.contains(document.activeElement) ? document.activeElement.dataset.rdKey : null;
    const platforms = filterAndSortReadiness(snapshot.platforms, {
      search: search.value, type: type.value, status: status.value, issuesOnly: issues.checked,
      activeOnly: activeOnly.checked, sort, ascending,
    });
    const columns = readinessColumns(readinessCategories, expandedId);
    const inspected = platforms.find(platform => platform.id === selectedPlatform) ?? platforms[0];
    selectedPlatform = inspected?.id;
    drawInspector(inspected);
    visiblePlatforms = platforms;
    visibleColumns = columns;
    gridRows = Array.from({ length: platforms.length + 1 }, () => []);
    const thead = buildHeader(columns);
    const tbody = node("tbody");
    platforms.forEach((platform, index) => tbody.append(buildRow(platform, columns, index + 1)));
    if (!platforms.length) {
      const row = node("tr");
      const cell = node("td", "rd-empty", "No platforms match these filters.");
      cell.colSpan = 4 + columns.length;
      row.append(cell);
      tbody.append(row);
    }
    const expandedCount = columns.filter(column => column.check).length;
    table.style.setProperty("--rd-collapsed-count", columns.length - expandedCount);
    table.style.setProperty("--rd-expanded-count", expandedCount);
    table.replaceChildren(...buildColumnGroups(), thead, tbody);
    table.dataset.expanded = expandedId ?? "";
    gridEntry = findGridButton(active ?? lastGridKey) ?? gridRows[0][0];
    gridEntry.tabIndex = 0;
    if (active) focusGrid(gridEntry);
    liveStatus.textContent = `${number.format(platforms.length)} of ${number.format(snapshot.platforms.length)} platforms`;
    duration = performance.now() - start;
  }

  function findGridButton(key) {
    if (!key) return null;
    for (const row of gridRows) {
      const target = row.find(control => control.dataset.rdKey === key);
      if (target) return target;
    }
    return null;
  }

  function scrollGridButton(target) {
    const viewportRect = viewport.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (!target.parentElement.classList.contains("rd-pin")) {
      const pinned = table.tHead.rows[0].cells[3].getBoundingClientRect();
      const left = Math.max(viewportRect.left, pinned.right);
      const right = viewportRect.left + viewport.clientWidth;
      if (rect.left < left || rect.width >= right - left) viewport.scrollLeft += rect.left - left;
      else if (rect.right > right) viewport.scrollLeft += rect.right - right;
    }
    if (target.closest("tbody")) {
      const top = table.tHead.getBoundingClientRect().bottom;
      const bottom = viewportRect.top + viewport.clientHeight;
      if (rect.top < top) viewport.scrollTop += rect.top - top;
      else if (rect.bottom > bottom) viewport.scrollTop += rect.bottom - bottom;
    }
  }

  function focusGrid(target) {
    if (!target) return false;
    target.focus({ preventScroll: true });
    scrollGridButton(target);
    return true;
  }

  function restoreFocus(key = originCellKey, scroll) {
    if (scroll) [viewport.scrollLeft, viewport.scrollTop] = scroll;
    const exact = findGridButton(key);
    if (exact) return focusGrid(exact);
    const platformId = key?.split(":")[0];
    const nearest = findGridButton(`${platformId}:platform`);
    if (!focusGrid(nearest)) search.focus();
    if (key) liveStatus.textContent = nearest
      ? "The original readiness cell is unavailable. Focus returned to its platform."
      : "The original readiness platform is unavailable in this view. Focus returned to search.";
  }

  function buildDiagnosticLine(parent, title, content) {
    if (!content) return;
    parent.append(node("dt", "", title), node("dd", "", content));
  }

  function showDiagnostics(platform, category, check, preserveOrigin = false) {
    if (!preserveOrigin) {
      originCellKey = `${platform.id}:${check?.id ?? category?.id ?? "overall"}`;
      selectPlatform(platform);
    }
    showingDiagnostics = { platform, category, check };
    const result = check ? platform.checks[check.id] : category ? platform.categories[category.id] : platform.overall;
    const title = node("h3", "", platform.name);
    title.id = "readiness-diagnostics-title";
    const header = node("header", "rd-diagnostics-header");
    const close = button("Close", "rd-diagnostics-close", () => closeDiagnostics());
    close.autofocus = true;
    header.append(title, close);
    const content = node("div", "rd-diagnostics-content");
    const subject = node("h4", "", check ? `${category.label} / ${check.label}` : category?.label ?? "Overall readiness");
    const badge = node("p", "rd-diagnostics-badge");
    badge.append(statusDot(result.status), document.createTextNode(statusInfo[result.status].label));
    content.append(subject, badge);

    if (check) {
      const details = node("dl", "rd-evidence");
      buildDiagnosticLine(details, "Assessment", result.explanation);
      buildDiagnosticLine(details, "Evidence", formatEvidence(result.evidence));
      buildDiagnosticLine(details, "Diagnostics", formatEvidence(result.diagnostics ?? result.details));
      buildDiagnosticLine(details, "Evaluated", result.evaluatedAt ? new Date(result.evaluatedAt).toLocaleString() : "");
      buildDiagnosticLine(details, "Applicability", result.status === "grey" ? "Not applicable" : result.required ? "Required" : "Optional");
      const target = readinessTarget(check.id);
      buildDiagnosticLine(details, "Settings", target.note);
      content.append(details);
      if (target.section && onDrillThrough) {
        const repair = button(target.label, "rd-repair", () => {
          const origin = {
            section: "readiness", platformId: platform.id, checkId: check.id,
            focusKey: originCellKey, scroll: [viewport.scrollLeft, viewport.scrollTop],
          };
          closeDiagnostics(false);
          const opened = onDrillThrough({ origin, destination: { ...target, platformId: platform.id } });
          if (opened === false) restoreFocus();
        });
        content.append(repair);
      }
      if (preserveOrigin) content.append(button("Back to summary", "rd-diagnostics-back", () => showDiagnostics(platform, category, null, true)));
    } else {
      const score = scoreText(result);
      if (score) content.append(node("p", "rd-diagnostics-score", score));
      const list = node("ul", "rd-diagnostics-list");
      for (const group of category ? [category] : readinessCategories) {
        const entries = category ? group.checks : [group];
        for (const entry of entries) {
          const summary = category ? platform.checks[entry.id] : platform.categories[group.id];
          const item = node("li");
          const control = button("", "rd-evidence-choice", () => showDiagnostics(platform, group, category ? entry : null, true));
          control.append(statusDot(summary.status), node("span", "", entry.label), node("small", "", statusInfo[summary.status].label));
          item.append(control);
          list.append(item);
        }
      }
      content.append(list);
      if (preserveOrigin) content.append(button("Back to overall", "rd-diagnostics-back", () => showDiagnostics(platform, null, null, true)));
    }
    diagnostics.replaceChildren(header, content);
    restoreAfterClose = true;
    if (!diagnostics.open) diagnostics.showModal();
    close.focus();
  }

  function closeDiagnostics(restore = true) {
    if (!diagnostics.open) return false;
    restoreAfterClose = restore;
    showingDiagnostics = null;
    diagnostics.close();
    return true;
  }

  function exitSelectAdjustment() {
    if (!adjustingSelect) return false;
    delete adjustingSelect.dataset.adjusting;
    adjustingSelect = null;
    liveStatus.textContent = `${number.format(table.tBodies[0]?.querySelectorAll("[data-platform]").length ?? 0)} of ${number.format(snapshot?.platforms.length ?? 0)} platforms`;
    return true;
  }

  function moveFocus(direction) {
    const active = document.activeElement;
    const forwards = direction === "right" || direction === "down";
    if (diagnostics.open) {
      const controls = [...diagnostics.querySelectorAll("button")];
      const next = controls[controls.indexOf(active) + (forwards ? 1 : -1)];
      if (next) next.focus();
      else diagnostics.querySelector(".rd-diagnostics-content").scrollTop += forwards ? 120 : -120;
      return true;
    }
    if (adjustingSelect && adjustingSelect === active) {
      const next = Math.min(active.options.length - 1, Math.max(0, active.selectedIndex + (forwards ? 1 : -1)));
      if (next !== active.selectedIndex) {
        active.selectedIndex = next;
        active.dispatchEvent(new Event("change"));
      }
      liveStatus.textContent = `${active.options[next].text}. Confirm to finish adjusting.`;
      return true;
    }
    if (active?.dataset.rdKey) {
      if (focusGrid(gridNavigationTarget(gridRows, active, direction))) return true;
      if (direction === "up" && active.dataset.rdRow === "0") {
        toolbarControls.at(-1).focus();
        return true;
      }
      return false;
    }
    if (inspector.contains(active) && (direction === "up" || direction === "down")) {
      const rows = [...inspector.querySelectorAll("button")];
      const next = rows[rows.indexOf(active) + (forwards ? 1 : -1)];
      if (next) { next.focus(); return true; }
      if (!forwards) return focusGrid(findGridButton(`${selectedPlatform}:platform`) ?? gridEntry);
      return false;
    }
    const visibleControls = toolbarControls.filter(control => control.getClientRects().length);
    const index = visibleControls.indexOf(active);
    if (index < 0) return false;
    if (direction === "down") return focusGrid(gridEntry);
    if (direction === "up") return false;
    const next = visibleControls[index + (forwards ? 1 : -1)];
    if (!next) return false;
    next.focus();
    return true;
  }

  function confirm() {
    const active = document.activeElement;
    if (!root.contains(active)) return false;
    if (active === type || active === status) {
      if (!exitSelectAdjustment()) {
        adjustingSelect = active;
        active.dataset.adjusting = "";
        liveStatus.textContent = "Use the directional controls to select an option. Confirm to finish.";
      }
    } else if (active === search) {
      if (!focusGrid(gridEntry)) refresh.focus();
    } else if (active?.matches("button, summary, input[type=checkbox]")) active.click();
    else return false;
    return true;
  }

  function cancel() {
    if (diagnostics.open && showingDiagnostics?.check) {
      const { platform, category } = showingDiagnostics;
      if (diagnostics.querySelector(".rd-diagnostics-back")) {
        showDiagnostics(platform, category, null, true);
        return true;
      }
    }
    return closeDiagnostics() || exitSelectAdjustment();
  }

  for (const control of [search, type, status, issues, activeOnly]) {
    control.addEventListener(control === search ? "input" : "change", renderMatrix);
  }
  table.addEventListener("focusin", event => {
    if (!event.target.dataset.rdKey) return;
    if (gridEntry) gridEntry.tabIndex = -1;
    gridEntry = event.target;
    gridEntry.tabIndex = 0;
    lastGridKey = gridEntry.dataset.rdKey;
  });
  table.addEventListener("click", event => {
    const control = event.target.closest(".rd-cell-button");
    if (!control) return;
    const platform = visiblePlatforms[Number(control.dataset.rdRow) - 1];
    const column = visibleColumns[Number(control.dataset.rdColumn) - 4];
    showDiagnostics(platform, column?.category, column?.check);
  });
  root.addEventListener("focusout", event => {
    if (event.target === adjustingSelect) exitSelectAdjustment();
  });
  root.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (arrows[event.key] && (event.target.dataset.rdKey || diagnostics.open) && moveFocus(arrows[event.key])) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  return {
    open({ newSession = false } = {}) {
      if (newSession) {
        expandedId = null;
        selectedPlatform = originCellKey = null;
        viewport.scrollLeft = viewport.scrollTop = 0;
        renderMatrix();
      }
      return newSession || !snapshot ? refreshSnapshot() : Promise.resolve();
    },
    closeDiagnostics, restoreFocus, moveFocus, confirm, cancel,
    platformChecks(id) { return snapshot?.platforms.find(({ id: platformId }) => platformId === id)?.checks; },
    get renderDurationMs() { return duration; },
  };
}
