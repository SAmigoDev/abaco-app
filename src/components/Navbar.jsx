'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { navegarTrasAutenticacion } from '@/lib/auth/navegacion';
import { createClient } from '@/lib/supabase/client';

const ENLACES = [
  { href: '/', label: 'Resumen' },
  { href: '/registrar', label: 'Registrar' },
  { href: '/configuracion', label: 'Configuración' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [error, setError] = useState('');
  const supabase = createClient();

  async function cerrarSesion() {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) { setError('No se pudo cerrar la sesión. Intenta nuevamente.'); return; }
    navegarTrasAutenticacion('/login');
  }

  return (
    <nav className="abaco-nav" aria-label="Navegación principal">
      <div className="abaco-nav-inner">
        <Link href="/" className="abaco-brand">á<span>·</span>baco</Link>
        <div className="nav-links">
          {ENLACES.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              prefetch={false}
              aria-current={pathname === e.href ? 'page' : undefined}
              className="nav-link"
            >
              {e.label}
            </Link>
          ))}
        </div>
        <button onClick={cerrarSesion} className="nav-logout">
          Cerrar sesión
        </button>
        {error && <p role="alert" className="text-danger text-xs">{error}</p>}
      </div>
    </nav>
  );
}
