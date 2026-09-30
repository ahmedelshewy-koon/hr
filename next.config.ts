import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // vinext rejects any multipart POST over this size with a bare 413 before it reaches the route.
    // Document categories allow 10 MB files, so leave room for the multipart envelope.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
