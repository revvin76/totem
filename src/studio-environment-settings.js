export const DEFAULT_ENVIRONMENT_SETTINGS = Object.freeze({
  lightsEnabled: true, hue: 260, brightness: 1.2,
  lightReflection: 0.65, consoleReflection: 0.65,
  lightX: 0, lightY: 0, lightZ: 0, reflectionsEnabled: true,
});

export const PLATFORM_LIGHTS = Object.freeze({
  key: 'Console key', fill: 'Console fill', spot: 'Following spotlight',
  blue: 'Blue backdrop', violet: 'Violet backdrop', pink: 'Pink backdrop', orange: 'Orange backdrop',
});
export const DEFAULT_PLATFORM_LIGHT = Object.freeze({ x: 0, y: 0, z: 0, intensity: 1, enabled: true });

export function normalizePlatformLights(value) {
  const lights = {};
  for (const id of Object.keys(PLATFORM_LIGHTS)) {
    const light = value?.[id];
    if (!light || typeof light !== 'object') continue;
    const settings = { ...DEFAULT_PLATFORM_LIGHT, enabled: light.enabled !== false };
    for (const key of ['x', 'y', 'z', 'intensity']) {
      const number = light[key];
      if (!Number.isFinite(number)) continue;
      settings[key] = key === 'intensity' ? Math.min(3, Math.max(0, number)) : Math.min(100, Math.max(-100, number));
    }
    if (typeof light.color === 'string' && /^#[\da-f]{6}$/i.test(light.color)) settings.color = light.color;
    lights[id] = settings;
  }
  return lights;
}

export function normalizeEnvironmentSettings(value = {}) {
  const result = {};
  const ranges = { hue: [0, 360], brightness: [0.3, 2.4], lightReflection: [0, 1],
    consoleReflection: [0, 1], lightX: [-12, 12], lightY: [-8, 8], lightZ: [-15, 15] };
  for (const [key, fallback] of Object.entries(DEFAULT_ENVIRONMENT_SETTINGS)) {
    if (typeof fallback === "boolean") result[key] = value[key] !== false;
    else {
      const number = Number(value[key] ?? fallback);
      result[key] = Number.isFinite(number) ? Math.min(ranges[key][1], Math.max(ranges[key][0], number)) : fallback;
    }
  }
  return result;
}

export function resolveStudioEnvironment(document = {}) {
  const legacy = document.defaults?.handheld?.settings ?? document.defaults?.console?.settings ??
    Object.values(document.defaults ?? {}).find((entry) => entry.settings)?.settings ?? {};
  return normalizeEnvironmentSettings(document.environment ?? legacy);
}
