import { exigirSesion } from '@/lib/auth/server';
import Navbar from '@/components/Navbar';
import SyncManager from '@/components/SyncManager';
import BloqueoAcceso from '@/components/BloqueoAcceso';

export default async function AppLayout({ children }) {
  const { supabase } = await exigirSesion();
  const { data: { session } } = await supabase.auth.getSession();

  let verificacion = { acceso: true };

  if (session) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verificar-suscripcion`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        }
      );
      verificacion = await res.json();
    } catch {
      // Si la verificación falla técnicamente (red, timeout), no bloqueamos
      // al usuario por un problema nuestro — solo se bloquea por vencimiento real.
    }
  }

  if (!verificacion.acceso) {
    return <BloqueoAcceso info={verificacion} />;
  }

  return (
    <>
      <Navbar />
      <SyncManager />
      {children}
    </>
  );
}