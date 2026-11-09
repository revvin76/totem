import games from "../games.json" with { type: "json" };
import platforms from "../platforms.json" with { type: "json" };

export const SAMPLE_GAMES = games;
export function gamesForPlatform(platformId) {
  return games.filter((game) => platformId === "all" || game.platformId === platformId);
}
export function gamePlatformName(game) {
  return platforms.find((platform) => platform.id === game.platformId)?.name ?? game.platformId;
}

// This catalogue is a deliberately bounded artwork demo, never the installed
// library or evidence that a game is present/launchable on this computer.
export function samplePlatforms() {
  return platforms.filter((platform) => games.some((game) => game.platformId === platform.id));
}
