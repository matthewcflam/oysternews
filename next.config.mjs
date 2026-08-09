/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // PMTiles is read with HTTP range requests. Phase 3 moves the archive to
        // Vercel Blob (verified: 206, Accept-Ranges, CORS *); in Phase 2 it is a
        // static file, and content-hashed immutability comes with publish.ts.
        source: "/stories.pmtiles",
        headers: [
          { key: "Accept-Ranges", value: "bytes" },
          { key: "Cache-Control", value: "public, max-age=60" },
        ],
      },
    ];
  },
};

export default nextConfig;
