import { defaultClientConditions, defineConfig, type UserConfig } from "vite";

// "source" resolves the workspace packages to their TypeScript sources, so `pnpm dev` works
// without building them first.
const config: UserConfig = defineConfig({
  resolve: { conditions: ["source", ...defaultClientConditions] },
});

export default config;
