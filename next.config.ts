import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Uploads em lote: o corpo das Server Actions nao e usado para video,
    // mas mantemos um limite explicito para o resto.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
