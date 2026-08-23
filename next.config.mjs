/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // The §2.2 boundary polygons — the only PMTiles archive still served
        // from this app. The story archive moved to Vercel Blob in Phase 3,
        // then to Cloudflare R2 (verified there: 206, Accept-Ranges, CORS *),
        // and the rule that used to name /stories.pmtiles outlived the file
        // by two phases.
        //
        // PMTiles is read with HTTP range requests, so Accept-Ranges is not
        // decoration: without it a client may fetch the whole 9 MB archive to
        // read one tile.
        //
        // A year of immutability is safe in a way it would never be for stories:
        // this file changes only when Natural Earth does, and when it does the
        // rebuild is a deploy, which is a new URL path only if renamed — so the
        // one maintenance rule is to rename it on a rebuild, or accept that
        // returning visitors keep the old boundaries until the cache expires.
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
