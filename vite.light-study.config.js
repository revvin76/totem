import { defineConfig } from "vite";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist-light-study",
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: { input: {platformChooser:resolve('index.html'),studio:resolve('light-study/index.html')} },
  },
  plugins: [{
    name: "copy-disc-examples",
    async closeBundle() {
      for (const directory of ["assets/models", "models", "games/models"]) {
        const destination=resolve('dist-light-study',directory);
        await mkdir(destination,{recursive:true});
        await cp(resolve('public',directory),destination,{recursive:true});
      }
    },
  }],
});
