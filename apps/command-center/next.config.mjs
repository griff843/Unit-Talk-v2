/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Build a candidate without replacing the assets of a running local preview.
  distDir: process.env.COMMAND_CENTER_DIST_DIR || '.next',
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
