'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [correo, setCorreo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const supabase = createClient();

  async function manejarEnvio(e) {
    e.preventDefault();
    setCargando(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: correo,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setCargando(false);
    if (error) {
      setError('No se pudo enviar el enlace. Intenta de nuevo.');
      return;
    }
    setEnviado(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm bg-navy-800 border border-navy-700 rounded-xl p-8">
        {enviado ? (
          <>
            <h1 className="text-offwhite text-2xl font-semibold mb-2">Revisa tu correo</h1>
            <p className="text-navy-400 text-sm">
              Te enviamos un enlace de acceso a <strong className="text-offwhite">{correo}</strong>.
              Ábrelo desde este mismo dispositivo para iniciar sesión.
            </p>
          </>
        ) : (
          <form onSubmit={manejarEnvio}>
            <h1 className="text-offwhite text-2xl font-semibold mb-2">Ábaco</h1>
            <p className="text-navy-400 text-sm mb-5">Ingresa tu correo para entrar o crear tu cuenta.</p>
            <input
              type="email"
              required
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full px-3 py-2.5 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold"
            />
            {error && <p className="text-danger text-xs mb-3">{error}</p>}
            <button
              type="submit"
              disabled={cargando}
              className="w-full py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60"
            >
              {cargando ? 'Enviando...' : 'Enviar enlace de acceso'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}