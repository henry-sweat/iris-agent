import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns a bundled native CLI; it must load from node_modules, not the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
