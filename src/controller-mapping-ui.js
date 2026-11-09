import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { addStudioLighting, configureStudioRenderer } from "./lighting.js";
import { createControllerModel } from "./controller-models.js";
import { createMappingStore } from "./mapping-store.js";
import {
  ACK_DURATION,
  CONTROLLERS,
  INPUTS,
  MappingRun,
  XBOX,
  controllerForPlatform,
  gamepadInputs,
  inputLabel,
  pairingIntensity,
  revealView,
  suggestedBindings,
} from "./controller-mapping.js";
import "./controller-mapping.css";

function createPane(host, onPress, onRelease) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  configureStudioRenderer(renderer);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  const generator = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  scene.environment = generator.fromScene(room, 0.04).texture;
  room.dispose();
  generator.dispose();
  addStudioLighting(scene, camera);
  const pivot = new THREE.Group();
  scene.add(pivot);
  let model,
    size = new THREE.Vector3(4, 3, 1),
    rest = "front";
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance =
      Math.max(size.y / 2 / tangent, size.x / 2 / tangent / camera.aspect) *
        1.28 +
      size.z;
    camera.position.set(0, 0.12, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  let pointerControl;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!onPress || !model) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(model.root.children, true)[0];
    let object = hit?.object;
    while (object && !object.userData.controlId) object = object.parent;
    if (object?.userData.controlId) {
      pointerControl = object.userData.controlId;
      renderer.domElement.setPointerCapture(event.pointerId);
      onPress(pointerControl);
    }
  });
  const release = () => {
    if (pointerControl) onRelease?.(pointerControl);
    pointerControl = null;
  };
  renderer.domElement.addEventListener("pointerup", release);
  renderer.domElement.addEventListener("pointercancel", release);
  renderer.domElement.addEventListener("lostpointercapture", release);
  return {
    setProfile(profile) {
      if (model) {
        pivot.remove(model.root);
        model.dispose();
      }
      model = createControllerModel(profile);
      pivot.add(model.root);
      const bounds = new THREE.Box3().setFromObject(model.root);
      bounds.getSize(size);
      model.root.position.sub(bounds.getCenter(new THREE.Vector3()));
      pivot.rotation.set(0, 0, 0);
      rest = "front";
      resize();
    },
    setRest(view) {
      rest = view;
    },
    render(states, reveal, dt, reducedMotion) {
      if (!model) return;
      const view = reveal ?? rest;
      const [pitch, yaw] =
        view === "rear"
          ? [-0.12, Math.PI]
          : view === "top"
            ? [1.12, 0]
            : [-0.12, 0];
      pivot.rotation.x = reducedMotion
        ? pitch
        : THREE.MathUtils.damp(pivot.rotation.x, pitch, 7, dt);
      pivot.rotation.y = reducedMotion
        ? yaw
        : THREE.MathUtils.damp(pivot.rotation.y, yaw, 7, dt);
      model.highlight(states);
      renderer.render(scene, camera);
    },
  };
}

export function mountControllerMapping({
  native,
  getPlatforms,
  reducedMotion,
}) {
  const $ = (id) => document.getElementById(id),
    dialog = $("mapping-dialog");
  const storePromise = createMappingStore(native, () =>
    getPlatforms().map((p) => p.id),
  );
  // Handle storage-opening failure inside open(), including when it occurs early.
  storePromise.catch(() => {});
  let platformId,
    controller,
    profiles = [],
    bindings = {},
    skipped = [],
    run = null,
    draftId,
    createdAt;
  let saving = false,
    opening = 0,
    legacyPane,
    xboxPane,
    selectedPad = null,
    previousPadInputs = new Set(),
    padIdentity = null;
  let virtual = new Set(),
    lastInputs = new Set(),
    lastSignature = "",
    lastTime = 0,
    lastPadList = "",
    lastConnection = "";
  let activeProfile = "suggested";
  const rows = new Map(),
    demoButtons = new Map();
  const status = (message) => {
    $("mapping-status").textContent = message;
  };
  function controlsLocked() {
    for (const id of [
      "mapping-platform",
      "mapping-controller",
      "mapping-profile",
    ])
      $(id).disabled = !!run || saving;
    $("mapping-new").hidden = !!run;
    $("mapping-discard").hidden = !run;
    $("mapping-discard").disabled = saving;
    $("mapping-skip").hidden = !run || run.phase === "complete";
    $("mapping-skip").disabled = saving || run?.phase === "ack";
    $("mapping-back").hidden = !run;
    $("mapping-back").disabled = saving || run?.phase === "ack" || !run?.index;
    $("mapping-save").hidden = !run || run.phase !== "complete";
    $("mapping-save").disabled = saving;
    $("mapping-name-label").hidden = !run;
    $("mapping-name").disabled = saving;
    $("mapping-progress").hidden = !run;
  }
  function drawRows() {
    rows.clear();
    $("mapping-rows").replaceChildren();
    for (const control of controller.controls) {
      const row = document.createElement("tr");
      for (const text of [control.label, "", ""]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      rows.set(control.id, row);
      $("mapping-rows").append(row);
    }
    lastSignature = "";
  }
  function profileOptions(prefer = activeProfile) {
    const select = $("mapping-profile");
    select.replaceChildren(
      new Option("Suggested Xbox default (not saved)", "suggested"),
    );
    const matching = profiles
      .filter(
        (p) => p.platformId === platformId && p.controllerId === controller.id,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const profile of matching)
      select.add(new Option(profile.name, profile.id));
    activeProfile = matching.some((p) => p.id === prefer)
      ? prefer
      : "suggested";
    select.value = activeProfile;
  }
  function selectProfile() {
    activeProfile = $("mapping-profile").value;
    const profile = profiles.find((p) => p.id === activeProfile);
    bindings = profile
      ? structuredClone(profile.bindings)
      : suggestedBindings(controller);
    skipped = profile ? [...profile.skipped] : [];
    $("mapping-save-status").textContent = profile
      ? `Saved profile · ${profile.name}`
      : "Suggested Xbox default · not saved. Create a new mapping to choose your own assignments.";
    $("mapping-mode").textContent = profile
      ? "VIEW SAVED MAPPING"
      : "VIEW SUGGESTED MAPPING";
    status(
      "Hold an Xbox input: both mapped controls glow green. Release to return the view.",
    );
    drawRows();
    controlsLocked();
  }
  function selectController(id, prefer) {
    controller =
      CONTROLLERS.find((c) => c.id === id) ?? controllerForPlatform(platformId);
    $("mapping-controller").value = controller.id;
    $("mapping-legacy-name").textContent = controller.name;
    $("mapping-legacy-note").textContent = controller.note;
    legacyPane?.setProfile(controller);
    profileOptions(prefer);
    selectProfile();
    for (const group of document.querySelectorAll(".mapping-view-buttons"))
      for (const button of group.querySelectorAll("button"))
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.view === "front"),
        );
    xboxPane?.setRest("front");
  }
  function selectPlatform(id) {
    platformId = id;
    $("mapping-platform").value = id;
    const latest = profiles
      .filter((p) => p.platformId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    selectController(
      latest?.controllerId ?? controllerForPlatform(id).id,
      latest?.id,
    );
  }
  function padState() {
    let pads = [];
    try {
      pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p?.connected);
    } catch {}
    const signature = pads
      .map((p) => `${p.index}:${p.id}:${p.mapping}`)
      .join("|");
    if (signature !== lastPadList) {
      lastPadList = signature;
      const select = $("mapping-gamepad");
      select.replaceChildren();
      const compatible = pads.filter((p) => p.mapping === "standard");
      if (!compatible.some((p) => p.index === selectedPad))
        selectedPad =
          (
            compatible.find((p) => /xbox|xinput|045e/i.test(p.id)) ??
            compatible[0]
          )?.index ?? null;
      if (!pads.length)
        select.add(new Option("Connect your Xbox controller", ""));
      for (const pad of pads) {
        const option = new Option(
          `${pad.id}${pad.mapping === "standard" ? "" : " · unsupported layout"}`,
          String(pad.index),
        );
        option.disabled = pad.mapping !== "standard";
        select.add(option);
      }
      select.value = selectedPad === null ? "" : String(selectedPad);
    }
    const pad = pads.find(
      (p) => p.index === selectedPad && p.mapping === "standard",
    );
    const identity = pad ? `${pad.index}:${pad.id}` : null;
    if (identity !== padIdentity) {
      padIdentity = identity;
      previousPadInputs.clear();
      run?.rearm();
    }
    const preview = $("mapping-preview-mode").checked;
    const connection = preview
      ? "On-screen preview · simulated inputs only"
      : pad
        ? `Connected · ${pad.id}`
        : pads.length
          ? "A standard-mapped gamepad is required. Use on-screen preview to try the flow."
          : "Connect your Xbox controller and press a button to make it available.";
    if (connection !== lastConnection) {
      $("mapping-connection-status").textContent = connection;
      lastConnection = connection;
    }
    return { pad, preview };
  }
  function processInputs(now) {
    const { pad, preview } = padState();
    if (!document.hasFocus() || document.hidden) {
      lastInputs.clear();
      run?.rearm();
      return lastInputs;
    }
    const inputs = preview
      ? new Set(virtual)
      : gamepadInputs(pad, previousPadInputs);
    previousPadInputs = preview ? new Set() : new Set(inputs);
    if (run && (preview || pad)) run.tick(inputs, now);
    lastInputs = inputs;
    return inputs;
  }
  function setVirtual(input, held) {
    if (!dialog.open || !$("mapping-preview-mode").checked || saving) return;
    if (held) virtual.add(input);
    else virtual.delete(input);
    processInputs(performance.now());
    updateText();
  }
  function toggleVirtual(input) {
    setVirtual(input, !virtual.has(input));
  }
  function updateText() {
    if (!controller) return;
    bindings = run?.bindings ?? bindings;
    skipped = run?.skipped ?? skipped;
    const signature = JSON.stringify([
      run?.phase,
      run?.index,
      run?.ackInput,
      run?.message,
      [...lastInputs],
      bindings,
      skipped,
    ]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    controlsLocked();
    if (run) {
      $("mapping-mode").textContent =
        run.phase === "complete"
          ? "REVIEW YOUR MAPPING"
          : run.phase === "ack"
            ? "PAIRED"
            : "CREATE NEW MAPPING";
      $("mapping-prompt").textContent =
        run.phase === "complete"
          ? "Your mapping is ready to save."
          : `${run.phase === "ack" ? "Paired" : "Map"} · ${run.current.label}`;
      status(run.message);
      $("mapping-count").textContent =
        `${run.index} / ${controller.controls.length} controls`;
      $("mapping-progress").max = controller.controls.length;
      $("mapping-progress").value = run.index;
    } else {
      const counterparts = controller.controls.filter((c) =>
        lastInputs.has(bindings[c.id]),
      );
      $("mapping-prompt").textContent = lastInputs.size
        ? `${[...lastInputs].map(inputLabel).join(" + ")} → ${counterparts.map((c) => c.label).join(" + ") || "No assignment"}`
        : "Press an Xbox control to see its counterpart.";
      $("mapping-count").textContent =
        `${Object.keys(bindings).length} mapped${skipped.length ? ` · ${skipped.length} skipped` : ""}`;
    }
    for (const control of controller.controls) {
      const row = rows.get(control.id),
        current = run?.current?.id === control.id;
      const pressed = !run && lastInputs.has(bindings[control.id]);
      row.children[1].textContent = bindings[control.id]
        ? inputLabel(bindings[control.id])
        : skipped.includes(control.id)
          ? "Unassigned"
          : "—";
      row.children[2].textContent = pressed
        ? "Pressed"
        : current
          ? run.phase === "ack"
            ? "Paired · release to continue"
            : "Waiting for Xbox input"
          : skipped.includes(control.id)
            ? "Skipped"
            : bindings[control.id]
              ? "Mapped"
              : "Pending";
      row.dataset.state = pressed
        ? "pressed"
        : current
          ? run.phase === "ack"
            ? "paired"
            : "waiting"
          : "rest";
    }
    if (run?.current) {
      const row = rows.get(run.current.id),
        wrap = $("mapping-rows").closest(".mapping-table-wrap");
      const rectangle = row?.getBoundingClientRect(),
        visible = wrap.getBoundingClientRect();
      if (rectangle?.bottom > visible.bottom)
        wrap.scrollTop += rectangle.bottom - visible.bottom;
      if (rectangle?.top < visible.top + 65)
        wrap.scrollTop += rectangle.top - visible.top - 65;
    }
    for (const [input, button] of demoButtons)
      button.setAttribute("aria-pressed", String(lastInputs.has(input)));
  }
  function startRun() {
    run = new MappingRun(controller);
    draftId = `map-${crypto.randomUUID()}`;
    createdAt = new Date().toISOString();
    $("mapping-name").value = `${controller.name} · My Xbox mapping`.slice(
      0,
      100,
    );
    $("mapping-save-status").textContent =
      "Unsaved mapping run. Your existing profiles will be kept.";
    virtual.clear();
    lastInputs.clear();
    lastSignature = "";
    drawRows();
    updateText();
  }
  function clearInputs() {
    virtual.clear();
    lastInputs.clear();
    previousPadInputs.clear();
    run?.rearm();
    lastSignature = "";
  }
  $("mapping-preview-mode").addEventListener("change", () => {
    clearInputs();
    const preview = $("mapping-preview-mode").checked;
    $("mapping-preview-controls").hidden = !preview;
    $("mapping-hold-label").hidden = !preview;
    updateText();
  });
  $("mapping-hold").addEventListener("change", () => {
    clearInputs();
    updateText();
  });
  $("mapping-gamepad").addEventListener("change", () => {
    selectedPad = Number($("mapping-gamepad").value);
    padIdentity = null;
    clearInputs();
  });
  $("mapping-new").addEventListener("click", startRun);
  $("mapping-back").addEventListener("click", () => {
    run?.back();
    clearInputs();
    updateText();
  });
  $("mapping-skip").addEventListener("click", () => {
    run?.skip();
    clearInputs();
    updateText();
  });
  $("mapping-discard").addEventListener("click", () => {
    if (saving) return;
    run = null;
    clearInputs();
    selectProfile();
  });
  $("mapping-platform").addEventListener("change", () => {
    if (!run) selectPlatform($("mapping-platform").value);
  });
  $("mapping-controller").addEventListener("change", () => {
    if (!run) selectController($("mapping-controller").value, "suggested");
  });
  $("mapping-profile").addEventListener("change", () => {
    if (!run) selectProfile();
  });
  $("mapping-save").addEventListener("click", async () => {
    if (!run || run.phase !== "complete" || saving) return;
    const profile = {
      schemaVersion: 1,
      id: draftId,
      name: $("mapping-name").value.trim(),
      platformId,
      controllerId: controller.id,
      createdAt,
      bindings: structuredClone(run.bindings),
      skipped: [...run.skipped],
    };
    saving = true;
    controlsLocked();
    $("mapping-save-status").textContent = "Saving and verifying mapping…";
    try {
      const saved = await (await storePromise).save(profile);
      profiles.push(saved);
      run = null;
      saving = false;
      clearInputs();
      profileOptions(saved.id);
      selectProfile();
      status("Saved. Press an Xbox control to inspect your mapping.");
    } catch (error) {
      $("mapping-save-status").textContent =
        `Could not confirm save: ${error.message ?? error}. Your run is still available.`;
    } finally {
      saving = false;
      controlsLocked();
    }
  });
  function close() {
    if (run || saving) {
      $("mapping-save-status").textContent =
        "Save your completed mapping or Discard run before closing.";
      return;
    }
    opening++;
    clearInputs();
    dialog.close();
    ($("navigation-toggle") ?? $("mapping-toggle")).focus();
  }
  $("mapping-close").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  window.addEventListener("blur", clearInputs);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInputs();
  });
  window.addEventListener("beforeunload", (event) => {
    if (run) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  for (const [input, control] of INPUTS) {
    const button = document.createElement("button");
    button.textContent = control.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if ($("mapping-hold").checked) toggleVirtual(input);
    });
    button.addEventListener("pointerdown", (event) => {
      if (!$("mapping-hold").checked) {
        event.preventDefault();
        button.focus();
        button.setPointerCapture(event.pointerId);
        setVirtual(input, true);
      }
    });
    const release = () => {
      if (!$("mapping-hold").checked) setVirtual(input, false);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("keydown", (event) => {
      if (!$("mapping-hold").checked && [" ", "Enter"].includes(event.key)) {
        event.preventDefault();
        if (!event.repeat) setVirtual(input, true);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (!$("mapping-hold").checked && [" ", "Enter"].includes(event.key)) {
        event.preventDefault();
        setVirtual(input, false);
      }
    });
    button.addEventListener("blur", release);
    demoButtons.set(input, button);
    $("mapping-input-buttons").append(button);
  }
  for (const group of document.querySelectorAll(".mapping-view-buttons"))
    for (const button of group.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        (group.dataset.controllerView === "legacy"
          ? legacyPane
          : xboxPane
        )?.setRest(button.dataset.view);
        for (const sibling of group.querySelectorAll("button"))
          sibling.setAttribute("aria-pressed", String(sibling === button));
      });
    }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000 || 0.016, 0.05);
    lastTime = now;
    if (!dialog.open || document.hidden) return;
    processInputs(now);
    updateText();
    const legacyStates = new Map(),
      xboxStates = new Map();
    let leftView = null,
      rightView = null;
    const highlight = (colour, intensity) => ({ colour, intensity });
    if (run?.current) {
      const elapsed = now - run.ackStart;
      const intensity =
        run.phase === "ack"
          ? elapsed < ACK_DURATION
            ? pairingIntensity(elapsed, true, reducedMotion())
            : 0.7
          : pairingIntensity(now, false, reducedMotion());
      legacyStates.set(run.current.id, highlight("white", intensity));
      leftView = run.current.view;
      if (run.ackInput) {
        const target = INPUTS.get(run.ackInput);
        xboxStates.set(target.id, highlight("white", intensity));
        rightView = target.view;
      }
    } else if (!run && lastInputs.size) {
      const original = controller.controls.filter((c) =>
        lastInputs.has(bindings[c.id]),
      );
      for (const c of original) legacyStates.set(c.id, highlight("green", 1));
      const target = [...lastInputs]
        .map((input) => INPUTS.get(input))
        .filter(Boolean);
      for (const c of target) xboxStates.set(c.id, highlight("green", 1));
      leftView = revealView(original);
      rightView = revealView(target);
    }
    legacyPane?.render(legacyStates, leftView, dt, reducedMotion());
    xboxPane?.render(xboxStates, rightView, dt, reducedMotion());
  }
  requestAnimationFrame(frame);
  return {
    async open(selectedPlatform) {
      const token = ++opening;
      dialog.showModal();
      clearInputs();
      lastPadList = "!";
      lastConnection = "";
      $("mapping-load-error").hidden = true;
      // Refresh from the owning store; only saves made during this load may be
      // merged back, so a corrupt/removed file cannot survive as a stale cache.
      profiles = [];
      const platforms = getPlatforms();
      $("mapping-platform").replaceChildren(
        ...platforms.map((p) => new Option(p.name, p.id)),
      );
      $("mapping-controller").replaceChildren(
        ...CONTROLLERS.map((c) => new Option(c.name, c.id)),
      );
      if (!legacyPane)
        try {
          legacyPane = createPane($("mapping-legacy-scene"));
          xboxPane = createPane(
            $("mapping-xbox-scene"),
            (id) => {
              const input = XBOX.controls.find(
                (c) => c.id === id,
              )?.defaultInput;
              if (input) {
                if ($("mapping-hold").checked) toggleVirtual(input);
                else setVirtual(input, true);
              }
            },
            (id) => {
              if (!$("mapping-hold").checked) {
                const input = XBOX.controls.find(
                  (c) => c.id === id,
                )?.defaultInput;
                if (input) setVirtual(input, false);
              }
            },
          );
          xboxPane.setProfile(XBOX);
        } catch (error) {
          $("mapping-load-error").textContent =
            `3D preview unavailable: ${error.message}. Text assignments and on-screen input controls are available.`;
          $("mapping-load-error").hidden = false;
        }
      selectPlatform(selectedPlatform ?? platforms[0]?.id);
      $("mapping-save-status").textContent = "Loading saved mapping profiles…";
      const initialPlatform = platformId,
        initialController = controller.id;
      try {
        const loaded = await (await storePromise).list();
        if (token !== opening || !dialog.open) return;
        profiles = [
          ...new Map(
            [...loaded.profiles, ...profiles].map((profile) => [
              profile.id,
              profile,
            ]),
          ).values(),
        ];
        if (loaded.errors.length) {
          $("mapping-load-error").hidden = false;
          $("mapping-load-error").textContent =
            `Some saved profiles could not be read and were preserved: ${loaded.errors.join("; ")}`;
        }
        if (!run) {
          if (
            platformId === initialPlatform &&
            controller.id === initialController
          )
            selectPlatform(platformId);
          else {
            profileOptions();
            selectProfile();
          }
        }
      } catch (error) {
        if (token === opening) {
          $("mapping-load-error").hidden = false;
          $("mapping-load-error").textContent =
            `Saved mappings unavailable: ${error.message ?? error}. Files have not been changed.`;
          $("mapping-save-status").textContent =
            "Saved profiles could not be loaded. New profiles saved in this screen remain available.";
        }
      }
    },
  };
}
