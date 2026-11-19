/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-postgres is a server-only dependency
  serverExternalPackages: ['pg']
};

export default nextConfig;
