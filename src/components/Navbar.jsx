'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const ENLACES = [
  { href: '/', label: 'Dashboard' },
  { href: '/registrar', label: 'Registrar' },
  { href: '/configuracion', label: 'Configuración' },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function cerrarSesion() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="border-b border-navy-700 bg-navy-800">
      <div className="max-w-5xl mx-auto px-4 md:px-8 flex items-center justify-between h-14">
        <span className="text-offwhite font-semibold">Ábaco</span>
        <div className="flex gap-1">
          {ENLACES.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                pathname === e.href ? 'bg-navy-700 text-offwhite' : 'text-navy-400 hover:text-offwhite'
              }`}
            >
              {e.label}
            </Link>
          ))}
        </div>
        <button onClick={cerrarSesion} className="text-navy-400 hover:text-danger text-sm">
          Cerrar sesión
        </button>
      </div>
    </nav>
  );
}