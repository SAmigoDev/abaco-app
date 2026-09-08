export default function manifest() {
  return {
    name: 'Ábaco - Gestión Financiera',
    short_name: 'Ábaco',
    description: 'Sistema de gestión financiera personal, inteligente y seguro',
    start_url: '/',
    display: 'standalone',
    background_color: '#0F172A',
    theme_color: '#10B981',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
}