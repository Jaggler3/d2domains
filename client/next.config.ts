import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/account/domains",
        destination: "/account",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
