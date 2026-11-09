import { invoke, isTauri } from "@tauri-apps/api/core";

export const igdbDesktop = typeof window !== "undefined" && isTauri();
export const igdb = {
  status: () => invoke("igdb_connection_status"),
  importShared: () => invoke("import_shared_igdb_credentials"),
  save: (clientId, clientSecret) => invoke("save_igdb_credentials", { clientId, clientSecret }),
  test: () => invoke("test_igdb_connection"),
  lookup: (gameId) => invoke("lookup_igdb_artwork", { gameId }),
  fill: (gameId, igdbGameId) => invoke("fill_igdb_artwork", { gameId, igdbGameId }),
  artwork: (gameId) => igdbDesktop ? invoke("get_game_artwork", { gameId }) : Promise.resolve(null),
};

export function withDownloadedArtwork(game, state, reusable = false) {
  const assets = state?.assets ?? {};
  // The original supplied models retain their original UV maps and packaging.
  if (game.model && !reusable) return game;
  const front = game.cover && game.coverKind === "front" ? null : assets.front;
  return {
    ...game,
    cover: front?.url ?? game.cover,
    coverKind: front ? "front" : game.coverKind,
    backCover: game.backCover ?? assets.back?.url,
    spineCover: game.spineCover ?? assets.spine?.url,
  };
}
