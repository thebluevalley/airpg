import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 确保这里没有 distDir: 'old-world/.next' 之类的奇怪设置
  // 确保没有 output: 'export' (除非你只要静态页面且不想要 API)
};

export default nextConfig;