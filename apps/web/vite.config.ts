// `defineConfig` de vitest y no de vite: es la que admite la clave `test`.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Configuracion del cliente web.
 *
 * El proxy de desarrollo apunta al gateway y no a cada servicio: el navegador
 * nunca debe conocer los puertos internos, y asi el codigo del cliente usa las
 * mismas rutas en desarrollo y en produccion.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      /**
       * `prompt` y no `autoUpdate` a proposito.
       *
       * Una actualizacion automatica puede recargar la pagina mientras alguien
       * esta escribiendo una necesidad o aceptando una contratacion. Se le
       * avisa y decide cuando.
       */
      manifest: {
        name: 'Punto Amigo',
        short_name: 'Punto Amigo',
        description: 'Encuentre quien le ayude, u ofrezca lo que sabe hacer.',
        lang: 'es-CO',
        start_url: '/',
        display: 'standalone',
        background_color: '#faf8f5',
        theme_color: '#1f6f5c',
        icons: [
          { src: '/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Aparte del "any": Android recorta con su propia mascara, que puede
          // comerse las esquinas. Reusar aqui el icono normal deja huecos
          // translucidos en la pantalla de inicio.
          {
            src: '/icono-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /**
         * NADA del API se guarda en cache.
         *
         * Es la decision mas importante de esta configuracion. Una respuesta
         * cacheada puede contener datos de contacto, una bandeja de
         * notificaciones o una propuesta ajena, y quedaria escrita en el disco
         * del dispositivo sobreviviendo al cierre de sesion. Se cachea el
         * caparazon de la aplicacion y nada mas.
         */
        navigateFallbackDenylist: [/^\/api\//u],
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_GATEWAY_URL'] ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    // El trozo del 3D supera el aviso por omision a proposito: esta aislado y
    // se carga solo donde `conviene3d` lo autoriza. El limite se sube para que
    // el aviso siga sirviendo de senal si crece el paquete PRINCIPAL.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * El 3D va en su propio trozo.
         *
         * three.js pesa mas que todo el resto de la aplicacion junta. Sacarlo
         * del paquete principal es lo que permite que la primera pantalla cargue
         * rapido en una conexion lenta, que es la situacion de buena parte de
         * quienes van a usar esto desde el movil.
         */
        manualChunks: (id) =>
          id.includes('three') || id.includes('@react-three') ? 'escenas-3d' : undefined,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/pruebas/configuracion.ts'],
  },
});
