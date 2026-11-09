import { actionArtwork } from "./bottom-nav.js";
import { appKeyboardAction } from "./app-controller-mappings.js";
import { inputModeEvent } from "./input-mode.js";
import "./platform-filters.css";

const facets = [
  ["kind", "Platform Type", "▣", "All Platforms"],
  ["maker", "Manufacturer", "◇", "All Manufacturers"],
  ["genre", "Genre", "♧", "All Genres"],
  ["decade", "Decade", "▦", "All Decades"],
];
const kinds = new Map([["console", "Console"], ["handheld", "Handheld"], ["hybrid", "Hybrid"], ["arcade", "Arcade"], ["computer", "Computer"]]);
const decadeOf = platform => /^\d{4}$/.test(platform.year) ? `${Math.floor(Number(platform.year) / 10) * 10}s` : "";
const labelFor = (key, value) => key === "kind" ? kinds.get(value) ?? value : value;

export function matchesPlatformFilters(platform, filters, genres) {
  return (!filters.kind || platform.kind === filters.kind) &&
    (!filters.maker || platform.maker === filters.maker) &&
    (!filters.decade || decadeOf(platform) === filters.decade) &&
    (!filters.genre || genres[platform.id]?.includes(filters.genre));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function filterIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const path = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "pf-icon");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", "M3 4h18l-7 8v6l-4 2v-8z");
  svg.append(path);
  return svg;
}

export function mountPlatformFilters({ getPlatforms, getFilters, onApply, loadGenres }) {
  const dialog = element("dialog", "platform-filters");
  dialog.setAttribute("aria-labelledby", "platform-filters-title");
  const header = element("header", "pf-header");
  const title = element("h2", "", "Filters");
  title.id = "platform-filters-title";
  const position = element("span", "pf-position");
  header.append(filterIcon(), title, position);
  const groups = element("div", "pf-groups");
  const status = element("p", "pf-status");
  status.setAttribute("role", "status");
  const footer = element("footer", "pf-footer");
  const previous = command("Previous group", "previous-filter", () => moveGroup(-1));
  const next = command("Next group", "next-filter", () => moveGroup(1));
  const apply = command("Apply", "select", () => finish(true));
  const cancel = command("Cancel", "escape", () => finish(false));
  const clear = command("Clear all filters", "clear-filters", clearFilters);
  footer.append(previous, next, clear, apply, cancel);
  dialog.append(header, groups, status, footer);
  const bar = element("div", "platform-filter-chips");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Filters applied");
  document.body.append(dialog, bar);
  let draft;
  let activeGroup = 0;
  let opener;
  let request = 0;
  let genres = {};

  function command(label, action, activate) {
    const button = element("button", "pf-command");
    button.type = "button";
    button.dataset.action = action;
    button.append(element("img"), element("span", "", label));
    button.firstChild.alt = "";
    button.addEventListener("click", activate);
    return button;
  }

  function syncArtwork() {
    for (const button of footer.children) {
      const { source } = actionArtwork(button.dataset.action);
      button.firstChild.hidden = !source;
      if (source) button.firstChild.src = source;
    }
  }

  function optionsFor(key, platforms) {
    if (key === "kind") return [...kinds.keys()];
    const values = platforms.flatMap(platform =>
      key === "genre" ? genres[platform.id] ?? [] : key === "decade" ? decadeOf(platform) : platform.maker);
    if (key === "decade") values.push("2010s", "2020s");
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function render() {
    const platforms = getPlatforms();
    groups.replaceChildren(...facets.map(([key, name, icon, all]) => {
      const field = element("fieldset", "pf-group");
      field.append(element("legend", "", `${icon}  ${name}`));
      const list = element("div", "pf-options");
      const values = optionsFor(key, platforms);
      if (draft[key] && !values.includes(draft[key])) values.push(draft[key]);
      for (const value of ["", ...values]) {
        const row = element("label", "pf-option");
        const radio = element("input");
        radio.type = "radio";
        radio.name = `pf-${key}`;
        radio.value = value;
        radio.checked = value === (draft[key] ?? "");
        radio.addEventListener("change", () => {
          if (value) draft[key] = value;
          else delete draft[key];
        });
        row.append(radio, element("span", "", value ? labelFor(key, value) : all));
        list.append(row);
      }
      field.append(list);
      return field;
    }));
    updateGroup();
  }

  function updateGroup(focus = false) {
    position.textContent = `${activeGroup + 1} / ${facets.length}`;
    [...groups.children].forEach((group, index) => group.classList.toggle("pf-active", index === activeGroup));
    if (focus) groups.children[activeGroup]?.querySelector("input:checked")?.focus();
  }

  function moveGroup(step) {
    activeGroup = (activeGroup + step + facets.length) % facets.length;
    updateGroup(true);
  }

  function moveOption(step) {
    const options = [...groups.children[activeGroup].querySelectorAll("input")];
    const current = options.findIndex(option => option.checked);
    const option = options[(current + step + options.length) % options.length];
    option.click();
    option.focus();
  }

  function finish(accepted) {
    if (accepted) onApply(draft, genres);
    dialog.close();
  }

  function clearFilters() {
    draft = {};
    render();
    status.textContent = "All filters cleared. Apply to update the platform rail.";
  }

  function renderChips() {
    const filters = getFilters();
    const chips = facets.filter(([key]) => filters[key]).map(([key, label]) => {
      const value = labelFor(key, filters[key]);
      const chip = element("button", "pf-chip", `${value}  ×`);
      chip.type = "button";
      chip.setAttribute("aria-label", `Remove ${label} filter ${value}`);
      chip.addEventListener("click", () => {
        const next = { ...getFilters() };
        delete next[key];
        onApply(next, genres);
        (bar.querySelector("button") ?? document.querySelector('[data-nav-action="filters"]'))?.focus();
      });
      return chip;
    });
    bar.hidden = !chips.length;
    bar.replaceChildren(filterIcon(), element("strong", "", "Filters Applied"), ...chips);
  }

  async function open() {
    if (dialog.open) return;
    const version = ++request;
    opener = document.activeElement;
    draft = { ...getFilters() };
    activeGroup = 0;
    status.textContent = "Checking cached game genres…";
    render();
    syncArtwork();
    dialog.showModal();
    updateGroup(true);
    try {
      const availableGenres = await loadGenres();
      if (!dialog.open || version !== request) return;
      genres = availableGenres;
      const restoreGroupFocus = groups.contains(document.activeElement);
      render();
      if (restoreGroupFocus) updateGroup(true);
      status.textContent = Object.keys(genres).length
        ? "Genre uses cached metadata for indexed games." : "No cached game genres are available.";
    } catch {
      if (dialog.open && version === request) status.textContent = "Cached game genres could not be read.";
    }
  }

  groups.addEventListener("focusin", event => {
    const index = [...groups.children].indexOf(event.target.closest("fieldset"));
    if (index >= 0) { activeGroup = index; updateGroup(); }
  });
  dialog.addEventListener("close", () => opener?.focus());
  dialog.addEventListener("keydown", event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (["Enter", "Space"].includes(event.code) && event.target.closest("button")) return;
    const action = appKeyboardAction("platform", event.code);
    if (event.code === "ArrowLeft" || action === "previous-filter") moveGroup(-1);
    else if (event.code === "ArrowRight" || action === "next-filter") moveGroup(1);
    else if (action === "clear-filters") clearFilters();
    else if (action === "select") finish(true);
    else if (action === "escape" || action === "filters") finish(false);
    else return;
    event.preventDefault();
  });
  window.addEventListener(inputModeEvent, syncArtwork);
  renderChips();
  return {
    open, renderChips,
    isOpen: () => dialog.open,
    controller(input, action) {
      if (action === "escape" || action === "filters") finish(false);
      else if (action === "select") finish(true);
      else if (action === "clear-filters") clearFilters();
      else if (action === "previous-filter" || input === "left") moveGroup(-1);
      else if (action === "next-filter" || input === "right") moveGroup(1);
      else if (input === "up") moveOption(-1);
      else if (input === "down") moveOption(1);
    },
  };
}
