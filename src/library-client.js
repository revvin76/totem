import { invoke } from '@tauri-apps/api/core';
import { SAMPLE_GAMES, gamesForPlatform } from './game-library.js';

export function discoveredPlatformIds(catalogue, counts) {
  return catalogue.filter(p => Number.isInteger(counts[p.id]) && counts[p.id] > 0).map(p => p.id);
}
export function gameWindow(selection, count, radius = 4) {
  if (!count) return [];
  if (count <= radius * 2 + 1) return Array.from({length: count}, (_,i) => i);
  return Array.from({length: radius * 2 + 1},(_,i) => ((selection + i - radius) % count + count) % count);
}
export function createLibraryClient(native) {
  const cache = new Map();
  return {
    live: native,
    async cachedSummary() {
      return native ? invoke('load_cached_game_library') : null;
    },
    async scan(catalogue) {
      if (native) return invoke('scan_game_library');
      const counts = {};
      for (const game of SAMPLE_GAMES) counts[game.platformId] = (counts[game.platformId] ?? 0) + 1;
      return { platformCounts: counts, totalGames: SAMPLE_GAMES.length, warnings: [], preview: true };
    },
    games: (id) => native ? invoke('get_platform_games', { platformId: id }) : Promise.resolve(gamesForPlatform(id)),
    video: (id) => native ? invoke('get_library_game_video', { gameId: id }) : Promise.resolve(null),
    metadata: (id) => native ? invoke('get_library_game_metadata', { gameId: id }) : Promise.resolve(null),
    async hydrate(game) {
      if (!native || !game.id.startsWith('library-')) return game;
      if (cache.has(game.id)) { const value = cache.get(game.id); cache.delete(game.id); cache.set(game.id,value); return value; }
      const image = await invoke('get_library_game_artwork', {gameId: game.id});
      const value = {...game, cover: image.cover ?? undefined, cartridgeFront: image.cartridgeFront ?? undefined, localLogo: image.logo ?? undefined};
      cache.set(game.id,value);
      while (cache.size > 16) cache.delete(cache.keys().next().value);
      return value;
    },
  };
}
