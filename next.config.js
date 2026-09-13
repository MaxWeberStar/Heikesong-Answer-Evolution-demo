/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 是原生模块，标记为 server 外部依赖，避免打包报错
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

module.exports = nextConfig;
