import "./rom-folders-editor.css";

export function createRomFoldersEditor(onChange) {
  const element = document.createElement("fieldset");
  element.className = "rom-folders-editor";
  const legend = document.createElement("legend");
  legend.textContent = "ROM folders";
  const help = document.createElement("small");
  help.textContent = "Scans include subfolders. Removing a folder from this list leaves its files on disk.";
  const rows = document.createElement("div");
  const empty = document.createElement("p");
  empty.textContent = "No folders configured for this platform.";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add folder";
  element.append(legend, help, rows, empty, add);

  function updateLabels() {
    const entries = [...rows.children];
    empty.hidden = entries.length > 0;
    entries.forEach((row, index) => {
      row.querySelector("input").setAttribute("aria-label", `ROM folder ${index + 1}`);
      row.querySelector("button").setAttribute("aria-label", `Remove ROM folder ${index + 1}`);
    });
  }

  function appendFolder(path) {
    const row = document.createElement("div");
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.value = path;
    input.placeholder = "Full folder path";
    input.oninput = onChange;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.onclick = () => {
      const next = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      updateLabels();
      (next?.querySelector("input") ?? add).focus();
      onChange();
    };
    row.append(input, remove);
    rows.append(row);
    return input;
  }

  add.onclick = () => {
    const input = appendFolder("");
    updateLabels();
    input.focus();
    onChange();
  };

  return {
    element,
    paths: () => [...rows.querySelectorAll("input")].map(input => input.value.trim()),
    reset(paths) {
      rows.replaceChildren();
      for (const path of paths) appendFolder(path);
      updateLabels();
    },
  };
}
