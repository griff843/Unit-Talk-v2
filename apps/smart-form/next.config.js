/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: false,
  poweredByHeader: false,

  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  experimental: {
    instrumentationHook: false,
  },

  // Windows-specific: disable webpack cache to prevent EINVAL errors
  webpack: (config, { dev, isServer }) => {
    if (!dev && process.platform === 'win32') {
      config.cache = false;
    }
    // Fix: pnpm on Windows causes Next.js to compile action-queue.js (which
    // creates ActionQueueContext) into BOTH main-app.js and app-pages-internals.js
    // as separate module instances. Force a shared chunk so both entries use the
    // same module instance and ActionQueueContext is only created once.
    if (dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          nextRouterShared: {
            test: /[\\/]next[\\/]dist[\\/]shared[\\/]lib[\\/]router[\\/]/,
            name: 'next-router-shared',
            chunks: 'all',
            priority: 100,
            enforce: true,
            reuseExistingChunk: true,
          },
        },
      };
    }
    return config;
  },
};

module.exports = nextConfig;
