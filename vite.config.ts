import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function offlinePrecache(): Plugin {
  return {
    name: "mortimer-offline-precache",
    apply: "build",
    closeBundle() {
      const outDir = resolve(process.cwd(), "dist");
      const swPath = resolve(outDir, "sw.js");
      const files = (directory: string): string[] =>
        readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
          const path = resolve(directory, entry.name);
          return entry.isDirectory() ? files(path) : [path];
        });
      const assets = files(outDir)
        .map((path) => relative(outDir, path).split(sep).join("/"))
        .filter((path) => path !== "sw.js" && path !== "index.html")
        .sort();
      const source = readFileSync(swPath, "utf8");
      const marker = "const BUILD_ASSETS = [];";
      if (!source.includes(marker)) throw new Error("Service worker precache marker is missing");
      writeFileSync(swPath, source.replace(marker, `const BUILD_ASSETS = ${JSON.stringify(assets)};`));
    },
  };
}

export default defineConfig({
  base: "/Mortimer-player/",
  plugins: [react(), offlinePrecache()],
  build: { manifest: true },
});