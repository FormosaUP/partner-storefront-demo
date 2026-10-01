/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/partner-storefront-demo',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
