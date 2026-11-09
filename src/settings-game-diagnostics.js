import { invoke, isTauri } from "@tauri-apps/api/core";
import { createLibraryClient } from "./library-client.js";
import { mountGameInformation } from "../light-study/game-information.js";

export function mountSettingsGameDiagnostics(section, selectedPlatform) {
  const heading = document.createElement("h4");
  heading.textContent = "Indexed game diagnostics";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  section.append(heading, status);
  if (!isTauri()) {
    status.textContent = "Indexed game source and launch diagnostics are available in the Totem desktop app.";
    return { showGames() {}, selectedId: () => undefined };
  }

  const library = createLibraryClient(true);
  const select = document.createElement("select");
  select.id = "settings-indexed-game";
  select.setAttribute("aria-label", "Indexed game");
  const inspect = document.createElement("button");
  inspect.type = "button";
  inspect.textContent = "Game information";
  inspect.setAttribute("aria-haspopup", "dialog");
  const dialog = document.createElement("dialog");
  dialog.className = "admin-shell settings-game-information";
  dialog.setAttribute("aria-label", "Indexed game information");
  const title = document.createElement("h2");
  title.textContent = "Game information";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.autofocus = true;
  close.addEventListener("click", () => dialog.close());
  dialog.append(title, message, document.createElement("dl"), close);
  document.body.append(dialog);
  section.append(select, inspect);
  const selectedGames = new Map();
  let gamesById = new Map(), loadedPlatform, request = 0;
  const currentGame = () => loadedPlatform === selectedPlatform() ? gamesById.get(select.value) : null;
  mountGameInformation(inspect, dialog, currentGame, async gameId => {
    const game = currentGame();
    if (game?.id !== gameId) throw new Error("This game is unavailable for the selected platform.");
    const data = await invoke("get_indexed_game_diagnostics", { gameId });
    if (currentGame() !== game || data.id !== gameId || data.platformId !== game.platformId) {
      throw new Error("The indexed game selection changed.");
    }
    return data;
  });
  dialog.addEventListener("close", () => (inspect.disabled ? document.getElementById("editor-tab-sources") : inspect).focus());
  select.addEventListener("change", () => selectedGames.set(loadedPlatform, select.value));
  select.disabled = inspect.disabled = true;

  async function showGames(id, gameId) {
    if (id === loadedPlatform) {
      if (gamesById.has(gameId)) select.value = gameId;
      return;
    }
    if (gameId) selectedGames.set(id, gameId);
    else if (loadedPlatform && select.value) selectedGames.set(loadedPlatform, select.value);
    const current = ++request;
    loadedPlatform = null;
    select.disabled = inspect.disabled = true;
    select.replaceChildren();
    status.textContent = "Loading indexed games…";
    const isCurrent = () => current === request && selectedPlatform() === id;
    try {
      const games = await library.games(id);
      if (!isCurrent()) return;
      gamesById = new Map(games.filter(game => game.platformId === id).map(game => [game.id, game]));
      loadedPlatform = id;
      const titles = new Map();
      for (const { title } of gamesById.values()) titles.set(title, (titles.get(title) ?? 0) + 1);
      const options = document.createDocumentFragment();
      for (const { title, id } of gamesById.values()) {
        options.append(new Option(titles.get(title) > 1 ? `${title} · ${id}` : title, id));
      }
      select.append(options);
      const previous = selectedGames.get(id);
      if (gamesById.has(previous)) select.value = previous;
      select.disabled = inspect.disabled = !gamesById.size;
      status.textContent = previous && !gamesById.has(previous)
        ? "The previously selected game is unavailable. Showing the current index."
        : gamesById.size ? "Inspect an indexed file’s source and launch evidence." : "No indexed games for this platform.";
    } catch (error) {
      if (isCurrent()) status.textContent = `Indexed games unavailable. ${error.message ?? error}`;
    }
  }
  for (const event of ["totem:library-index-ready", "totem:library-rescanned"]) {
    window.addEventListener(event, () => {
      loadedPlatform = null;
      ++request;
      if (selectedPlatform() && section.getClientRects().length) void showGames(selectedPlatform());
    });
  }
  return { showGames, selectedId: () => currentGame()?.id };
}
