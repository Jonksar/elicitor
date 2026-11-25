import { playwright } from "@vitest/browser-playwright";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    projects: [
      {
        resolve: { conditions: ["source", ...defaultServerConditions] },
        ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts", "src/**/*.browser.test.tsx"],
        },
      },
      {
        resolve: { conditions: ["source", ...defaultClientConditions] },
        // Pre-bundled up front so Vite does not re-optimise (and reload React) mid-run.
        optimizeDeps: {
          include: [
            "react",
            "react/jsx-dev-runtime",
            "react-dom",
            "react-dom/client",
            "vitest-browser-react",
            "@elicitor/capture > modern-screenshot",
          ],
        },
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts", "src/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});

export default config;
