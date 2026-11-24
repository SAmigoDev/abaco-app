/** @type {import('next').NextConfig} */
const verificacionLocal = process.env.ABACO_LOCAL_BUILD_CHECK === 'synthetic-only';
const nextConfig = {
  ...(verificacionLocal ? {
    cleanDistDir: false,
    experimental: { cpus: 1, workerThreads: false, webpackBuildWorker: false },
  } : {}),

  /* config options here */
};

export default nextConfig;
