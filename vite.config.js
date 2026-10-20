import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const { VITE_API_TARGET: apiTarget } = loadEnv(mode, '.', 'VITE_');

  return {
    plugins: [react(), tailwindcss()],
    ...(apiTarget ? {
      server: {
        proxy: {
          '/api': {
            target: apiTarget,
            changeOrigin: true,
          },
        },
      },
    } : {}),
  };
});