// One literal shared by the Next bundle and `node worker/run.ts`, rather than env vars in
// two dashboards that can drift. Imports nothing so both can load it.
export const CDN_BASE = process.env.R2_PUBLIC_BASE ?? "https://cdn.oysternews.xyz";
