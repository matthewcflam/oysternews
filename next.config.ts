import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // §2.2 boundary polygons — only PMTiles archive served from this app.
        // Accept-Ranges: bytes is required for HTTP range requests to avoid
        // fetching the full 9 MB archive for a single tile.
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
