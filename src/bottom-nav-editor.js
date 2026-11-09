import { bottomNavSide } from './studio-page-settings.js';

export function createBottomNavEditor({ items, actions, toggleLabels = {}, add, change, undo, redo, canUndo, canRedo }) {
  const editor = document.createElement('details');
  editor.className = 'control-section bottom-editor';
  editor.open = true;
  editor.innerHTML = `
    <summary>Bottom Nav builder</summary>
    <div id="bottom-items"></div>
    <div class="mode-row">
      <button id="bottom-undo" type="button">Undo button edit</button>
      <button id="bottom-redo" type="button">Redo</button>
    </div>
    <div class="mode-row"><label>Add action <select id="bottom-add-action"></select></label>
    <button type="button" id="bottom-add" draggable="true">Add to Bottom Nav</button></div>`;
  const undoButton = editor.querySelector('#bottom-undo');
  const redoButton = editor.querySelector('#bottom-redo');
  undoButton.onclick = undo;
  redoButton.onclick = redo;
  const addAction = editor.querySelector('#bottom-add-action');
  for (const [id, label] of Object.entries(actions)) {
    if (id !== 'none') addAction.add(new Option(label, id));
  }
  const addControl = editor.querySelector('#bottom-add');
  addControl.onclick = () => addButton(addAction.value);
  addControl.ondragstart = event => event.dataTransfer.setData('application/totem-button', addAction.value);
  const list = editor.querySelector('#bottom-items');
  function updateHistory() {
    undoButton.disabled = !canUndo();
    redoButton.disabled = !canRedo();
  }
  let selectedId;
  function selectButton(id) {
    if (selectedId === id) return;
    selectedId = id;
    render();
    editor.dispatchEvent(new Event('bottom-nav-selection'));
  }
  function addButton(action, region) {
    const id = add(action, region);
    if (id) selectButton(id);
  }
  function render() {
    const focus = list.contains(document.activeElement) ? document.activeElement : null;
    const focusedField = focus?.dataset.field;
    list.replaceChildren();
    updateHistory();
    const index = items().findIndex(item => item.id === selectedId);
    const item = items()[index];
    if (!item) {
      list.textContent = 'Select a Bottom Nav button to edit it.';
      if (focus) addAction.focus();
      return;
    }
    const row = document.createElement('div');
    row.className = 'bottom-item';
    const input = document.createElement('input');
    input.value = item.label ?? '';
    input.dataset.field = 'label';
    input.onchange = () => { item.label = input.value; change(false); };
    const select = document.createElement('select');
    select.dataset.field = 'action';
    for (const [value, text] of Object.entries(actions)) select.add(new Option(text, value));
    select.value = item.action;
    select.onchange = () => { item.action = select.value; change(); };
    const labelField = document.createElement('label');
    labelField.append('Label', input);
    const actionField = document.createElement('label');
    actionField.append('Action', select);
    row.append(labelField, actionField);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.dataset.field = 'remove';
    remove.setAttribute('aria-label', 'Remove selected button');
    remove.onclick = () => { items().splice(index, 1); change(); };
    row.append(remove);
    const labels = toggleLabels[item.action];
    if (labels) {
      const toggle = document.createElement('label');
      toggle.className = 'bottom-toggle-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.toggleLabel === true;
      checkbox.dataset.field = 'toggleLabel';
      toggle.append(checkbox, 'Toggle label');
      const fields = document.createElement('div');
      fields.className = 'bottom-toggle-fields';
      for (const [key, state] of [['labelOn', 'on'], ['labelOff', 'off']]) {
        const field = document.createElement('label');
        const text = document.createElement('input');
        const caption = `Label when ${labels.state} is ${state}`;
        text.value = item[key] ?? labels[state];
        text.dataset.field = key;
        text.onchange = () => { item[key] = text.value; change(false); };
        field.append(caption, text);
        fields.append(field);
      }
      const syncFields = () => {
        fields.hidden = !checkbox.checked;
        input.disabled = checkbox.checked;
      };
      checkbox.onchange = () => {
        item.toggleLabel = checkbox.checked;
        syncFields();
        change(false);
      };
      syncFields();
      row.append(toggle, fields);
    }
    list.append(row);
    if (focus) {
      const controls = [...row.querySelectorAll('button, input, select')];
      const next = controls.find(control => !control.disabled && control.dataset.field === focusedField)
        ?? controls.find(control => !control.disabled) ?? addAction;
      next?.focus();
    }
  }
  return { editor, render, updateHistory, selectButton, addButton, selectedId: () => selectedId };
}

const navButton = 'button[data-nav-id]';
const addType = 'application/totem-button';

export function bindBottomNavDrag(bar, { items, editor, change, openPanel, region, dropBars = [[region, bar]] }) {
  let drag, highlightedBar;
  const preview = document.createElement('div');
  preview.className = 'chooser-bottom-nav bottom-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  const marker = document.createElement('div');
  marker.className = 'bottom-drop-marker';
  marker.setAttribute('aria-hidden', 'true');
  const buttons = () => [...bar.querySelectorAll(navButton)];
  const visibleButtons = () => buttons().filter(button => !button.hidden);
  const sideOf = button => button.classList.contains('bottom-end') ? 'end' : 'start';
  function refresh() {
    if (drag && !bar.contains(drag.button)) clearDrag();
    for (const button of buttons()) {
      button.setAttribute('aria-pressed', String(button.dataset.navId === editor.selectedId()));
    }
  }
  function select(button) {
    editor.selectButton(button.dataset.navId);
    refresh();
  }
  function move(id, side, neighbour, after = false, destination = region) {
    const entries = items();
    const source = entries.findIndex(item => item.id === id);
    if (source < 0) return;
    const item = entries[source];
    let index = neighbour ? entries.findIndex(entry => entry.id === neighbour.dataset.navId) + Number(after) : entries.length;
    if (index > source) index--;
    if (index === source && side === bottomNavSide(item) && (destination ?? undefined) === item.region) return;
    item.align = side;
    if (destination) item.region = destination;
    else delete item.region;
    entries.splice(source, 1);
    entries.splice(index, 0, item);
    change();
  }

  const observer = new MutationObserver(refresh);
  observer.observe(bar, { childList: true });
  editor.editor.addEventListener('bottom-nav-selection', refresh);
  bar.setAttribute('data-select-mode', '');
  refresh();

  bar.addEventListener('click', event => {
    const button = event.target.closest(navButton);
    if (!button) {
      editor.selectButton(undefined);
      refresh();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    select(button);
    openPanel();
  }, true);
  bar.addEventListener('keydown', event => {
    const button = event.target.closest(navButton);
    if (!button || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const visible = visibleButtons();
    const left = event.key === 'ArrowLeft';
    const neighbour = visible[visible.indexOf(button) + (left ? -1 : 1)];
    select(button);
    openPanel();
    const side = neighbour ? sideOf(neighbour) : region ? sideOf(button) : left ? 'start' : 'end';
    if (neighbour || side !== sideOf(button)) {
      move(button.dataset.navId, side, neighbour, !left);
      buttons().find(entry => entry.dataset.navId === button.dataset.navId)?.focus();
    }
  });
  function inBar(event, bounds) {
    return event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  }
  function clearDrag() {
    drag?.button.removeAttribute('data-drag-source');
    drag = null;
    preview.remove();
    marker.remove();
    clearHighlight();
  }
  function clearHighlight() {
    if (highlightedBar) delete highlightedBar.dataset.dropSide;
    highlightedBar = null;
  }
  function dropTarget(event) {
    const zone = dropBars.find(([, candidate]) => inBar(event, candidate.getBoundingClientRect()));
    if (!zone) return null;
    const [destination, targetBar] = zone;
    const bounds = targetBar.getBoundingClientRect();
    const side = destination ? (destination === 'hardware-start' ? 'start' : 'end')
      : event.clientX < bounds.left + bounds.width / 2 ? 'start' : 'end';
    const siblings = [...targetBar.querySelectorAll(navButton)]
      .filter(button => !button.hidden && button !== drag.button && sideOf(button) === side);
    const before = siblings.find(button => {
      const rect = button.getBoundingClientRect();
      return event.clientX < rect.left + rect.width / 2;
    });
    return { side, neighbour: before ?? siblings.at(-1), after: !before, destination, targetBar, bounds };
  }
  bar.addEventListener('pointerdown', event => {
    const button = event.target.closest(navButton);
    if (!button || !event.isPrimary || event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    drag = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, moved: false };
    button.setPointerCapture(event.pointerId);
  });
  bar.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      select(drag.button);
      const clone = drag.button.cloneNode(true);
      clone.tabIndex = -1;
      clone.removeAttribute('data-nav-id');
      clone.removeAttribute('aria-pressed');
      clone.classList.remove('bottom-end');
      preview.replaceChildren(clone);
      document.body.append(preview);
      drag.button.setAttribute('data-drag-source', '');
    }
    preview.style.left = `${event.clientX - drag.offsetX}px`;
    preview.style.top = `${event.clientY - drag.offsetY}px`;
    const target = dropTarget(event);
    if (!target) {
      clearHighlight();
      marker.remove();
      return;
    }
    const { side, neighbour, after, targetBar, bounds } = target;
    const rect = neighbour?.getBoundingClientRect();
    const x = rect ? (after ? rect.right + 3 : rect.left - 3) : side === 'start' ? bounds.left + 8 : bounds.right - 8;
    marker.style.left = `${Math.max(bounds.left + 3, Math.min(x, bounds.right - 3))}px`;
    marker.style.top = `${bounds.top + 4}px`;
    marker.style.height = `${bounds.height - 8}px`;
    if (!marker.isConnected) document.body.append(marker);
    if (highlightedBar !== targetBar) clearHighlight();
    highlightedBar = targetBar;
    highlightedBar.dataset.dropSide = side;
  });
  bar.addEventListener('pointerup', event => {
    if (event.pointerId !== drag?.pointerId) return;
    const target = drag.moved ? dropTarget(event) : null;
    const id = drag.button.dataset.navId;
    clearDrag();
    if (!target) return;
    move(id, target.side, target.neighbour, target.after, target.destination ?? null);
    openPanel();
  });
  bar.addEventListener('lostpointercapture', event => {
    if (event.pointerId === drag?.pointerId) clearDrag();
  });
  bar.addEventListener('dragover', event => {
    if (event.dataTransfer.types.includes(addType)) event.preventDefault();
  });
  bar.addEventListener('drop', event => {
    const action = event.dataTransfer.getData(addType);
    if (!action) return;
    event.preventDefault();
    editor.addButton(action, region);
    openPanel();
    refresh();
  });
}
