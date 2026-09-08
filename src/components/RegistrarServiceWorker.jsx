'use client';

import { useEffect } from 'react';

export default function RegistrarServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('✔ Service Worker registrado:', reg.scope))
        .catch((error) => console.error('Error registrando Service Worker:', error));
    }
  }, []);

  return null;
}