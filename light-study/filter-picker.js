export function mountFilterPicker(panel, search, genre) {
  const picker = document.createElement("section");
  picker.className = "game-filter-picker";
  picker.hidden = true;
  panel.querySelector(".pf-footer").before(picker);
  let origin, buttons = [], columns, index, draft;

  function close() {
    if (picker.hidden) return;
    picker.hidden = true;
    origin.focus();
  }

  function open(field) {
    origin = field;
    const typing = field === search;
    columns = typing ? 10 : 1;
    draft = search.value;
    picker.style.setProperty("--picker-columns", columns);
    const title = document.createElement("strong");
    title.textContent = typing ? "Type a game title" : "Choose a genre";
    const preview = document.createElement("output");
    preview.textContent = draft || " ";
    const grid = document.createElement("div");
    grid.className = "game-filter-picker-grid";
    const options = typing
      ? [..."1234567890QWERTYUIOPASDFGHJKL-ZXCVBNM'.,", "Space", "Delete", "Done"]
      : [...genre.options].map(option => option.label);
    buttons = options.map((label, position) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pf-command";
      button.textContent = label;
      if (!typing) button.setAttribute("aria-pressed", String(position === genre.selectedIndex));
      button.addEventListener("focus", () => { index = position; });
      button.addEventListener("click", () => {
        if (!typing) {
          genre.selectedIndex = position;
          genre.dispatchEvent(new Event("change", { bubbles: true }));
          close();
        } else if (label === "Done") {
          search.value = draft;
          search.dispatchEvent(new Event("input", { bubbles: true }));
          close();
        } else {
          draft = label === "Delete" ? Array.from(draft).slice(0, -1).join("")
            : draft + (label === "Space" ? " " : label);
          preview.textContent = draft || " ";
        }
      });
      return button;
    });
    grid.append(...buttons);
    picker.replaceChildren(title, ...(typing ? [preview] : []), grid);
    picker.hidden = false;
    buttons[typing ? 10 : Math.max(0, genre.selectedIndex)]?.focus();
  }

  function move(step) {
    buttons[Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
  }

  return {
    open, close,
    get active() { return !picker.hidden; },
    handle(direction) {
      switch (direction) {
        case "back": close(); break;
        case "confirm": buttons[index]?.click(); break;
        case "left": move(-1); break;
        case "right": move(1); break;
        case "up": move(-columns); break;
        case "down": move(columns); break;
      }
    },
  };
}
