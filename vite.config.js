import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const {
    VITE_API_TARGET: legacyApiTarget,
    VITE_API_AUTH_TARGET: authTarget,
    VITE_API_SENSOR_TARGET: sensorTarget,
    VITE_API_JAVA_TARGET: javaTarget,
  } = loadEnv(mode, '.', 'VITE_');
  const authServiceTarget = authTarget || legacyApiTarget;
  const sensorServiceTarget = sensorTarget || legacyApiTarget;
  const proxy = {
    ...(javaTarget ? {
      '/api/environments': {
        target: javaTarget,
        changeOrigin: true,
      },
      '/api/devices': {
        target: javaTarget,
        changeOrigin: true,
      },
    } : {}),
    ...(authServiceTarget ? {
      '/api/auth': {
        target: authServiceTarget,
        changeOrigin: true,
        cookieDomainRewrite: '',
      },
    } : {}),
    ...(sensorServiceTarget ? {
      '/api/sensors': {
        target: sensorServiceTarget,
        changeOrigin: true,
      },
    } : {}),
  };

  return {
    plugins: [react(), tailwindcss()],
    ...(Object.keys(proxy).length > 0 ? {
      server: {
        proxy,
      },
    } : {}),
  };
});