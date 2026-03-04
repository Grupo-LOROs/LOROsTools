/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "https://api.grupo-loros.com"}/:path*`,
      },
    ];
  },
};
module.exports = nextConfig;
