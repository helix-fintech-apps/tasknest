import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const domain = fileURLToPath(new URL("./supabase/functions/_shared/domain", import.meta.url));

export default defineConfig({
  // The UI imports the money domain as `@domain` (same aliases as vite.config.ts).
  resolve: {
    alias: [
      { find: /^@domain$/, replacement: `${domain}/index.ts` },
      { find: /^@domain\/(.*)$/, replacement: `${domain}/$1` },
    ],
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    // `npm run test:coverage` (and CI's unit job) measure the money domain, not the whole repo.
    coverage: { provider: "v8", include: ["supabase/functions/_shared/domain/**"] },
  },
});
