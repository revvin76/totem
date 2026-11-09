const letters = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", key => [`Key${key}`, key]);
const digits = Array.from("0123456789", key => [`Digit${key}`, key]);
const functionKeys = Array.from({ length: 12 }, (_, index) => {
  const key = `F${index + 1}`;
  return [key, key];
});
const numpad = Array.from("0123456789", key => [`Numpad${key}`, `Num ${key}`]);

export const keyboardInputs = new Map([
  ["Enter", "Enter"], ["Escape", "Esc"], ["Space", "Space"], ["Backspace", "Backspace"],
  ["ArrowUp", "↑"], ["ArrowDown", "↓"], ["ArrowLeft", "←"], ["ArrowRight", "→"],
  ["Home", "Home"], ["End", "End"], ["PageUp", "PgUp"], ["PageDown", "PgDn"],
  ["Insert", "Ins"], ["Delete", "Del"],
  ...letters, ...digits, ...functionKeys,
  ["Backquote", "`"], ["Minus", "−"], ["Equal", "="], ["BracketLeft", "["], ["BracketRight", "]"],
  ["Backslash", "\\"], ["Semicolon", ";"], ["Quote", "'"], ["Comma", ","], ["Period", "."], ["Slash", "/"],
  ...numpad, ["NumpadEnter", "Num ↵"], ["NumpadAdd", "Num +"], ["NumpadSubtract", "Num −"],
  ["NumpadMultiply", "Num ×"], ["NumpadDivide", "Num ÷"], ["NumpadDecimal", "Num ."],
]);

const keycaps = new Map();
export function keyboardGlyph(code) {
  const key = keyboardInputs.get(code);
  if (!key) return undefined;
  if (!keycaps.has(code)) {
    const label = key.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    const size = key.length > 6 ? 9 : key.length > 4 ? 11 : 14;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36">
      <rect x="2" y="3" width="44" height="30" rx="6" fill="#261941" stroke="#b9a0e5" stroke-width="2"/>
      <path d="M8 29h32" stroke="#8064b4"/>
      <text x="24" y="21" fill="#fff" text-anchor="middle" dominant-baseline="middle"
        font-family="Segoe UI, sans-serif" font-size="${size}" font-weight="600">${label}</text>
    </svg>`;
    keycaps.set(code, "data:image/svg+xml," + encodeURIComponent(svg));
  }
  return keycaps.get(code);
}
