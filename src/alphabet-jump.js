const alphabetDirection = action => action === "previous-letter" ? -1 : action === "next-letter" ? 1 : 0;

function initial(title) {
  const first = title.trim().normalize("NFD").replace(/^\p{P}+/u, "").trimStart().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

export function alphabetGroups(items, titleOf) {
  const groups = new Map();
  for (const item of items) {
    const letter = initial(titleOf(item));
    if (!groups.has(letter)) groups.set(letter, item);
  }
  return [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function nextIndex(index, direction, count) {
  return index < 0 ? (direction > 0 ? 0 : count - 1) : (index + direction + count) % count;
}

export function mountAlphabetJump(host, { items, selected, titleOf, select }) {
  const panel = document.createElement("section");
  panel.className = "alphabet-jump";
  panel.setAttribute("aria-label", "Jump to a letter");
  panel.hidden = true;
  const heading = document.createElement("strong");
  heading.textContent = "Jump to a letter";
  const letters = document.createElement("div");
  letters.className = "alphabet-jump-letters";
  const hint = document.createElement("small");
  hint.textContent = "← / → Browse · Release to jump";
  const announcement = document.createElement("span");
  announcement.className = "alphabet-jump-announcement";
  announcement.setAttribute("aria-live", "polite");
  panel.append(heading, letters, hint, announcement);
  host.append(panel);

  const jump = createAlphabetJump({ items, selected, titleOf, select,
    show(groups) {
      letters.replaceChildren(...groups.map(([letter]) => {
        const tile = document.createElement("span");
        tile.textContent = letter;
        return tile;
      }));
      panel.hidden = false;
    },
    highlight(index, letter) {
      for (let i = 0; i < letters.children.length; i++) {
        letters.children[i].classList.toggle("selected", i === index);
      }
      const active = letters.children[index];
      letters.scrollLeft = active.offsetLeft - (letters.clientWidth - active.offsetWidth) / 2;
      announcement.textContent = letter;
    },
    hide() { panel.hidden = true; },
  });
  window.addEventListener("blur", jump.cancel);
  document.addEventListener("visibilitychange", jump.cancel);
  return jump;
}

export function createAlphabetJump({ items, selected, titleOf, select, show, highlight, hide }) {
  let gesture;

  function cancel() {
    if (gesture?.open) hide();
    gesture = undefined;
  }

  function move(groups, index, direction) {
    if (groups.length < 2 && index >= 0) return;
    const item = groups[nextIndex(index, direction, groups.length)]?.[1];
    if (item != null) select(item);
  }

  function currentIndex(groups) {
    const item = selected();
    const letter = item == null ? null : initial(titleOf(item));
    return groups.findIndex(([key]) => key === letter);
  }

  return {
    cancel,
    jump(direction) {
      const groups = alphabetGroups(items(), titleOf);
      move(groups, currentIndex(groups), direction);
    },
    poll(now, pressed, previous, enabled, actionForInput) {
      if (!enabled) { cancel(); return false; }
      if (!gesture) {
        const input = [...pressed].find(key => !previous.has(key) && alphabetDirection(actionForInput(key)));
        if (!input) return false;
        const list = items();
        const groups = alphabetGroups(list, titleOf);
        if (!groups.length) return true;
        gesture = { input, list, groups, index: currentIndex(groups), direction: alphabetDirection(actionForInput(input)), start: now };
        return true;
      }
      if (items() !== gesture.list) { cancel(); return true; }
      const { groups, index, direction, input } = gesture;
      if (!pressed.has(input)) {
        const item = gesture.open ? groups[index][1] : null;
        cancel();
        if (item != null) select(item);
        else move(groups, index, direction);
        return true;
      }
      if (!gesture.open && now - gesture.start >= 350) {
        gesture.open = true;
        gesture.index = Math.max(0, index);
        show(groups);
        highlight(gesture.index, groups[gesture.index][0]);
      }
      if (gesture.open) {
        const step = pressed.has("left") || pressed.has("stick-leftward") ? -1
          : pressed.has("right") || pressed.has("stick-rightward") ? 1 : 0;
        if (step && (step !== gesture.step || now >= gesture.repeatAt)) {
          gesture.index = nextIndex(gesture.index, step, groups.length);
          gesture.repeatAt = now + (step === gesture.step ? 140 : 310);
          highlight(gesture.index, groups[gesture.index][0]);
        }
        gesture.step = step;
      }
      return true;
    },
  };
}
