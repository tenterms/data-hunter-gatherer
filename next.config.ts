import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Snapshots are read from the filesystem at request time; nothing exotic needed.
  outputFileTracingIncludes: {
    "/**": ["./data/reports/**/*"],
  },
};

export default nextConfig;
