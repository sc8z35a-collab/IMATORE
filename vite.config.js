import { defineConfig } from 'vite';

// Relative base so the build works both at a domain root (Cloudflare / preview)
// and under a sub-path such as GitHub Pages (https://<user>.github.io/IMATORE/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
