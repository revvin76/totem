export function mountCenteredTitleRail(rail, { cards, active, select, loop = false, onCopy }) {
  let scrollTimer;
  let programmaticUntil = 0;
  let centeredCard;
  let copies = [];
  rail.classList.add("centered-title-rail");

  function updateCopies(titles, height, gap) {
    const edges = [];
    if (loop && titles.length) {
      for (const direction of [-1, 1]) {
        let covered = 0;
        for (let step = 0; covered < height; step++) {
          const source = titles[direction < 0 ? titles.length - 1 - step % titles.length : step % titles.length];
          edges.push({ source, direction });
          covered += (source.offsetHeight || 64) + gap;
        }
      }
    }
    if (edges.length === copies.length && edges.every(({ source, direction }, i) =>
      copies[i].source === source && copies[i].direction === direction && copies[i].card.parentElement === rail)) return;
    for (const { card } of copies) card.remove();
    copies = edges.map(({ source, direction }) => {
      const card = source.cloneNode(true);
      card.classList.remove("rail-active");
      card.removeAttribute("aria-current");
      card.dataset.uiStyle = "game-button-inactive";
      card.tabIndex = -1;
      card.setAttribute("aria-hidden", "true");
      card.addEventListener("click", () => select(source));
      if (direction < 0) rail.prepend(card);
      else rail.append(card);
      onCopy?.(card);
      return { source, direction, card };
    });
  }

  function center(card, behavior = "auto") {
    centeredCard = card;
    const height = rail.clientHeight;
    if (!height) return;
    if (!card || card.hidden || card.parentElement !== rail) {
      updateCopies([], height, 0);
      rail.style.removeProperty("--title-rail-spacers");
      rail.style.removeProperty("--title-rail-start");
      rail.style.removeProperty("--title-rail-end");
      rail.scrollTop = 0;
      return;
    }

    const titles = cards();
    if (!titles.length) return;
    const gap = parseFloat(getComputedStyle(rail).rowGap) || 0;
    updateCopies(titles, height, gap);
    if (!loop) {
      const edgeSpace = (title, margin) => Math.max(0, Math.ceil(
        (height - title.offsetHeight) / 2 - (parseFloat(getComputedStyle(title)[margin]) || 0) - gap,
      ));
      rail.style.setProperty("--title-rail-spacers", '""');
      rail.style.setProperty("--title-rail-start", `${edgeSpace(titles[0], "marginTop")}px`);
      rail.style.setProperty("--title-rail-end", `${edgeSpace(titles[titles.length - 1], "marginBottom")}px`);
    }

    const railBounds = rail.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const scaleY = railBounds.height / rail.offsetHeight || 1;
    const cardCenter = (cardBounds.top + cardBounds.height / 2 - railBounds.top) / scaleY;
    const offset = cardCenter - rail.clientTop - height / 2;
    if (Math.abs(offset) < 0.5) return;

    programmaticUntil = performance.now() + 500;
    rail.scrollTo({ top: rail.scrollTop + offset, behavior });
  }

  new ResizeObserver(() => center(centeredCard)).observe(rail);
  for (const eventName of ["pointerdown", "touchstart", "wheel"]) {
    rail.addEventListener(eventName, () => { programmaticUntil = 0; }, { passive: true });
  }
  rail.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!active() || performance.now() < programmaticUntil) return;
      const bounds = rail.getBoundingClientRect();
      const scaleY = bounds.height / rail.offsetHeight || 1;
      const midpoint = bounds.top + (rail.clientTop + rail.clientHeight / 2) * scaleY;
      let nearest;
      let distance = Infinity;
      for (const title of [...cards(), ...copies.map(copy => copy.card)]) {
        const rect = title.getBoundingClientRect();
        const nextDistance = Math.abs(rect.top + rect.height / 2 - midpoint);
        if (nextDistance < distance) {
          nearest = title;
          distance = nextDistance;
        }
      }
      if (nearest) select(copies.find(copy => copy.card === nearest)?.source ?? nearest);
    }, 120);
  }, { passive: true });

  return { center };
}
