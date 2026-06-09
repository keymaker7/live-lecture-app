import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/present.html",
        has: [{ type: "query", key: "room" }],
        destination: "/presenter?room=:room",
        permanent: false,
      },
      {
        source: "/join.html",
        has: [{ type: "query", key: "room" }],
        destination: "/join/:room",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
