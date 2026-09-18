import { defineConfig } from "vitest/config";
import path from "node:path";
import { loadEnv } from "vite";

// O Next carrega .env.local sozinho; o Vitest nao. Sem isso os testes de
// OCR procuram "tesseract" no PATH em vez do caminho configurado.
const env = { ...loadEnv(mode(), process.cwd(), "") };
function mode(): string {
  return process.env.NODE_ENV === "production" ? "production" : "test";
}
Object.assign(process.env, env);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
