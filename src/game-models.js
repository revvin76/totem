import sources from "../game-models.json" with { type: "json" };
import { parseModel, disposeImported } from "./platform-assets.js";
import { applyXbox360Artwork } from "./xbox360-case.js";
import { boxArtForPlatform } from "./box-art.js";
import { createBoxArtModel } from "./box-art-models.js";

export { fitArtwork } from "./box-art-models.js";

export async function loadGameModel(game, { platform, store } = {}) {
  if (game.model || game.platformId === "xbox360") {
    const source = sources[game.model ?? "xbox360-case"];
    if (!source) throw new Error("Unknown game model.");
    const response = await fetch(new URL(source.path, document.baseURI));
    if (!response.ok) throw new Error(`Game model unavailable (${response.status}).`);
    const root = await parseModel(await response.arrayBuffer(), [], source.showcaseRotation ?? [0, 0, 0]);
    if (game.platformId === "xbox360" && !game.model) {
      try { await applyXbox360Artwork(root, game); }
      catch (error) { disposeImported(root); throw error; }
    }
    return root;
  }
  return createBoxArtModel(boxArtForPlatform(platform ?? { id: game.platformId }), game, store);
}

export function disposeGameModel(model) {
  disposeImported(model);
}
