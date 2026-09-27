import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  outputDir: "../test/scratch/playwright",
  reporter: [
    ["list"],
    ["json", { outputFile: "../docs/validation/interactions.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4178/preview/",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node scripts/preview.mjs",
    url: "http://127.0.0.1:4178/preview/",
    reuseExistingServer: false,
  },
});
