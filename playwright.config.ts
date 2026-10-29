import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: { baseURL: process.env.TEST_BASE_URL || "http://localhost:4321", headless: true },
  reporter: "list",
});
