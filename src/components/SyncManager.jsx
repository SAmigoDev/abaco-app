'use client';

import { useEffect } from 'react';
import { procesarColaOffline, registrarListenerReconexion } from '@/lib/indexedDb';
import { enviarTransaccion } from '@/lib/transacciones';

export default function SyncManager() {
  useEffect(() => {
    procesarColaOffline(enviarTransaccion);
    registrarListenerReconexion(enviarTransaccion);
  }, []);
  return null;
}