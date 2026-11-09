import { cpSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.env.CARGO_TARGET_DIR
  ? resolve(process.env.CARGO_TARGET_DIR)
  : join(root, "src-tauri", "target");
const profile = process.argv[2];
if (profile !== "debug" && profile !== "release") {
  throw new Error("Specify debug or release.");
}
const modelDirectory = join(target, profile, "assets", "models");
mkdirSync(modelDirectory, { recursive: true });
cpSync(join(root, "public", "assets", "models"), modelDirectory, {
  recursive: true,
  filter: source => !source.endsWith(".md"),
});
