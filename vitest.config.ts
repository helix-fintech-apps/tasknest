import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    // `npm run test:coverage` (and CI's unit job) measure the money domain, not the whole repo.
    coverage: { provider: "v8", include: ["supabase/functions/_shared/domain/**"] },
  },
});
