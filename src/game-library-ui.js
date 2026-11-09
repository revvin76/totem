import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SAMPLE_GAMES, gamesForPlatform, gamePlatformName, samplePlatforms } from "./game-library.js";
import { loadGameModel, disposeGameModel } from "./game-models.js";
import { addStudioLighting, configureStudioRenderer } from "./lighting.js";
import { createConsole } from "./models.js";
import { controllerForPlatform } from "./controller-mapping.js";
import { createControllerModel } from "./controller-models.js";
import { mountGameLayoutEditor, platformLayout } from "./game-layout-editor.js";
import { mountCartridgeLayoutEditor } from "./cartridge-layout-editor.js";
import { createDisplay, findScreen, fitModel } from "./game-selection-stage.js";
import { disposeImported, loadPlatformModel, loadSNESControllerPair } from "./platform-assets.js";
import { nearestSlot, wrapIndex } from "./orbit.js";
import { gameWindow } from "./library-client.js";
import { mountCenteredTitleRail } from "./centered-title-rail.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import "./game-library.css";
import { igdb, igdbDesktop, withDownloadedArtwork } from "./igdb-client.js";
import igdbPlatforms from "../igdb-platforms.json" with { type: "json" };
import boxArtCatalog from "../box-art-defaults.json" with { type: "json" };
import { createBoxArtModel } from "./box-art-models.js";

export function mountGameLibrary({ reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches, getPlatform = () => null, getStore = () => null, onPlatformSaved = () => {}, library = null } = {}) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("game-library");
  let renderer, scene, camera, environment;
  let items = [], models = new Map(), selection = 0, slot = 0, target = 0;
  let generation = 0, drag = null, back = false, inspection = 0, lastFrame = 0;
  let padReady = false, padConfirm = false, padBack = false, lastPad = 0;
  let returnFocus;
  const downloaded = new Map();
  const hydrated = new Map();
  const indexById = new Map();
  let preparing = false, prepareAgain = false, closing = false, fade = null, launchingGame = false;
  const live = !!library?.live;
  let videoGameId = null, videoRequest = 0;
  const videoPaths = new Map();
  const metadataCache = new Map();
  const metadataPending = new Map();
  let libraryPlatformId = null, presentationRevision = 0, presentationRoot = null, display = null, builtInScreen = null;
  let videoTexture = null, videoBindings = [], controllerModel = null;
  let insertedCartridge = null, insertedCartridgeGameId = null, cartridgeRequest = 0;
  let stageWidth = 0, stageHeight = 0, presentationPose = {};
  let visibleCentre = 0;
  let entrance = null, entranceActor = null;
  const visibleIndices = () => live ? [...new Set([...gameWindow(selection, items.length), ...gameWindow(wrapIndex(Math.round(slot), items.length), items.length)])] : items.map((_,i) => i);
  const localGame = (game) => hydrated.get(game?.id) ?? game;
  const layoutEditor = mountGameLayoutEditor({
    getPlatform: () => getPlatform(libraryPlatformId),
    savePlatform: async (record) => {
      const saved = await getStore().save(record);
      onPlatformSaved(saved);
      if (libraryPlatformId === saved.id) presentationPose = saved.libraryPresentation.pose;
    },
    onChange: layoutPresentation,
  });
  const cartridgeEditor = mountCartridgeLayoutEditor({
    getGame: () => localGame(items[selection]),
    onChange: () => { layoutInsertedCartridge(); },
  });

  function clearVideo() {
    ++videoRequest;
    videoGameId = null;
    const video = $("game-video");
    video.onloadeddata = null;
    video.pause();
    video.muted = false;
    video.hidden = true;
    const youtube = $("game-youtube-video");
    youtube.hidden = true;
    youtube.removeAttribute("src");
    $("game-video-audio").hidden = true;
    video.removeAttribute("src");
    video.load();
    clearVideoTexture();
  }

  function clearVideoTexture() {
    for (const binding of videoBindings) {
      binding.mesh.material = binding.original;
      for (const material of binding.generated) material.dispose();
    }
    videoBindings = [];
    videoTexture?.dispose();
    videoTexture = null;
  }

  function setVideoSurface() {
    clearVideoTexture();
    const video = $("game-video");
    const mesh = builtInScreen ?? display?.surface;
    if (!mesh || !video.src || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.DoubleSide, toneMapped: false });
    videoBindings.push({ mesh, original: mesh.material, generated: [material] });
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => material) : material;
  }

  function clearPresentation() {
    ++presentationRevision;
    ++cartridgeRequest;
    insertedCartridge = null;
    insertedCartridgeGameId = null;
    finishEntrance();
    clearVideoTexture();
    for (const root of [presentationRoot, display?.root, controllerModel]) {
      if (!root) continue;
      scene.remove(root);
      disposeImported(root);
    }
    presentationRoot = display = builtInScreen = controllerModel = null;
    presentationPose = {};
    $("cartridge-layout-toggle").hidden = true;
    if (!$("cartridge-layout-editor").hidden) {
      $("cartridge-layout-editor").hidden = true;
      $("cartridge-layout-toggle").setAttribute("aria-expanded", "false");
    }
  }

  function setDisplay(kind) {
    display = createDisplay(kind);
    scene.add(display.root);
    layoutPresentation();
  }

  async function loadPresentation(platformId, homePose) {
    if (!scene || libraryPlatformId === platformId) return;
    layoutEditor.close();
    clearPresentation();
    const revision = presentationRevision;
    libraryPlatformId = platformId;
    $("cartridge-layout-toggle").hidden = platformId !== "snes";
    const platform = getPlatform(platformId);
    if (!platform) return;
    if (platform.kind === "arcade") {
      setDisplay("arcade");
      setVideoSurface();
      if (homePose) {
        try {
          const device = homePose.placeholder ? createConsole(platform) : await loadPlatformModel(platform, getStore());
          if (revision !== presentationRevision || !dialog.open) { disposeImported(device); return; }
          startEntrance(homePose, device);
        } catch { /* The cabinet display remains available. */ }
      }
      return;
    }
    const config = platform.libraryPresentation ?? {};
    const wantsBuiltIn = config.display === "built-in" || (!config.display && platform.kind === "handheld");
    if (!wantsBuiltIn) setDisplay("tv");
    try {
      let device = homePose?.placeholder ? createConsole(platform) : await loadPlatformModel(platform, getStore());
      const homeDevice = device;
      if (revision !== presentationRevision || !dialog.open) { disposeImported(device); return; }
      builtInScreen = wantsBuiltIn ? findScreen(device, config.screenMesh) : null;
      if (wantsBuiltIn && !builtInScreen) {
        const fallback = createConsole(platform);
        const surface = findScreen(fallback);
        if (surface) {
          if (!homePose) disposeImported(device);
          device = fallback;
          builtInScreen = surface;
        } else {
          disposeImported(fallback);
        }
      }
      presentationRoot = device;
      if (!builtInScreen && !display) setDisplay("tv");
      presentationPose = config.pose ?? {};
      scene.add(device);
      void updateInsertedCartridge(localGame(items[selection]));
      const profile = controllerForPlatform(platform.id);
      if (!builtInScreen && platform.kind !== "handheld" && profile?.id !== "generic") {
        if (profile.shape === "snes") {
          controllerModel = await loadSNESControllerPair(getStore());
          if (revision !== presentationRevision || !dialog.open) {
            disposeImported(controllerModel);
            controllerModel = null;
            return;
          }
        } else {
          controllerModel = createControllerModel(profile).root;
        }
        controllerModel.rotation.set(0.47, -0.22, 0.08);
        scene.add(controllerModel);
      }
      layoutPresentation();
      if (homePose) startEntrance(homePose, homeDevice);
      setVideoSurface();
    } catch (error) {
      if (revision !== presentationRevision) return;
      if (!display) setDisplay("tv");
      setVideoSurface();
      $("game-load-status").textContent = `Platform model unavailable: ${error.message ?? error}`;
    }
  }

  function layoutPresentation() {
    const w = stageWidth, h = stageHeight;
    if (!w || !h) return;
    const x = w * 0.25;
    const floor = -h * 0.38;
    const units = h * 0.06;
    if (display) {
      const arcade = display.aspect < 1;
      const pose = layoutEditor.values("display");
      const height = Math.min(h * (arcade ? 0.98 : 0.78), w * (arcade ? 0.45 : 0.53) / display.aspect) * pose.scale;
      display.root.scale.setScalar(height);
      display.root.rotation.set(...[pose.pitch, pose.yaw, pose.roll].map(THREE.MathUtils.degToRad));
      display.root.position.set(x + pose.x * units,
        floor + height * (arcade ? 0.47 : 0.42) + (arcade ? 0 : h * 0.15) + pose.y * units,
        -12 + pose.z * units);
    }
    if (presentationRoot) {
      const base = layoutEditor.values("console");
      const offset = layoutEditor.values("platform", platformLayout(presentationPose));
      const zoomRatio = base.scale * offset.scale;
      const hardwareX = (builtInScreen ? x : w * 0.34) + (base.x + offset.x) * units;
      const hardwareY = (builtInScreen ? floor : -h * 0.40) + (base.y + offset.y) * units;
      presentationRoot.rotation.set(...[
        base.pitch + offset.pitch + (builtInScreen ? 0 : 17),
        base.yaw + offset.yaw + (builtInScreen ? -9 : -18),
        base.roll + offset.roll,
      ].map(THREE.MathUtils.degToRad));
      fitModel(presentationRoot, w * (builtInScreen ? 0.46 : 0.25) * zoomRatio,
        h * (builtInScreen ? 0.84 : 0.35) * zoomRatio, hardwareX, hardwareY);
      presentationRoot.position.z += (base.z + offset.z) * units;
      if (controllerModel) {
        const bounds = new THREE.Box3().setFromObject(presentationRoot);
        const controllerWidth = w * 0.12;
        fitModel(controllerModel, controllerWidth, h * 0.16,
          bounds.min.x - controllerWidth * 0.52, hardwareY);
        controllerModel.position.z += (base.z + offset.z) * units;
      }
    }
    layoutInsertedCartridge();
  }

  function layoutInsertedCartridge() {
    if (!insertedCartridge || !insertedCartridge.parent) return;
    const pose = cartridgeEditor?.values(localGame(items[selection]));
    if (!pose) return;
    insertedCartridge.scale.setScalar(pose.scale);
    insertedCartridge.position.set(pose.x, pose.y, pose.z);
    insertedCartridge.rotation.set(...[pose.pitch, pose.yaw, pose.roll].map(THREE.MathUtils.degToRad));
  }

  function startEntrance(from, actor) {
    if (actor !== presentationRoot) {
      entranceActor = actor;
      scene.add(actor);
      if (presentationRoot) presentationRoot.visible = false;
      else if (display) display.root.visible = false;
    }
    entrance = { from, actor, started: performance.now() };
    resize();
  }

  function finishEntrance() {
    if (entranceActor) {
      scene.remove(entranceActor);
      disposeImported(entranceActor);
      entranceActor = null;
      if (presentationRoot) presentationRoot.visible = true;
      else if (display) display.root.visible = true;
    }
    if (entrance) {
      entrance = null;
      resize();
    }
  }

  function renderEntrance(now, instant) {
    const progress = entrance ? Math.max(0, (now - entrance.started) / 920) : 1;
    if (instant || progress >= 1) finishEntrance();
    if (!entrance) { renderer.render(scene, camera); return; }

    const { from, actor } = entrance;
    const destination = presentationRoot ?? display.root;
    const position = destination.position.clone();
    const rotation = destination.quaternion.clone();
    const scale = destination.scale.x / (presentationRoot ? 1 : 3.3);
    const rect = $("game-stage").getBoundingClientRect();
    const eased = progress * progress * (3 - 2 * progress);
    const start = new THREE.Vector3(from.x - rect.left - stageWidth / 2,
      stageHeight / 2 - (from.y - rect.top), 200);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), eased * Math.PI * 2);
    actor.position.lerpVectors(start, position, eased);
    actor.quaternion.copy(from.rotation).slerp(rotation, eased).premultiply(spin);
    actor.scale.setScalar(THREE.MathUtils.lerp(from.scale, scale, eased));
    renderer.render(scene, camera);
    if (actor === presentationRoot) {
      actor.position.copy(position);
      actor.quaternion.copy(rotation);
      actor.scale.setScalar(scale);
    }
  }

  function updateVideo(game) {
    const gameId = game?.id ?? null;
    if (gameId === videoGameId) return;
    clearVideo();
    videoGameId = gameId;
    if (!game) return;
    if (game?.platformId && game.platformId !== libraryPlatformId) loadPresentation(game.platformId);
    const request = videoRequest;
    const useYoutubeFallback = () => {
      if (!live || !library?.metadata) return;
      void getMetadata(game).then((metadata) => {
        if (request !== videoRequest || !dialog.open) return;
        const id = metadata?.videos?.[0];
        if (!id) return;
        const player = $("game-youtube-video");
        player.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=1&playsinline=1`;
        player.hidden = false;
      }).catch(() => {});
    };
    if (!game?.videoMime || !library?.video) { useYoutubeFallback(); return; }
    const ready = videoPaths.has(game.id) ? Promise.resolve(videoPaths.get(game.id)) : library.video(game.id).then((bytes) => {
      if (bytes) videoPaths.set(game.id, bytes);
      return bytes;
    });
    ready.then((bytes) => {
      if (!bytes) { useYoutubeFallback(); return; }
      if (request !== videoRequest || !dialog.open) return;
      if (typeof bytes !== "string") throw new Error("Invalid local video path.");
      $("game-youtube-video").hidden = true;
      const video = $("game-video");
      video.muted = false;
      video.onloadeddata = () => { if (request === videoRequest) setVideoSurface(); };
      video.src = convertFileSrc(bytes);
      video.hidden = false;
      video.load();
      video.play().then(() => {
        if (request === videoRequest) $("game-video-audio").hidden = true;
      }).catch(() => {
        if (request === videoRequest) {
          $("game-video-audio").hidden = false;
          $("game-load-status").textContent = "Video audio was blocked by autoplay. Use Play video with audio to start playback.";
        }
      });
    }).catch(() => {
      if (request === videoRequest) { $("game-video").hidden = true; useYoutubeFallback(); }
    });
  }

  function prefetchAdjacent() {
    if (!live || !library?.video || items.length < 2) return;
    for (const offset of [-1, 1]) {
      const game = localGame(items[wrapIndex(selection + offset, items.length)]);
      if (!game?.videoMime || videoPaths.has(game.id)) continue;
      library.video(game.id).then((path) => {
        if (path) videoPaths.set(game.id, path);
        while (videoPaths.size > 3) videoPaths.delete(videoPaths.keys().next().value);
      }).catch(() => {});
    }
  }

  function updateDescription(game) {
    const description = $("game-description");
    const text = game?.description ?? `This preview contains ${SAMPLE_GAMES.length} sample games across ${samplePlatforms().length} systems. Choose a sample platform above, or view the complete artwork demo.`;
    description.textContent = text;
    description.classList.remove("is-expanded");
    const toggle = $("game-description-toggle");
    toggle.hidden = text.length < 240;
    toggle.textContent = "Show more";
    toggle.setAttribute("aria-expanded", "false");
    const cached = metadataCache.get(game?.id);
    updateGameMetadata(game, cached);
    if (live && game && library?.metadata) {
      getMetadata(game).then((metadata) => {
        if (!metadata) return;
        if (items[selection]?.id === game.id) updateGameMetadata(game, metadata);
      }).catch(() => {}).finally(() => metadataPending.delete(game.id));
    }
  }
  function updateGameMetadata(game, metadata) {
    const rows = [];
    const add = (label, value) => { if (value) rows.push([label, value]); };
    add("Developer", metadata?.developers?.join(", "));
    add("Publisher", metadata?.publishers?.join(", "));
    add("Genres", metadata?.genres?.join(", "));
    add("Game modes", metadata?.gameModes?.join(", "));
    add("Players", metadata?.playerCount);
    const releaseDate = Number(metadata?.firstReleaseDate);
    const year = Number.isFinite(releaseDate) && releaseDate > 0
      ? new Date(releaseDate * 1000).getUTCFullYear()
      : game?.releaseYear;
    add("Year", year);
    add("Region", game?.region);
    add("File details", game?.fileDetails?.join(", "));
    const list = $("game-metadata");
    list.replaceChildren(...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = String(value);
      return [term, detail];
    }));
    list.hidden = rows.length === 0;
  }
  function getMetadata(game) {
    if (metadataCache.has(game.id)) return Promise.resolve(metadataCache.get(game.id));
    if (!metadataPending.has(game.id)) {
      const request = library.metadata(game.id).then((metadata) => {
        if (metadata) metadataCache.set(game.id, metadata);
        return metadata;
      }).finally(() => metadataPending.delete(game.id));
      metadataPending.set(game.id, request);
    }
    return metadataPending.get(game.id);
  }
  $("game-description-toggle").addEventListener("click", () => {
    const description = $("game-description");
    const expanded = description.classList.toggle("is-expanded");
    $("game-description-toggle").textContent = expanded ? "Show less" : "Show more";
    $("game-description-toggle").setAttribute("aria-expanded", String(expanded));
  });

  async function updateInsertedCartridge(game) {
    const nextId = game?.platformId === "snes" && game.cartridgeFront && presentationRoot ? game.id : null;
    if (nextId === insertedCartridgeGameId) return;
    const request = ++cartridgeRequest;
    if (insertedCartridge) {
      presentationRoot?.remove(insertedCartridge);
      disposeGameModel(insertedCartridge);
      insertedCartridge = null;
    }
    insertedCartridgeGameId = nextId;
    if (!nextId) return;
    try {
      const template = boxArtCatalog.templates["snes-cartridge"];
      const model = await createBoxArtModel({
        template: "snes-cartridge", rotation: [0, 0, 0], neutralMaterials: [],
        panels: structuredClone(template.panels),
      }, { title: game.title, cover: game.cartridgeFront });
      if (request !== cartridgeRequest || !dialog.open || !presentationRoot) {
        disposeGameModel(model);
        return;
      }
      presentationRoot.add(model);
      insertedCartridge = model;
      insertedCartridgeGameId = nextId;
      layoutInsertedCartridge();
    } catch (error) {
      if (request === cartridgeRequest) {
        insertedCartridgeGameId = null;
        $("game-load-status").textContent = `Matching SNES cartridge artwork could not be displayed: ${error.message ?? error}`;
      }
    }
  }

  $("game-video-audio").addEventListener("click", () => {
    const video = $("game-video");
    video.muted = false;
    video.play().then(() => {
      $("game-video-audio").hidden = true;
      $("game-load-status").textContent = "";
    }).catch((error) => {
      $("game-load-status").textContent = `Could not play video audio: ${error.message ?? error}`;
    });
  });

  const reusable = (game) => !!getPlatform(game.platformId)?.boxArt;
  const loadModel = (game, state) => loadGameModel(withDownloadedArtwork(game, state, reusable(game)), { platform: getPlatform(game.platformId), store: getStore() });
  let artworkRequest = 0;

  function update() {
    const game = localGame(items[selection]);
    cartridgeEditor.refresh(game);
    updateVideo(game);
    prefetchAdjacent();
    void updateInsertedCartridge(game);
    renderCards();
    $("game-stage").classList.toggle("has-case", models.has(game?.id));
    $("game-title").textContent = game?.title ?? "No games found for this system";
    $("game-platform-name").textContent = game ? (getPlatform(game.platformId)?.name ?? gamePlatformName(game)) : $("game-platform").selectedOptions[0]?.textContent;
    updateDescription(game);
    if (!game && live) $("game-description").textContent = "No indexed game entries are available for this platform. Check your library folders and restart Totem.";
    $("game-show-samples").hidden = live;
    $("game-show-samples").textContent = `View all ${SAMPLE_GAMES.length} artwork samples →`;
    $("game-artwork").textContent = game?.artwork ?? "Your installed game library has not been imported.";
    const art = downloaded.get(game?.id);
    if (game && (!game.model || reusable(game)) && art?.assets?.front) {
      $("game-description").textContent = game.platformId === "xbox360" ? "This game's cover on the supplied Xbox 360 case. The green plastic and original case geometry are preserved." : "Downloaded IGDB cover fitted without stretching to the 3D case. Original local artwork is preserved.";
      $("game-artwork").textContent = `IGDB front cover · ${art.assets.back ? "back cover" : "generic back"} · ${art.assets.spine ? "spine artwork" : "generic spine"}`;
    }
    const background = art?.assets?.background?.url;
    $("game-extra-artwork").hidden = !background;
    $("game-extra-artwork").open = false;
    if (background) { $("game-provider-background").src = background; $("game-provider-background").alt = `${game.title} artwork`; } else $("game-provider-background").removeAttribute("src");
    $("game-igdb-provenance").textContent = art && Object.keys(art.assets).length ? `Artwork: IGDB / respective owners · cached locally${art.missing.length ? ` · Missing: ${art.missing.join(", ")}` : ""}` : "";
    ++artworkRequest; $("game-igdb-results").replaceChildren();
    $("game-lookup-artwork").disabled = !game || !igdbDesktop || !models.has(game.id) || !igdbPlatforms[game.platformId];
    $("game-igdb-status").textContent = igdbDesktop ? "" : "IGDB lookup is available in the desktop app.";
    if (igdbDesktop && game && !igdbPlatforms[game.platformId]) $("game-igdb-status").textContent = "IGDB lookup is not configured for this platform.";
    $("game-position").textContent = `${game ? selection + 1 : 0} / ${items.length}`;
    $("game-previous").disabled = $("game-next").disabled = items.length < 2;
    $("game-inspect").disabled = !game;
    $("game-select").disabled = launchingGame || !game || (!live && !models.has(game.id));
    $("game-inspect").textContent = back ? "Show front" : "Show back";
    $("game-inspect").setAttribute("aria-pressed", String(back));
    for (const card of $("game-cards").children) {
      const current = Number(card.dataset.index) === selection;
      card.setAttribute("aria-current", String(current));
    }
    centerSelectedGameCard();
    $("game-selected-status").textContent = "";
  }
  function move(direction) {
    if (items.length < 2) return;
    target = Math.round(target) + direction;
    selection = wrapIndex(target, items.length);
    back = false;
    update(); syncVisibleModels();
  }
  async function select() {
    const game = items[selection];
    if (!game || (!live && !models.has(game.id)) || launchingGame) return;
    const button = $("game-select"), status = $("game-selected-status");
    if (!live) {
      status.textContent = `${game.title} selected in the preview.`;
      return;
    }
    launchingGame = true;
    button.disabled = true;
    status.textContent = `Launching ${game.title}…`;
    try {
      const emulator = await invoke("launch_game", { gameId: game.id });
      window.dispatchEvent(new CustomEvent("horizon:game-selected", { detail: { id: game.id, platformId: game.platformId, title: game.title, emulator } }));
      status.textContent = `Launched ${game.title} with ${emulator}.`;
    } catch (error) {
      status.textContent = `Could not launch ${game.title}: ${error.message ?? error}`;
    } finally {
      launchingGame = false;
      const current = items[selection];
      button.disabled = !current || (!live && !models.has(current.id));
    }
  }
  function clearModels() {
    for (const model of models.values()) {
      scene.remove(model);
      disposeGameModel(model);
    }
    models.clear();
  }
  function showCardLogo(button, game) {
    const url = downloaded.get(game.id)?.assets?.logo?.url ?? game.localLogo;
    if (!url || !button || button.querySelector(".game-card-logo")) return;
    const title = button.querySelector(".game-card-title");
    const logo = new Image();
    logo.className = "game-card-logo";
    logo.alt = "";
    logo.hidden = true;
    logo.addEventListener("load", () => {
      title.hidden = true;
      logo.hidden = false;
    }, { once: true });
    logo.addEventListener("error", () => logo.remove(), { once: true });
    button.append(logo);
    logo.src = url;
  }

  function renderCards() {
    const focusedGame = document.activeElement?.closest("#game-cards button")?.dataset.game;
    // Keep several cycles of the live title window in the rail so manual
    // scrolling can always continue into the next set of wrapping titles.
    const indices = live && items.length > 1
      ? Array.from({ length: 31 }, (_, offset) => wrapIndex(selection + offset - 15, items.length))
      : live ? gameWindow(selection, items.length, 5) : items.map((_,i) => i);
    $("game-cards").replaceChildren();
    for (const index of indices) {
      const game = localGame(items[index]);
      const button = document.createElement("button"); button.type = "button"; button.dataset.game = game.id; button.dataset.index = String(index);
      button.setAttribute("aria-label", game.title);
      if (game.cover) { const image = new Image(); image.src = game.cover; image.alt = ""; button.append(image); }
      else { const badge = document.createElement("span"); badge.className = "game-model-badge"; badge.textContent = "3D"; button.append(badge); }
      const title = document.createElement("span");
      title.className = "game-card-title";
      title.textContent = game.title;
      button.append(title);
      showCardLogo(button, game);
      button.addEventListener("click", () => { target = nearestSlot(Math.round(target), index, items.length); selection = index; back = false; update(); syncVisibleModels(); });
      $("game-cards").append(button);
    }
    if (focusedGame) {
      [...$("game-cards").children].find(button => Number(button.dataset.index) === selection)?.focus({ preventScroll: true });
    }
  }
  function centerSelectedGameCard(behavior = "smooth") {
    titleRail.center(gameRail.querySelector('[aria-current="true"]'), reducedMotion() ? "auto" : behavior);
  }
  const gameRail = $("game-cards");
  const titleRail = mountCenteredTitleRail(gameRail, {
    cards: () => gameRail.children,
    active: () => dialog.open && items.length,
    select(card) {
      const index = Number(card.dataset.index);
      if (index === undefined) return;
      if (index !== selection) {
        target = nearestSlot(Math.round(target), index, items.length);
        selection = index;
        back = false;
        update();
        syncVisibleModels();
      } else {
        centerSelectedGameCard();
      }
    },
  });
  async function syncVisibleModels() {
    const wanted = new Set(visibleIndices().map(i => items[i].id));
    for (const [id, model] of models) if (!wanted.has(id)) { scene.remove(model); disposeGameModel(model); models.delete(id); downloaded.delete(id); hydrated.delete(id); }
    if (preparing) { prepareAgain = true; return; }
    preparing = true;
    const revision = generation;
    try {
      do {
        prepareAgain = false;
        const indices = visibleIndices().sort((a,b) => (a === selection ? -1 : b === selection ? 1 : a-b));
        for (const index of indices) {
          const game = items[index];
          if (revision !== generation || !dialog.open) return;
          if (models.has(game.id)) continue;
          try {
            const local = library ? await library.hydrate(game) : game;
            if (revision !== generation || !dialog.open) return;
            if (!visibleIndices().some(i => items[i].id === game.id)) continue;
            hydrated.set(game.id,local);
            renderCards();
            try { const art = await igdb.artwork(game.id); if (art) downloaded.set(game.id,art); }
            catch { /* Local artwork and placeholders remain usable offline. */ }
            if (revision !== generation || !dialog.open) return;
            const card = [...$("game-cards").children].find(button => button.dataset.game === game.id);
            showCardLogo(card, local);
            const model = await loadModel(local, downloaded.get(game.id));
            if (revision !== generation || !dialog.open || !visibleIndices().some(i => items[i].id === game.id)) { disposeGameModel(model); downloaded.delete(game.id); hydrated.delete(game.id); continue; }
            models.set(game.id,model); scene.add(model);
            if (index === selection) update();
          } catch (error) {
            if (revision === generation && index === selection) $("game-load-status").textContent = `Game artwork unavailable: ${error.message ?? error}`;
          }
        }
      } while (prepareAgain && revision === generation && dialog.open);
      if (revision === generation) $("game-load-status").textContent = live ? `${items.length} game entries in this platform · ${models.size} 3D models loaded` : `${items.length} sample games · artwork preview`;
    } finally {
      preparing = false;
      if (revision !== generation && dialog.open && items.length) syncVisibleModels();
    }
  }
  async function populate(platformId) {
    const revision = ++generation;
    clearModels(); downloaded.clear(); hydrated.clear(); indexById.clear();
    items = []; selection = slot = target = inspection = 0; visibleCentre = 0; back = false;
    clearVideo();
    $("game-stage").classList.remove("has-case");
    loadPresentation(platformId);
    $("game-cards").replaceChildren(); $("game-load-status").textContent = "Loading this platform’s game library…";
    try {
      const records = library ? await library.games(platformId) : gamesForPlatform(platformId);
      if (revision !== generation || !dialog.open) return;
      items = records;
      items.forEach((game,index) => indexById.set(game.id,index));
      update();
      if (!items.length) $("game-load-status").textContent = "No matching games were found for this platform.";
      else await syncVisibleModels();
    } catch (error) { if (revision === generation) $("game-load-status").textContent = `Library unavailable: ${error.message ?? error}`; }
  }
  async function fadeTo(opacity) {
    const previous = fade; fade = null; previous?.cancel();
    const duration = reducedMotion() || document.hidden ? 0 : 360;
    const from = Number(getComputedStyle(dialog).opacity);
    if (!duration) { dialog.style.opacity = String(opacity); return; }
    const animation = dialog.animate([{opacity: from},{opacity}], {duration,easing:"ease-in-out",fill:"forwards"});
    fade = animation;
    await animation.finished.catch(() => {});
    if (fade === animation) { dialog.style.opacity = String(opacity); animation.cancel(); fade = null; }
  }
  async function closeLibrary() {
    if (closing || !dialog.open) return;
    closing = true;
    await fadeTo(0);
    dialog.close(); closing = false;
  }
  function resize() {
    if (!renderer || !dialog.open) return;
    const stage = $("game-stage").getBoundingClientRect();
    const { width, height } = stage;
    if (!width || !height) return;
    const frame = entrance ? dialog.getBoundingClientRect() : stage;
    const left = stage.left - frame.left, top = stage.top - frame.top;
    renderer.setSize(frame.width, frame.height);
    renderer.domElement.style.left = `${-left}px`;
    renderer.domElement.style.top = `${-top}px`;
    stageWidth = width; stageHeight = height;
    camera.left = -width / 2 - left; camera.right = camera.left + frame.width;
    camera.top = height / 2 + top; camera.bottom = camera.top - frame.height;
    camera.updateProjectionMatrix();
    layoutPresentation();
    centerSelectedGameCard("auto");
  }
  function controller(now) {
    const pad = navigator.getGamepads?.().find((item) => item?.connected);
    if (!pad || !document.hasFocus()) { padReady = false; return; }
    const confirm = !!pad.buttons[0]?.pressed, cancel = !!pad.buttons[1]?.pressed;
    const axis = Math.abs(pad.axes[1] ?? 0) > 0.55 ? pad.axes[1] : pad.axes[0] ?? 0;
    const direction = (pad.buttons[15]?.pressed || pad.buttons[13]?.pressed) ? 1 : (pad.buttons[14]?.pressed || pad.buttons[12]?.pressed) ? -1 : Math.abs(axis) > 0.55 ? Math.sign(axis) : 0;
    if (!padReady) { padReady = !confirm && !cancel && !direction; padConfirm = confirm; padBack = cancel; return; }
    if (direction && now - lastPad > 240) { move(direction); lastPad = now; }
    if (confirm && !padConfirm) select();
    if (cancel && !padBack) closeLibrary();
    padConfirm = confirm; padBack = cancel;
  }
  function createScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); configureStudioRenderer(renderer);
    renderer.domElement.setAttribute("aria-hidden", "true"); $("game-stage").append(renderer.domElement);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000); camera.position.z = 2000;
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    environment = pmrem.fromScene(room, 0.04); scene.environment = environment.texture; room.dispose(); pmrem.dispose();
    addStudioLighting(scene, camera);
    new ResizeObserver(resize).observe($("game-stage"));
    renderer.domElement.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, slot: target, id: event.pointerId };
      renderer.domElement.setPointerCapture(event.pointerId);
    });
    renderer.domElement.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId || !items.length) return;
      target = drag.slot - (event.clientX - drag.x) / 140;
      selection = wrapIndex(Math.round(target), items.length); back = false; update(); syncVisibleModels();
    });
    const release = () => { if (!drag) return; drag = null; target = Math.round(target); };
    renderer.domElement.addEventListener("pointerup", release);
    renderer.domElement.addEventListener("pointercancel", release);
    renderer.domElement.addEventListener("lostpointercapture", release);
    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault(); renderer.setAnimationLoop(null);
      $("game-load-status").textContent = "3D rendering interrupted. Reload the application to restore the scene.";
    });
  }
  function animate(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05); lastFrame = now;
    const instant = reducedMotion() || document.hidden;
    slot = instant ? target : THREE.MathUtils.damp(slot, target, 7, dt);
    if (live && items.length && Math.round(slot) !== visibleCentre) { visibleCentre = Math.round(slot); syncVisibleModels(); }
    inspection = instant ? (back ? Math.PI : 0) : THREE.MathUtils.damp(inspection, back ? Math.PI : 0, 8, dt);
    const caseTop = Math.max(0, dialog.clientHeight * 0.15 - $("game-stage").offsetTop);
    const casePose = layoutEditor.values("case");
    const caseUnits = stageHeight * 0.06;
    for (const [id, model] of models) {
      model.visible = indexById.get(id) === selection;
      if (!model.visible) continue;
      model.rotation.set(0.05 + THREE.MathUtils.degToRad(casePose.pitch),
        -0.23 + inspection + THREE.MathUtils.degToRad(casePose.yaw),
        THREE.MathUtils.degToRad(casePose.roll));
      fitModel(model, stageWidth * 0.225 * casePose.scale, stageHeight * 0.74 * casePose.scale,
        -stageWidth * 0.37 + casePose.x * caseUnits,
        stageHeight / 2 - caseTop + casePose.y * caseUnits, { alignTop: true });
      model.position.z += casePose.z * caseUnits;
    }
    if (!layoutEditor.isOpen()) controller(now);
    renderEntrance(now, instant);
  }
  $("game-lookup-artwork").addEventListener("click", async () => {
    const game = localGame(items[selection]); if (!game || !igdbDesktop) return;
    const request = ++artworkRequest, openedGeneration = generation;
    $("game-lookup-artwork").disabled = true;
    $("game-igdb-results").replaceChildren(); $("game-igdb-status").textContent = "Searching IGDB for this game and platform…";
    try {
      const result = await igdb.lookup(game.id);
      if (request !== artworkRequest || !dialog.open) return;
      $("game-igdb-status").textContent = result.candidates.length ? "Choose the correct match. IGDB covers may represent another edition; review the image first." : "No IGDB matches were found for this game on its platform.";
      for (const candidate of result.candidates) {
        const button = document.createElement("button"); button.type = "button"; button.className = "igdb-match";
        if (candidate.preview) { const image = new Image(); image.src = candidate.preview; image.alt = ""; button.append(image); }
        const text = document.createElement("span");
        const year = candidate.firstReleaseDate ? ` · ${new Date(candidate.firstReleaseDate * 1000).getUTCFullYear()}` : "";
        text.textContent = `${candidate.name}${year} — fill missing artwork`; button.append(text);
        button.addEventListener("click", async () => {
          if (request !== artworkRequest) return;
          $("game-lookup-artwork").disabled = true;
          for (const node of $("game-igdb-results").children) node.disabled = true;
          $("game-igdb-status").textContent = "Downloading missing artwork… Existing artwork will be kept.";
          try {
            const state = await igdb.fill(game.id, candidate.id);
            if (!dialog.open || generation !== openedGeneration) return;
            downloaded.set(game.id, state);
            const model = await loadModel(game, state);
            if (!dialog.open || generation !== openedGeneration) { disposeGameModel(model); return; }
            const old = models.get(game.id); if (old) { model.userData.angle = old.userData.angle; scene.remove(old); disposeGameModel(old); }
            models.set(game.id, model); scene.add(model);
            if (items[selection]?.id !== game.id) return;
            update();
            $("game-igdb-status").textContent = `${state.added.length ? `Added ${state.added.join(", ")}.` : "No additional artwork was available."}${state.missing.length ? ` Still missing: ${state.missing.join(", ")}.` : ""}${state.errors.length ? ` ${state.errors.join(" ")}` : ""}`;
          } catch (error) {
            if (request !== artworkRequest || !dialog.open) return;
            $("game-igdb-status").textContent = `Artwork was not applied: ${error}`;
            for (const node of $("game-igdb-results").children) node.disabled = false;
          } finally {
            if (request === artworkRequest && dialog.open) $("game-lookup-artwork").disabled = false;
          }
        });
        $("game-igdb-results").append(button);
      }
    } catch (error) { if (request === artworkRequest && dialog.open) $("game-igdb-status").textContent = `IGDB lookup failed: ${error}`; }
    finally { if (request === artworkRequest && dialog.open) $("game-lookup-artwork").disabled = false; }
  });
  $("game-close").addEventListener("click", closeLibrary);
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (layoutEditor.isOpen()) layoutEditor.close(true);
    else closeLibrary();
  });
  $("game-previous").addEventListener("click", () => move(-1));
  $("game-next").addEventListener("click", () => move(1));
  $("game-select").addEventListener("click", select);
  $("game-inspect").addEventListener("click", () => { back = !back; update(); });
  $("game-show-samples").addEventListener("click", () => { $("game-platform").value = "all"; populate("all"); });
  $("game-platform").addEventListener("change", () => populate($("game-platform").value));
  dialog.addEventListener("keydown", (event) => {
    if (event.target.closest("input,select,textarea,#game-layout-editor")) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      move(event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1);
    }
    if (event.key === "Enter" && event.target.closest("#game-cards button")) { event.preventDefault(); void select(); }
    if (event.key === "Enter" && !event.target.closest("button")) { event.preventDefault(); void select(); }
  });
  dialog.addEventListener("close", () => {
    layoutEditor.close();
    ++generation; ++artworkRequest; drag = null; fade?.cancel(); fade = null; renderer?.setAnimationLoop(null); clearModels(); clearVideo(); clearPresentation(); libraryPlatformId = null; downloaded.clear(); hydrated.clear(); indexById.clear(); videoPaths.clear(); metadataCache.clear(); metadataPending.clear();
    returnFocus?.focus();
  });
  return {
    isOpen: () => dialog.open,
    async open(platform, homePose) {
      if (dialog.open) return;
      returnFocus = document.activeElement;
      const choices = live ? (platform ? [platform] : []) : samplePlatforms();
      if (platform && !choices.some((item) => item.id === platform.id)) choices.unshift(platform);
      $("game-platform").replaceChildren(...(live ? [] : [new Option("All sample platforms", "all")]), ...choices.map((item) => new Option(item.name, item.id)));
      $("game-platform").disabled = live;
      $("game-platform").value = platform?.id ?? "all";
      $("game-library-title").textContent = live ? "GAME LIBRARY" : "GAME LIBRARY · ARTWORK PREVIEW";
      dialog.style.opacity = "0"; dialog.showModal(); closing = false;
      if (!renderer) createScene();
      padReady = false; lastFrame = performance.now(); resize();
      renderer.setAnimationLoop(animate);
      const platformId = $("game-platform").value;
      const entrancePose = !reducedMotion() && !document.hidden && homePose?.id === platform?.id ? homePose : null;
      const ready = loadPresentation(platformId, entrancePose);
      const pending = populate(platformId), opened = generation;
      await ready;
      if (!dialog.open || closing || generation !== opened) return;
      await Promise.all([pending, fadeTo(1)]);
      if (!dialog.open || generation !== opened) return;
      if (dialog.open) $("game-cards").querySelector('[aria-current="true"]')?.focus({ preventScroll: true });

    },
  };
}
