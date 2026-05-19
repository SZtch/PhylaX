import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["expediential-derangeable-cordie.ngrok-free.dev"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "expediential-derangeable-cordie.ngrok-free.dev"],
    },
  },
};

export default nextConfig;