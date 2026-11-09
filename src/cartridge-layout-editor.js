const fields = [
  ["scale", "Scale", 0.05, 2, 0.05, 0.34],
  ["x", "Horizontal offset", -10, 10, 0.1, 0],
  ["y", "Vertical offset", -10, 10, 0.1, 0.62],
  ["z", "Depth offset", -10, 10, 0.1, 0.22],
  ["pitch", "Pitch (°)", -180, 180, 1, 0],
  ["yaw", "Yaw (°)", -180, 180, 1, 0],
  ["roll", "Roll (°)", -180, 180, 1, 0],
];
const neutral = Object.fromEntries(fields.map(([key, , , , , value]) => [key, value]));
const storageKey = "totem.game-selection.cartridge-layout.v1";

export function mountCartridgeLayoutEditor({ getGame, onChange }) {
  const form = document.getElementById("cartridge-layout-editor");
  const toggle = document.getElementById("cartridge-layout-toggle");
  const scope = form.elements.scope;
  const status = form.querySelector("output");
  let saved = { default: { ...neutral }, games: {} };
  let draft = null;
  let currentGameId = null;
  let saving = false;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (parsed && typeof parsed === "object") {
      saved = {
        default: { ...neutral, ...(parsed.default ?? {}) },
        games: parsed.games && typeof parsed.games === "object" ? parsed.games : {},
      };
    }
  } catch { /* Use the shipped cartridge pose. */ }

  const inputs = new Map(fields.map(([key, caption, min, max]) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number"; input.name = key; input.min = min; input.max = max;
    input.step = "any"; input.required = true;
    label.append(caption, input);
    form.querySelector(".cartridge-layout-fields").append(label);
    return [key, input];
  }));

  function effective(game = getGame()) {
    const override = game?.id ? saved.games[game.id] : null;
    return { ...saved.default, ...(override ?? {}) };
  }
  function show(values) {
    for (const [key, input] of inputs) input.value = values[key];
  }
  function refresh(game = getGame(), preserveDraft = false) {
    currentGameId = game?.id ?? null;
    const gameOption = scope.querySelector('[value="game"]');
    gameOption.disabled = !game?.id;
    if (gameOption.disabled && scope.value === "game") scope.value = "default";
    const isGame = scope.value === "game";
    const current = isGame && game?.id ? saved.games[game.id] : saved.default;
    show({ ...neutral, ...(current ?? saved.default) });
    if (!preserveDraft || draft?.gameId !== currentGameId) draft = null;
    status.textContent = isGame && !current ? "This game is using the default cartridge pose." : "";
    onChange();
  }
  function close(focus = false) {
    draft = null;
    form.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    onChange();
    if (focus) toggle.focus();
  }

  toggle.addEventListener("click", () => {
    if (!form.hidden) { close(true); return; }
    form.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    refresh(getGame());
    scope.focus();
  });
  scope.addEventListener("change", () => refresh(getGame()));
  form.addEventListener("input", (event) => {
    if (event.target === scope || !form.checkValidity()) return;
    const game = getGame();
    draft = {
      scope: scope.value,
      gameId: game?.id ?? null,
      values: Object.fromEntries([...inputs].map(([key, input]) => [key, input.valueAsNumber])),
    };
    status.textContent = "Previewing unsaved changes.";
    onChange();
  });
  form.querySelector('[data-action="reset"]').addEventListener("click", () => {
    if (scope.value === "game") {
      draft = { scope: "game", gameId: currentGameId, values: null };
      show(saved.default);
      status.textContent = "Previewing the default pose; saving removes this game override.";
    } else {
      show(neutral);
      form.dispatchEvent(new Event("input", { bubbles: true }));
    }
    onChange();
  });
  form.querySelector('[data-action="cancel"]').addEventListener("click", () => close(true));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!draft || saving) return;
    try {
      const next = { default: { ...saved.default }, games: { ...saved.games } };
      if (draft.scope === "game" && draft.gameId) {
        if (draft.values) next.games[draft.gameId] = draft.values;
        else delete next.games[draft.gameId];
      } else if (draft.scope === "default") {
        next.default = draft.values ?? { ...neutral };
      } else return;
      localStorage.setItem(storageKey, JSON.stringify(next));
      saved = next;
      draft = null;
      refresh(getGame());
      status.textContent = "Cartridge pose saved.";
    } catch (error) {
      status.textContent = `Could not save cartridge pose. ${error.message ?? error}`;
    }
  });

  return {
    refresh(game) {
      if (game?.id !== currentGameId) refresh(game, true);
    },
    values(game = getGame()) {
      const relevantDraft = draft && ((draft.scope === "game" && draft.gameId === game?.id) || draft.scope === "default");
      if (relevantDraft && draft.scope === "game" && !draft.values) return { ...saved.default };
      if (relevantDraft && draft.values) return { ...draft.values };
      return effective(game);
    },
  };
}
