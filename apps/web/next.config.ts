import type { NextConfig } from "next";
import "./lib/config.ts";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
