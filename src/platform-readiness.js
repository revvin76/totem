import { invoke, isTauri } from "@tauri-apps/api/core";
import catalogue from "../platforms.json" with { type: "json" };
import { bundledLogo } from "./platform-artwork.js";
import { hasInsertionAnimation } from "./console-activity.js";
import { controllerForPlatform } from "./controller-mapping.js";
import { libraryAccessoryOptions } from "./library-accessories.js";
import { dualScreenDemos } from "./dual-screen-preview.js";
import { DEMO_SYSTEMS } from "./collection.js";
import { DRAFT_KEY } from "./layout.js";

const status = (status, explanation, source, detail) => ({ status, explanation, source, detail });
const missingEvidence = (source, explanation = "No platform-level verification is recorded in this snapshot.") =>
  status("amber", explanation, source);
const catalogueSource = "Effective platform catalogue";
const bundledYears = new Map(catalogue.map(platform => [platform.id, platform.year]));
const hasMediaModel = platform => libraryAccessoryOptions(platform).some(([id]) => id === "media");

const metadataEvaluators = {
  "release-year": platform => {
    const year = /^\d{4}$/.test(platform.year) ? platform.year : bundledYears.get(platform.id);
    return /^\d{4}$/.test(year)
      ? status("green", "A release year is available.", catalogueSource, year)
      : missingEvidence(catalogueSource, "The catalogue does not specify a four-digit release year.");
  },
  "platform-logo": platform => (platform.logoFile || bundledLogo(platform))
    ? status("green", "A platform logo is configured.", "Platform artwork resolver")
    : missingEvidence("Platform artwork resolver", "No platform logo is configured."),
  "controller-model": platform => {
    const profile = controllerForPlatform(platform.id);
    return profile?.shape
      ? status("green", "A controller model can be generated from the control profile.", "Controller model renderer", profile.id)
      : missingEvidence("Controller model renderer", "No controller model profile is available.");
  },
  "media-model": platform => {
    return hasMediaModel(platform)
      ? status("green", "A matching media model can be generated for this platform.", "Game media model renderer")
      : status("grey", "This platform has no configured physical media model.", "Game media model renderer");
  },
  "insertion-animation": platform => !hasMediaModel(platform)
    ? status("grey", "This platform has no physical media to insert.", "Game media model renderer")
    : hasInsertionAnimation(platform.id)
      ? status("green", "A media insertion animation is configured.", "Console activity runtime")
      : missingEvidence("Console activity runtime", "No platform insertion-animation route is configured."),
  "video-files": platform => {
    const demo = dualScreenDemos[platform.id];
    return demo
      ? status("green", "A bundled default gameplay clip is configured.", "Bundled gameplay demo", demo.path)
      : undefined;
  },
};

// Keep the dashboard focused on platform setup, playback and game artwork.
const groups = [
  ["metadata", "Platform info", "platform-general", "Effective platform catalogue", false, [
    ["release-year", "Release Year"],
  ]],
  ["platform", "Platform setup", "platform-artwork", "Platform assets and generated models", true, [
    ["model-availability", "3D Model"], ["rail-artwork", "Button Image"], ["platform-logo", "Platform Logo"],
    ["controller-model", "Controller Model"], ["media-model", "Media Model"],
  ]],
  ["playback", "Playback", "platform-display", "Platform insertion animation and default game clip", false, [
    ["insertion-animation", "Media Insertion Animation"], ["video-files", "Default Game Clip"],
  ]],
  ["game-artwork", "Game artwork", "game-artwork", "Artwork coverage in the indexed game library", false, [
    ["front-covers", "Front Covers"], ["back-covers", "Back Covers"], ["clear-logos", "Game Logos"],
  ]],
];

export const readinessCategories = groups.map(([id, label, destination, source, critical, entries]) => ({
  id, label, critical,
  checks: entries.map(([key, label]) => {
    const required = key.endsWith("!");
    const id = required ? key.slice(0, -1) : key;
    return { id, label, required, destination, source, evaluate: metadataEvaluators[id] };
  }),
}));

export function aggregateChecks(checks, requiredFailure = check => check.required && check.status === "red") {
  const applicable = checks.filter(check => check.status !== "grey");
  const passed = applicable.filter(check => check.status === "green").length;
  return {
    status: !applicable.length ? "grey" : applicable.some(requiredFailure)
      ? "red" : passed === applicable.length ? "green" : "amber",
    passed, applicable: applicable.length,
  };
}

export function evaluateReadiness(snapshot) {
  const started = performance.now();
  const evaluatedAt = new Date(snapshot.evaluatedAt).toISOString();
  const activePlatformIds = new Set(snapshot.activePlatformIds ?? []);
  const platforms = snapshot.platforms.map(({ platform, logo, gameCount, checks: evidence = {} }) => {
    const checks = {};
    const categories = {};
    for (const category of readinessCategories) {
      const results = category.checks.map(check => {
        const { id, label, required, destination, source, evaluate } = check;
        const evaluated = evaluate?.(platform);
        const result = id === "video-files" && evaluated
          ? evaluated
          : evidence[id] ?? evaluated
          ?? missingEvidence(source, `No verified evidence for ${label.toLowerCase()} is available in this snapshot.`);
        return checks[id] = {
          ...result, id, label, platformId: platform.id, categoryId: category.id, required, destination,
          applicable: result.status !== "grey", evaluatedAt,
          evidence: [result.source, result.detail].filter(value => value != null).join(" · "),
          action: result.status === "green" || result.status === "grey" ? null
            : destination ? "Review the evidence in the related Settings section." : "Record platform verification before marking this check complete.",
        };
      });
      categories[category.id] = aggregateChecks(results);
    }
    const criticalFailure = readinessCategories.some(category => category.critical && categories[category.id].status === "red");
    const overall = aggregateChecks(Object.values(checks), () => criticalFailure);
    return {
      id: platform.id, name: platform.name, type: platform.kind || "Unclassified",
      logo: logo ?? bundledLogo(platform), gameCount: gameCount ?? null,
      active: activePlatformIds.has(platform.id), checks, categories, overall,
    };
  });
  return {
    evaluatedAt, platforms, activePlatformIds: [...activePlatformIds], warnings: snapshot.warnings ?? [],
    evaluationMs: performance.now() - started, nativeEvaluationMs: snapshot.evaluationMs ?? null,
    browserPreview: snapshot.browserPreview === true,
  };
}

export async function loadReadiness() {
  if (isTauri()) {
    const snapshot = await invoke("get_platform_readiness");
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (Array.isArray(draft?.enabledPlatformIds)) snapshot.activePlatformIds = draft.enabledPlatformIds;
    } catch { /* Use the saved default when the local draft is unavailable. */ }
    if (!Array.isArray(snapshot.activePlatformIds)) {
      try {
        const saved = await invoke("load_default_layout");
        if (Array.isArray(saved?.enabledPlatformIds)) snapshot.activePlatformIds = saved.enabledPlatformIds;
      } catch { /* Readiness remains available if no saved layout can be loaded. */ }
    }
    if (!Array.isArray(snapshot.activePlatformIds)) {
      snapshot.activePlatformIds = snapshot.platforms
        .filter(({ gameCount }) => Number.isInteger(gameCount) && gameCount > 0)
        .map(({ platform }) => platform.id);
    }
    return evaluateReadiness(snapshot);
  }
  return evaluateReadiness({
    browserPreview: true,
    evaluatedAt: Date.now(),
    activePlatformIds: DEMO_SYSTEMS,
    platforms: catalogue.map(platform => ({ platform })),
    warnings: ["Browser preview uses the bundled catalogue. Local assets, custom platforms, emulator settings and the game index require Totem desktop."],
  });
}
