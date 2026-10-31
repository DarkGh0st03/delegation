import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  reporter: [["line"], ["./failure-reporter.ts"]],
  use: {
    baseURL: "http://127.0.0.1:5173"
  }
});
