import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
};

export default config;
