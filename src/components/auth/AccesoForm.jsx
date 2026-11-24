'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { destinoAutenticado } from '@/lib/auth/rutas.mjs';
import { navegarTrasAutenticacion } from '@/lib/auth/navegacion';

export default function AccesoForm({ siguiente = '/', mensajeInicial = '' }) {
  const [modo, setModo] = useState('login');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [mensaje, setMensaje] = useState(mensajeInicial);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function cambiar(valor) { setModo(valor); setMensaje(''); setError(''); setClave(''); setConfirmar(''); }
  async function enviar(e) {
    e.preventDefault(); setOcupado(true); setError(''); setMensaje('');
    const supabase = createClient();
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', siguiente);
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave });
        if (error) throw new Error(error.code === 'email_not_confirmed' ? 'Confirma tu correo antes de entrar. Puedes reenviar la confirmación abajo.' : 'No pudimos iniciar sesión. Comprueba tu correo y contraseña.');
        const { data: estado, error: seguridadError } = await supabase.rpc('estado_seguridad');
        if (seguridadError) throw new Error('No pudimos verificar la seguridad de tu sesión. Intenta nuevamente.');
        navegarTrasAutenticacion(destinoAutenticado(estado, siguiente));
      } else if (modo === 'registro') {
        if (clave !== confirmar) throw new Error('Las contraseñas no coinciden.');
        const { data, error } = await supabase.auth.signUp({ email: correo.trim(), password: clave, options: { emailRedirectTo: callback.toString() } });
        if (error) throw new Error('No se pudo completar el registro. Revisa la contraseña e inténtalo más tarde.');
        // Confirmation is mandatory in production and independently enforced by DB.
        if (data.session) await supabase.auth.signOut({ scope: 'local' });
        setMensaje('Si el correo puede registrarse, recibirás un mensaje para confirmar tu cuenta. Revisa también spam.');
      } else if (modo === 'recuperar') {
        const recovery = new URL('/auth/callback', window.location.origin);
        recovery.searchParams.set('next', '/auth/actualizar-clave');
        const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), { redirectTo: recovery.toString() });
        if (error) throw new Error('No se pudo solicitar el correo. Espera un momento y vuelve a intentarlo.');
        setMensaje('Si existe una cuenta para ese correo, recibirás las instrucciones. Recuperar la contraseña conserva tu segundo factor.');
      } else if (modo === 'confirmacion') {
        const { error } = await supabase.auth.resend({ type: 'signup', email: correo.trim(), options: { emailRedirectTo: callback.toString() } });
        if (error) throw new Error('No se pudo solicitar el correo. Espera y vuelve a intentarlo.');
        setMensaje('Si corresponde, recibirás un nuevo correo de confirmación.');
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email: correo.trim(), options: { emailRedirectTo: callback.toString() } });
        if (error) throw new Error('No se pudo enviar el enlace de acceso. Intenta más tarde.');
        setMensaje('Si corresponde, recibirás un enlace de acceso. Ábrelo desde este dispositivo. Si usas MFA, también te pediremos tu código.');
      }
      setClave(''); setConfirmar('');
    } catch (err) { setError(err.message || 'No se pudo completar la solicitud.'); }
    finally { setOcupado(false); }
  }
  const titulos = { login: 'Entrar', registro: 'Crear cuenta', recuperar: 'Enviar recuperación', enlace: 'Enviar enlace de acceso', confirmacion: 'Reenviar confirmación' };
  const conClave = modo === 'login' || modo === 'registro';
  return <>
    <div className="flex gap-2 mb-5" aria-label="Método de acceso">
      <button type="button" className={modo === 'login' ? 'primary-button' : 'field'} onClick={() => cambiar('login')}>Entrar</button>
      <button type="button" className={modo === 'registro' ? 'primary-button' : 'field'} onClick={() => cambiar('registro')}>Crear cuenta</button>
    </div>
    <form onSubmit={enviar} className="space-y-4">
      <label className="block text-sm" htmlFor="auth-correo">Correo electrónico</label>
      <input id="auth-correo" className="field" type="email" autoComplete="email" required value={correo} onChange={e => setCorreo(e.target.value)} />
      {conClave && <><label className="block text-sm" htmlFor="auth-clave">Contraseña{modo === 'registro' ? ' · al menos 12 caracteres' : ''}</label><input id="auth-clave" className="field" type="password" autoComplete={modo === 'registro' ? 'new-password' : 'current-password'} minLength={modo === 'registro' ? 12 : undefined} required value={clave} onChange={e => setClave(e.target.value)} /></>}
      {modo === 'registro' && <><label className="block text-sm" htmlFor="auth-confirmar">Repite la contraseña</label><input id="auth-confirmar" className="field" type="password" autoComplete="new-password" minLength={12} required value={confirmar} onChange={e => setConfirmar(e.target.value)} /></>}
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {mensaje && <p role="status" className="text-success text-sm">{mensaje}</p>}
      <button className="primary-button w-full" disabled={ocupado}>{ocupado ? 'Un momento…' : titulos[modo]}</button>
    </form>
    <div className="mt-6 flex flex-col items-start gap-2 text-sm text-gold">
      <button onClick={() => cambiar('recuperar')}>Olvidé mi contraseña</button>
      <button onClick={() => cambiar('enlace')}>Entrar con enlace por correo</button>
      <button onClick={() => cambiar('confirmacion')}>Reenviar confirmación de correo</button>
    </div>
  </>;
}
