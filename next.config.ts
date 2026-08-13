import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Snapshots are read from the filesystem at request time; nothing exotic needed.
  outputFileTracingIncludes: {
    "/**": ["./data/reports/**/*"],
  },
  // Belt and braces alongside the meta robots tag: keep every response,
  // including assets and share pages, out of search engines.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
