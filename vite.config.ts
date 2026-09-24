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
  server: { port: 5173, strictPort: true },
});
