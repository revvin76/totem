// Carousel-specific residency: a preview for every platform, display assets
// only for the selected platform and its two wrapping neighbours.
export function createModelResidency({ load, dispose, attach, detach, createPlaceholder, idle = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  const entries = new Map();
  const tasks = new Set();
  const waiters = [];
  const ensures = new Set();
  let platforms = [], selected = 0, desired = [], visible = [], idlePending = false;
  let maxObservedInFlight = 0;

  const show = (entry, model) => {
    if (entry.attached === model) return;
    const previous = entry.attached;
    if (previous) detach(entry.platform, previous);
    entry.attached = model;
    if (model) attach(entry.platform, model, previous);
  };
  const evict = entry => {
    show(entry, null);
    if (entry.display) dispose(entry.display);
    if (entry.preview && entry.preview !== entry.display) dispose(entry.preview);
    entry.display = entry.preview = null;
  };
  const createEntry = platform => {
    const entry = { platform, preview: null, display: null, attached: null, pending: new Set(), failed: new Set() };
    if (createPlaceholder) {
      const placeholder = createPlaceholder(platform);
      if (placeholder) show(entry, placeholder);
    }
    return entry;
  };
  const needed = (entry, tier) => !entry[tier] && !entry.pending.has(tier) && !entry.failed.has(tier);
  const urgent = () => {
    for (const id of visible) {
      const entry = entries.get(id);
      if (needed(entry, 'preview')) return [entry, 'preview'];
    }
    if (visible.some(id => entries.get(id).pending.has('preview'))) return null;
    for (const id of desired) {
      const entry = entries.get(id);
      if (needed(entry, 'preview')) return [entry, 'preview'];
      if (entry.preview && needed(entry, 'display')) return [entry, 'display'];
    }
    for (const request of ensures) {
      if (entries.get(request.id) === request.entry && needed(request.entry, 'preview')) return [request.entry, 'preview'];
    }
    return null;
  };
  const background = () => visible.some(id => entries.get(id).pending.has('preview'))
    ? null : [...entries.values()].find(entry => needed(entry, 'preview'));
  const resolveWaiters = () => {
    for (const request of ensures) {
      const entry = entries.get(request.id);
      const tier = desired.includes(request.id) ? 'display' : 'preview';
      if (entry !== request.entry || entry[tier] || entry.failed.has(tier) || entry.failed.has('preview')) {
        ensures.delete(request);
        request.resolve(entry === request.entry ? entry[tier] ?? entry.preview : null);
      }
    }
    if (tasks.size || idlePending || urgent() || background()) return;
    for (const resolve of waiters.splice(0)) resolve();
  };
  const start = (entry, tier) => {
    entry.pending.add(tier);
    const task = Promise.resolve().then(() => load(entry.platform, tier)).then(model => {
      if (!model) throw new Error(`No ${tier} model for ${entry.platform.id}`);
      if (entries.get(entry.platform.id) !== entry || (tier === 'display' && !desired.includes(entry.platform.id))) {
        dispose(model);
        return;
      }
      entry[tier] = model;
      show(entry, entry.display ?? entry.preview);
    }).catch(() => entry.failed.add(tier)).finally(() => {
      entry.pending.delete(tier);
      tasks.delete(task);
      pump();
    });
    tasks.add(task);
    maxObservedInFlight = Math.max(maxObservedInFlight, tasks.size);
  };
  const pump = () => {
    while (tasks.size < 3) {
      const next = urgent();
      if (!next) break;
      start(...next);
    }
    if (tasks.size < 3 && background() && !idlePending) {
      idlePending = true;
      Promise.resolve().then(idle).catch(() => {}).then(() => {
        idlePending = false;
        if (tasks.size < 3 && !urgent()) {
          const entry = background();
          if (entry) start(entry, 'preview');
        }
        pump();
      });
    }
    resolveWaiters();
  };
  const reprioritize = (index, visibleIds = []) => {
    selected = platforms.length ? ((index % platforms.length) + platforms.length) % platforms.length : 0;
    visible = [...new Set(visibleIds)].filter(id => entries.has(id));
    desired = [...new Set([0, -1, 1].map(offset => platforms[(selected + offset + platforms.length) % platforms.length]?.id).filter(id => id !== undefined))];
    for (const [id, entry] of entries) {
      if (entry.display && !desired.includes(id)) {
        show(entry, entry.preview);
        if (entry.display !== entry.preview) dispose(entry.display);
        entry.display = null;
      }
    }
    pump();
    return settled();
  };
  const settled = () => new Promise(resolve => {
    waiters.push(resolve);
    resolveWaiters();
  });
  return {
    setCollection(next, index = 0, visibleIds = []) {
      if (next.some(platform => typeof platform.id !== 'string') || new Set(next.map(platform => platform.id)).size !== next.length)
        throw new Error('Model collection requires unique string platform IDs');
      const ids = new Set(next.map(platform => platform.id));
      for (const [id, entry] of entries) {
        if (!ids.has(id)) { evict(entry); entries.delete(id); }
      }
      for (const platform of next) {
        const entry = entries.get(platform.id);
        if (entry && entry.platform !== platform) { evict(entry); entries.set(platform.id, createEntry(platform)); }
        else if (!entry) entries.set(platform.id, createEntry(platform));
      }
      platforms = [...next];
      return reprioritize(index, visibleIds);
    },
    reprioritize,
    ensure(id) {
      const entry = entries.get(id);
      if (!entry) return Promise.resolve(null);
      const result = new Promise(resolve => ensures.add({ id, entry, resolve }));
      pump();
      return result;
    },
    invalidate(id, platform = entries.get(id)?.platform) {
      if (platform !== undefined && (!platform || platform.id !== id))
        throw new Error('Invalidated platform must retain its ID');
      const entry = entries.get(id);
      if (entry) { evict(entry); entries.set(id, createEntry(platform)); }
      pump();
      return settled();
    },
    settled,
    snapshot() {
      return {
        desiredDisplayIds: [...desired],
        displayIds: [...entries].filter(([, entry]) => entry.display).map(([id]) => id),
        previewIds: [...entries].filter(([, entry]) => entry.preview).map(([id]) => id),
        inFlight: tasks.size, maxObservedInFlight,
        failures: [...entries].flatMap(([id, entry]) => [...entry.failed].map(tier => ({ id, tier }))),
      };
    },
  };
}
