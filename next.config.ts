import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Accept-Ranges: bytes, or a client may fetch the whole archive to read one tile.
        source: "/boundaries.pmtiles",
        headers: [
          { key: "Accept-Ranges", value: "bytes" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
