import type { NextConfig } from "next";

const apiOrigin = (process.env.ECONOTES_API_ORIGIN || "http://127.0.0.1:8000").replace(/\/$/, "");
const staticExport = process.env.NEXT_OUTPUT_MODE === "export";
const staticAssetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: staticExport ? "export" : "standalone",
  ...(staticAssetPrefix ? { assetPrefix: staticAssetPrefix } : {}),
  ...(staticExport ? { trailingSlash: true } : {}),
  turbopack: { root: process.cwd() },
  ...(!staticExport ? {
    async rewrites() {
      return [{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }];
    },
  } : {}),
};
export default nextConfig;
