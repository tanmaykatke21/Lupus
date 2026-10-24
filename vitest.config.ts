import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same "@/..." import alias as tsconfig.json, so tests can import app modules directly.
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
