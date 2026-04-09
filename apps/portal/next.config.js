/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  output: "standalone",
  basePath,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "https://api.grupo-loros.com"}/:path*`,
        basePath: false,
      },
    ];
  },
};

module.exports = nextConfig;
