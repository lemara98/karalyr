import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the server bundle from trying to compile the native libSQL client.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
