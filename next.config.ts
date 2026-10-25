import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let an HTTPS tunnel serve the dev server to a phone (location/compass need HTTPS).
  allowedDevOrigins: ["*.trycloudflare.com"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
