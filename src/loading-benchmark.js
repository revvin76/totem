// Explicit DEV-only local benchmark. No settings or catalogue save commands.
export async function runLoadingBenchmark({ config, residency, profile, save, finish, navigate, navigateTo, selectedId, collection, collectionSize, filter, restore, invalidate }) {
  const key = 'totem.loading-benchmark.counter';
  const previous = JSON.parse(sessionStorage.getItem(key) || 'null');
  const index = previous?.label === config.label ? previous.index : 0;
  const persistentState = JSON.stringify(Object.entries(localStorage).sort());
  profile.session.label = `${config.label}-${index}`;
  profile.session.cacheCondition = config.reloads && index > 0 ? 'same-process page reload; Windows and WebView caches warm' : 'fresh native process; Windows filesystem and WebView caches not flushed';
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = performance.now() + 120000;
  const bounded = promise => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error('Benchmark deadline exceeded')), Math.max(0, Math.min(60000, deadline - performance.now()))))]);
  const checks = [];
  const measurementSelection = selectedId();
  const check = name => {
    const snapshot = residency.snapshot();
    if (!profile.libraryScan || !collectionSize() || !snapshot.displayIds.includes(selectedId()) || snapshot.displayIds.some(id => !snapshot.desiredDisplayIds.includes(id)) || snapshot.displayIds.length !== snapshot.desiredDisplayIds.length || snapshot.previewIds.length !== collectionSize() || snapshot.inFlight || snapshot.displayIds.length > 3 || snapshot.maxObservedInFlight > 3 || snapshot.failures.length)
      throw Error(`Residency invariant failed: ${name} ${JSON.stringify(snapshot)}`);
    checks.push({ name, selected: selectedId(), snapshot });
  };
  try {
    await bounded(residency.settled());
    check('startup');
    await bounded(pause(10000));
    await bounded(residency.settled());
    if (selectedId() !== measurementSelection) throw Error('Selection changed during startup measurement');
    check('measurement-ready');
    await bounded(save('benchmark-measurement'));
    if (config.scenario) {
      navigate(1); await bounded(residency.settled()); check('next');
      navigate(-1); await bounded(residency.settled()); check('previous');
      navigateTo(collection.length - 1); await bounded(residency.settled());
      navigate(1); await bounded(residency.settled()); check('wraparound');
      navigateTo(Math.floor(collection.length / 2)); await bounded(residency.settled()); check('direct-jump');
      for (const i of [0, collection.length - 1, 1, collection.length - 2, 2]) navigateTo(i);
      await bounded(residency.settled()); check('rapid-jumps');
      await filter(); await bounded(residency.settled()); check('filtered');
      await restore(); await bounded(residency.settled()); check('filter-restored');
      await invalidate(); await bounded(residency.settled()); check('virtual-edit-invalidation');
      await restore(); await bounded(residency.settled()); check('original-catalogue-restored');
    }
    if (JSON.stringify(Object.entries(localStorage).sort()) !== persistentState)
      throw Error('Persistent browser state changed during benchmark');
    profile.benchmark = { checks, persistentStateUnchanged: true, completed: true };
    await bounded(save('benchmark-complete'));
  } catch (error) {
    profile.benchmark = { checks, completed: false, error: String(error) };
    await Promise.race([save('benchmark-failed'), pause(5000)]);
  }
  if (index < config.reloads) {
    sessionStorage.setItem(key, JSON.stringify({ label: config.label, index: index + 1 }));
    location.reload();
  } else {
    sessionStorage.removeItem(key);
    await bounded(finish());
  }
}
