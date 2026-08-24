import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
