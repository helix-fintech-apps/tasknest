import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const domain = fileURLToPath(new URL("./supabase/functions/_shared/domain", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@domain$/, replacement: `${domain}/index.ts` },
      { find: /^@domain\/(.*)$/, replacement: `${domain}/$1` },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks cache well and keep every chunk far below the 250 kB gzip budget
        // (scripts/check-bundle-size.mjs enforces it after `vite build`).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id))
            return "vendor-react";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@stripe")) return "vendor-stripe";
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
