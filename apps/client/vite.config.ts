/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: "0.0.0.0" },
  build: { target: "es2022" },
  // Many client tests build whole towns and raycast skinned figures: seconds of work each on a shared CI runner, where
  // the 5 s default left several of them timing out now and then.
  test: { testTimeout: 30_000 },
});
