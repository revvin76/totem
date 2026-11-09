import './studio-panel-resize.css';

export function bindStudioPanelResize(panel, { container, top = () => 0, onResize, apply } = {}) {
  const corners = ['nw', 'ne', 'sw', 'se'];
  const names = ['top left', 'top right', 'bottom left', 'bottom right'];
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const handles = corners.map((corner, index) => {
    const handle = document.createElement('span');
    handle.className = 'studio-panel-resize';
    handle.dataset.corner = corner;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `Resize from ${names[index]} with arrow keys`);
    panel.append(handle);
    return handle;
  });
  function geometry() {
    const bounds = container?.getBoundingClientRect();
    const left = bounds?.left ?? 0, offsetY = bounds?.top ?? 0;
    const rect = panel.getBoundingClientRect();
    return {
      left, offsetY, top: Math.max(top(), offsetY),
      right: bounds?.right ?? innerWidth, bottom: bounds?.bottom ?? innerHeight,
      rect,
    };
  }
  function resize(corner, { left, offsetY, top, right, bottom, rect }, dx, dy) {
    const west = corner.endsWith('w'), north = corner.startsWith('n');
    const minWidth = Math.min(220, right - left), minHeight = Math.min(120, bottom - top);
    const x = west ? clamp(rect.left + dx, left, rect.right - minWidth) : rect.left;
    const y = north ? clamp(rect.top + dy, top, rect.bottom - minHeight) : rect.top;
    const endX = west ? rect.right : clamp(rect.right + dx, x + minWidth, right);
    const endY = north ? rect.bottom : clamp(rect.bottom + dy, y + minHeight, bottom);
    const position = { left: x - left, top: y - offsetY };
    const size = { width: endX - x, height: endY - y };
    if (apply) { apply({ ...position, ...size }); return; }
    Object.assign(panel.style, {
      left: `${position.left}px`, top: `${position.top}px`, right: 'auto',
      width: `${size.width}px`, height: `${size.height}px`,
    });
    onResize?.(position);
  }
  let drag;
  for (const handle of handles) {
    const { corner } = handle.dataset;
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, geometry: geometry() };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener('pointermove', event => {
      if (event.pointerId !== drag?.id) return;
      resize(corner, drag.geometry, event.clientX - drag.x, event.clientY - drag.y);
    });
    handle.addEventListener('lostpointercapture', event => {
      if (event.pointerId === drag?.id) drag = null;
    });
    handle.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      resize(corner, geometry(), ...delta);
    });
  }
  // The Platform Chooser panels scroll as a whole. Keep the handles at the frame.
  panel.addEventListener('scroll', () => {
    panel.style.setProperty('--panel-scroll-x', `${panel.scrollLeft}px`);
    panel.style.setProperty('--panel-scroll-y', `${panel.scrollTop}px`);
  });
}
