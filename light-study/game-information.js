export function mountGameInformation(button, dialog, selectedGame, inspect) {
  const status = dialog.querySelector("[role=status]");
  const details = dialog.querySelector("dl");
  let request = 0;

  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    details.replaceChildren();
    status.textContent = "";
  });
  button.addEventListener("click", async () => {
    const game = selectedGame();
    if (!game || dialog.open) return;
    const current = ++request;
    details.replaceChildren();
    status.textContent = "Loading game information…";
    dialog.showModal();
    try {
      const data = await inspect(game.id);
      if (!dialog.open || current !== request) return;
      const append = (label, value) => {
        const term = dialog.ownerDocument.createElement("dt");
        const description = dialog.ownerDocument.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        details.append(term, description);
      };
      const platform = data.platformName ?? data.platformId;
      append("Game", data.title);
      append("Indexed ID", data.id);
      append("Platform", data.platformName ? `${platform} (${data.platformId})` : platform);
      append("Original file", data.originalPath ?? "Unavailable");
      append("File status", {
        regularFile: "Regular file present", missing: "File missing", unavailable: "File unavailable",
        directory: "Path is a folder", link: "Path is a link or reparse point",
        other: "Path is not a regular file", unrecorded: "No file path recorded",
      }[data.fileStatus] ?? "Unknown");
      append("Source root", data.provenance?.root ?? "Not recorded in this index");
      const kinds = { conventional: "Conventional library folder", imported: "Imported collection", configured: "Configured collection path" };
      const rules = {
        collection: "collection extension list", platformCollections: "platform collection extension lists",
        override: "platform extension override", fallback: "default library extension list",
      };
      const extension = data.extension ? `.${data.extension}` : "No recorded extension";
      if (data.provenance?.admissions.length) {
        for (const source of data.provenance.admissions) {
          const collection = [source.collectionName, source.collectionId].filter(Boolean).join(" · ");
          append("Source", [kinds[source.kind], collection].filter(Boolean).join(" · "));
          append("Discovery", `Indexed under ${platform} because this source admitted ${extension} through its ${rules[source.rule]}.`);
        }
      } else {
        append("Discovery", `${extension}. The index does not record the admitting source or rule.`);
      }
      const { launch } = data;
      const selected = launch.matchingEmulators?.find(emulator => emulator.id === launch.selectedEmulatorId);
      append("Launch readiness", launch.status === "ready" ? `Ready to attempt launch with ${selected.name}.` : launch.reason);
      if (launch.status !== "ready" && selected) append("Matched runtime", selected.name);
      for (const emulator of launch.matchingEmulators ?? []) {
        append("Matching emulator", `${emulator.name} · ${emulator.executableAvailable ? "Executable present" : "Executable unavailable"}`);
      }
      if (launch.registryError) append("Emulator registry", launch.registryError);
      status.textContent = "";
    } catch (error) {
      if (dialog.open && current === request) {
        details.replaceChildren();
        status.textContent = `Could not load game information. ${error.message ?? error}`;
      }
    }
  });

  return {
    get open() { return dialog.open; },
    close() { if (dialog.open) dialog.close(); },
    setAvailable(available) { button.hidden = !available; },
  };
}
