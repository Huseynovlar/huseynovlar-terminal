import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // MapLibre v6 must be bundled by Vite for TanStack Start SSR.
  ssr: { noExternal: ["maplibre-gl"] },
  plugins: [
    devtools({
      injectSource: {
        enabled: true,
        ignore: {
          components: ["FullCalendar"],
        },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
});

export default config;
