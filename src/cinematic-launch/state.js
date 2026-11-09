const transitions = {
  DISABLED: ['IDLE'],
  IDLE: ['DISABLED', 'LAUNCHING'],
  LAUNCHING: ['WAITING_FOR_WINDOW', 'COMPLETED', 'FAILED'],
  WAITING_FOR_WINDOW: ['CAPTURING', 'ZOOMING_IN', 'FAILED'],
  CAPTURING: ['ZOOMING_IN', 'FAILED'],
  ZOOMING_IN: ['HANDING_OFF', 'FAILED'],
  HANDING_OFF: ['NATIVE_GAMEPLAY', 'FAILED'],
  NATIVE_GAMEPLAY: ['RESTORING', 'FAILED'],
  RESTORING: ['ZOOMING_OUT', 'FAILED'],
  ZOOMING_OUT: ['COMPLETED', 'FAILED'],
  COMPLETED: ['IDLE'],
  FAILED: ['IDLE'],
};

export function createCinematicState(enabled = false) {
  let current = enabled ? 'IDLE' : 'DISABLED';
  return {
    get current() { return current; },
    move(next) {
      if (!transitions[current].includes(next))
        throw new Error(`Invalid cinematic transition ${current} → ${next}`);
      current = next;
    },
  };
}
