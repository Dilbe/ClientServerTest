// Vite settings. Vite serves the client during development and bundles it
// into static files for production (see README.md).

import { defineConfig, type Plugin } from "vite";

// Every production build gets a new version. The client has it compiled in,
// and the server reads it from version.json next to the files it serves; when
// they differ, the client is outdated and reloads itself.
const version = process.env.APP_VERSION ?? new Date().toISOString();

function writeVersionFile(): Plugin {
  return {
    name: "write-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version }),
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: "client",
  define: {
    // Replaced by the literal text at build time, like a C# preprocessor symbol.
    __APP_VERSION__: JSON.stringify(command === "build" ? version : "dev"),
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  plugins: [writeVersionFile()],
}));
