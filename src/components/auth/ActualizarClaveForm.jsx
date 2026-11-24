'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { navegarTrasAutenticacion } from '@/lib/auth/navegacion';

export default function ActualizarClaveForm() {
  const [clave, setClave] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [nonce, setNonce] = useState('');
  const [requiereNonce, setRequiereNonce] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function actualizar(e) {
    e.preventDefault(); setOcupado(true); setError(''); setMensaje('');
    try {
      if (clave !== confirmar) throw new Error('Las contraseñas no coinciden.');
      const supabase = createClient();
      const { data: estado, error: seguridadError } = await supabase.rpc('estado_seguridad');
      if (seguridadError || !estado?.permitido) throw new Error('Completa la verificación de correo y MFA antes de actualizar la contraseña.');
      const { error } = await supabase.auth.updateUser({ password: clave, ...(nonce ? { nonce: nonce.trim() } : {}) });
      if (error?.code === 'reauthentication_needed') {
        const reauth = await supabase.auth.reauthenticate();
        if (reauth.error) throw new Error('Vuelve a iniciar sesión para cambiar tu contraseña.');
        setRequiereNonce(true); setMensaje('Confirma el código enviado por Supabase a tu correo. Este código no reemplaza tu autenticador.'); return;
      }
      if (error) throw new Error('No se pudo cambiar la contraseña. Comprueba la política de seguridad o solicita otro enlace.');
      setClave(''); setConfirmar(''); setNonce('');
      // Revoke all sessions after a password change, then discard the browser's router cache.
      const salida = await supabase.auth.signOut({ scope: 'global' });
      if (salida.error) { setMensaje('Contraseña actualizada. Cierra esta sesión antes de continuar.'); return; }
      navegarTrasAutenticacion('/login');
    } catch (err) { setError(err.message || 'No se pudo cambiar la contraseña.'); }
    finally { setOcupado(false); }
  }
  return <form onSubmit={actualizar} className="space-y-4">
    <label htmlFor="nueva-clave" className="block text-sm">Nueva contraseña · al menos 12 caracteres</label>
    <input id="nueva-clave" className="field" required type="password" minLength={12} autoComplete="new-password" value={clave} onChange={e => setClave(e.target.value)} />
    <label htmlFor="repetir-clave" className="block text-sm">Repite la nueva contraseña</label>
    <input id="repetir-clave" className="field" required type="password" minLength={12} autoComplete="new-password" value={confirmar} onChange={e => setConfirmar(e.target.value)} />
    {requiereNonce && <label className="block text-sm">Código de confirmación por correo<input className="field mt-2" autoComplete="one-time-code" required value={nonce} onChange={e => setNonce(e.target.value)} /></label>}
    {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    {mensaje && <p role="status" className="text-success text-sm">{mensaje}</p>}
    <button className="primary-button w-full" disabled={ocupado}>{ocupado ? 'Actualizando…' : 'Guardar nueva contraseña'}</button>
    <a className="block text-sm text-gold underline" href="/configuracion">Volver a Configuración</a>
  </form>;
}
