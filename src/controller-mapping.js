import profiles from "../controller-profiles.json" with { type: "json" };

export const CONTROLLERS = profiles;
export const XBOX = profiles.find((p) => p.id === "xbox-series");
export const INPUTS = new Map(XBOX.controls.map((c) => [c.defaultInput, c]));
export const ACK_DURATION = 900;

export function controllerForPlatform(id) {
  return (
    profiles.find((p) => p.platforms.includes(id)) ??
    profiles.find((p) => p.id === "generic")
  );
}

export function inputLabel(input) {
  return INPUTS.get(input)?.label ?? "Unassigned";
}

export function suggestedBindings(controller) {
  return Object.fromEntries(
    controller.controls
      .filter((c) => c.defaultInput)
      .map((c) => [c.id, c.defaultInput]),
  );
}

export function validateMapping(profile, platformIds) {
  const controller = profiles.find((p) => p.id === profile?.controllerId);
  if (
    !controller ||
    profile.schemaVersion !== 1 ||
    !/^map-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(profile.id)
  )
    throw new Error("Invalid mapping profile or controller layout.");
  if (
    typeof profile.name !== "string" ||
    !profile.name.trim() ||
    profile.name.length > 100
  )
    throw new Error("Give this mapping a name of 1–100 characters.");
  if (!platformIds.includes(profile.platformId))
    throw new Error("Choose a known platform.");
  if (
    typeof profile.createdAt !== "string" ||
    !Number.isFinite(Date.parse(profile.createdAt))
  )
    throw new Error("The mapping creation date is invalid.");
  if (
    !profile.bindings ||
    typeof profile.bindings !== "object" ||
    Array.isArray(profile.bindings) ||
    !Array.isArray(profile.skipped)
  )
    throw new Error("Invalid button assignments.");
  const controls = new Set(controller.controls.map((c) => c.id));
  const complete = new Set(Object.keys(profile.bindings));
  if (!complete.size)
    throw new Error("Map at least one control before saving.");
  for (const [id, input] of Object.entries(profile.bindings))
    if (!controls.has(id) || !INPUTS.has(input))
      throw new Error("Unknown controller button or Xbox input.");
  for (const id of profile.skipped) {
    if (!controls.has(id) || complete.has(id))
      throw new Error(
        "A control cannot be both mapped and skipped, or skipped twice.",
      );
    complete.add(id);
  }
  if (complete.size !== controls.size)
    throw new Error("Finish the mapping run before saving.");
  return structuredClone(profile);
}

// Each step consumes one fresh edge, acknowledges it, then waits for neutral.
// A held input can never leak into the following step.
export class MappingRun {
  constructor(controller) {
    this.controller = controller;
    this.index = 0;
    this.bindings = {};
    this.skipped = [];
    this.phase = "release";
    this.ackInput = null;
    this.ackStart = 0;
    this.message = "Release all controls to begin.";
  }
  get current() {
    return this.controller.controls[this.index] ?? null;
  }
  tick(inputs, now) {
    if (this.phase === "complete") return;
    if (this.phase === "ack") {
      if (now - this.ackStart < ACK_DURATION) return;
      if (inputs.size) {
        this.message = "Release the Xbox control to continue.";
        return;
      }
      this.index++;
      this.ackInput = null;
      if (!this.current) {
        this.phase = "complete";
        this.message = "Mapping run finished. Review and save your profile.";
        return;
      }
      this.phase = "listen";
      this.message = "Press the Xbox control you want to pair.";
    }
    if (this.phase === "release") {
      if (!inputs.size) {
        this.phase = "listen";
        this.message = "Press the Xbox control you want to pair.";
      }
      return;
    }
    if (inputs.size > 1) {
      this.phase = "release";
      this.message =
        "Use one Xbox control at a time. Release all controls, then try again.";
      return;
    }
    if (inputs.size === 1) {
      const input = [...inputs][0];
      if (!INPUTS.has(input)) return;
      this.bindings[this.current.id] = input;
      this.ackInput = input;
      this.ackStart = now;
      this.phase = "ack";
      this.message = `${this.current.label} paired with ${inputLabel(input)}. Release to continue.`;
    }
  }
  rearm() {
    if (this.phase === "listen") this.phase = "release";
  }
  skip() {
    if (!this.current || this.phase === "ack") return;
    this.skipped.push(this.current.id);
    this.index++;
    this.phase = this.current ? "release" : "complete";
    this.message = this.current
      ? "Release all controls for the next step."
      : "Mapping run finished. Review the skipped controls before saving.";
  }
  back() {
    if (this.phase === "ack" || this.index === 0) return;
    this.index--;
    delete this.bindings[this.current.id];
    this.skipped = this.skipped.filter((id) => id !== this.current.id);
    this.phase = "release";
    this.ackInput = null;
    this.message = "Release all controls, then choose this assignment again.";
  }
}

export function pairingIntensity(
  now,
  acknowledge = false,
  reducedMotion = false,
) {
  if (reducedMotion) return acknowledge ? 1 : 0.7;
  if (acknowledge) return Math.floor(now / 225) % 2 === 0 ? 1 : 0.12;
  return 0.25 + 0.75 * ((1 - Math.cos((now / 1600) * Math.PI * 2)) / 2);
}

// Hysteresis keeps stick drift and partly released triggers out of the wizard.
export function gamepadInputs(pad, previous = new Set()) {
  const active = new Set();
  if (!pad || pad.mapping !== "standard" || pad.connected === false)
    return active;
  for (let i = 0; i < Math.min(18, pad.buttons.length); i++) {
    const value = pad.buttons[i]?.value ?? 0;
    if (pad.buttons[i]?.pressed || value > (previous.has(`b${i}`) ? 0.3 : 0.65))
      active.add(`b${i}`);
  }
  for (let i = 0; i < Math.min(4, pad.axes.length); i++)
    for (const [sign, direction] of [
      [-1, "-"],
      [1, "+"],
    ]) {
      const key = `a${i}${direction}`;
      if (pad.axes[i] * sign > (previous.has(key) ? 0.3 : 0.65))
        active.add(key);
    }
  return active;
}

export function revealView(controls) {
  if (controls.some((c) => c?.view === "rear")) return "rear";
  if (controls.some((c) => c?.view === "top")) return "top";
  return "front";
}
