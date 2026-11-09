import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    copyPublicDir: false,
    rollupOptions: { input: { main: resolve("index.html"), gameChooser: resolve("light-study/index.html") } },
  },
  plugins: [
    {
      name: "copy-small-public-assets",
      async closeBundle() {
        const output = resolve("dist");
        await mkdir(output, { recursive: true });
        for (const directory of ["assets/models", "models", "games/models"]) {
          await cp(resolve("public", directory), resolve(output, directory), {
            recursive: true,
          });
        }
      },
    },
  ],
});
