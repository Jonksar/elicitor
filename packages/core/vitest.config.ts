import { defaultServerConditions } from "vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  resolve: { conditions: ["source", ...defaultServerConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

export default config;
