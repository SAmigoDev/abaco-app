'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { destinoSeguro, destinoAutenticado } from '@/lib/auth/rutas.mjs';
import { navegarTrasAutenticacion } from '@/lib/auth/navegacion';

export default function MfaPanel({ estadoInicial, siguiente = '/', gestion = false }) {
  const [estado, setEstado] = useState(estadoInicial);
  const [factores, setFactores] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [factorId, setFactorId] = useState('');
  const [alta, setAlta] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [retirar, setRetirar] = useState(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let activo = true;
    createClient().auth.mfa.listFactors().then(({ data, error }) => {
      if (!activo) return;
      if (error) { setError('No se pudieron cargar los factores. Intenta nuevamente.'); return; }
      const lista = data.totp.filter(f => f.status === 'verified');
      setPendientes(data.totp.filter(f => f.status !== 'verified'));
      setFactores(lista); setFactorId(lista[0]?.id || '');
    }).catch(() => { if (activo) setError('No se pudieron cargar los factores.'); });
    return () => { activo = false; };
  }, []);

  async function enrolar() {
    setOcupado(true); setError(''); setMensaje(''); setCodigo('');
    try {
      const supabase = createClient();
      const { data: seguridad, error: seguridadError } = await supabase.rpc('estado_seguridad');
      if (seguridadError || (seguridad.requiere_mfa && seguridad.tiene_factor && !seguridad.permitido)) throw new Error('Verifica tu factor actual antes de añadir otro.');
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Ábaco ${new Date().toISOString()}`, issuer: 'Ábaco' });
      if (error) throw new Error('No se pudo crear el factor. Revisa factores pendientes o inténtalo más tarde.');
      setAlta(data);
    } catch (err) { setError(err.message || 'No se pudo iniciar el enrolamiento.'); }
    finally { setOcupado(false); }
  }

  async function verificar(e) {
    e.preventDefault(); setOcupado(true); setError(''); setMensaje('');
    try {
      const supabase = createClient();
      const id = alta?.id || factorId;
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: codigo.trim() });
      if (error) throw new Error('Código inválido o vencido. Comprueba la hora del autenticador y prueba un código nuevo.');
      if (retirar) {
        // Prove possession of a different retained factor before removing one.
        if (id === retirar.id || factores.length < 2) throw new Error('Añade y confirma otro autenticador antes de retirar este.');
        const { error } = await supabase.auth.mfa.unenroll({ factorId: retirar.id });
        if (error) throw new Error('No se pudo retirar el factor.');
      }
      setAlta(null); setCodigo(''); setRetirar(null);
      const { data, error: seguridadError } = await supabase.rpc('estado_seguridad');
      if (seguridadError || !data?.permitido) throw new Error('No se pudo validar la sesión. Vuelve a iniciar sesión.');
      setEstado(data);
      if (!gestion) { navegarTrasAutenticacion(destinoAutenticado(data, siguiente)); return; }
      const lista = await supabase.auth.mfa.listFactors();
      if (lista.error) throw new Error('No se pudieron recargar los factores.');
      const verificados = lista.data.totp.filter(f => f.status === 'verified');
      setPendientes(lista.data.totp.filter(f => f.status !== 'verified'));
      setFactores(verificados); setFactorId(verificados[0]?.id || '');
      setMensaje('La seguridad de tu cuenta se actualizó correctamente.');
    } catch (err) { setError(err.message || 'No se pudo verificar el código.'); }
    finally { setOcupado(false); }
  }

  async function cancelarAlta() {
    setOcupado(true); setError('');
    try {
      const { error } = await createClient().auth.mfa.unenroll({ factorId: alta.id });
      if (error) throw error;
      setAlta(null); setCodigo('');
    } catch { setError('No se pudo cancelar el factor pendiente.'); }
    finally { setOcupado(false); }
  }

  async function limpiarPendiente(id) {
    setOcupado(true); setError('');
    try {
      const { error } = await createClient().auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      setPendientes(prev => prev.filter(f => f.id !== id));
    } catch { setError('No se pudo retirar el enrolamiento pendiente.'); }
    finally { setOcupado(false); }
  }

  const requiereDesafio = estado?.requiere_mfa && !estado?.permitido && estado?.tiene_factor;
  return <div className="space-y-4">
    {estado?.administrador && <p className="text-gold text-sm">Tu cuenta administrativa requiere MFA. Hasta completar la verificación no tendrás acceso a datos ni operaciones administrativas.</p>}
    {estado?.requiere_mfa && !estado?.tiene_factor && <p className="text-gold text-sm">Configura y confirma un autenticador para desbloquear tu cuenta. Recuperar la contraseña no desactiva MFA.</p>}
    {!estado?.requiere_mfa && <p className="text-navy-400 text-sm">Activa un autenticador para proteger cada nuevo acceso. Una vez confirmado, el correo o la contraseña por sí solos no desbloquearán tus datos.</p>}
    {alta && <div className="space-y-4">
      <p className="text-sm">Escanea el QR con tu autenticador y confirma su primer código.</p>
      {/* Supabase returns an SVG data URI. Never put its secret in logs/storage. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={alta.totp.qr_code} alt="QR privado para configurar tu autenticador" width={220} height={220} className="bg-white p-3 rounded-lg" />
      <details className="text-sm"><summary>Introducir clave manualmente</summary><code className="block break-all select-all mt-2">{alta.totp.secret}</code></details>
    </div>}
    {(alta || requiereDesafio || retirar) && <form onSubmit={verificar} className="space-y-3">
      {!alta && <label className="block text-sm">Autenticador{retirar ? ' que conservarás' : ''}<select className="field mt-2" value={factorId} onChange={e => setFactorId(e.target.value)}>{factores.filter(f => f.id !== retirar?.id).map(f => <option value={f.id} key={f.id}>{f.friendly_name || 'Autenticador'}</option>)}</select></label>}
      <label className="block text-sm" htmlFor="mfa-codigo">Código de 6 dígitos</label>
      <input id="mfa-codigo" className="field font-mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} />
      <button className="primary-button w-full" disabled={ocupado || (!alta && !factorId)}>{ocupado ? 'Verificando…' : retirar ? 'Verificar y retirar factor' : 'Confirmar código'}</button>
      {alta && <button type="button" className="text-sm underline" disabled={ocupado} onClick={cancelarAlta}>Cancelar enrolamiento</button>}
      {retirar && <button type="button" className="text-sm underline" onClick={() => setRetirar(null)}>Conservar factor</button>}
    </form>}
    {!alta && !retirar && !requiereDesafio && <button className="primary-button" disabled={ocupado} onClick={enrolar}>{factores.length ? 'Añadir otro autenticador' : 'Configurar autenticador'}</button>}
    {gestion && <ul className="divide-y divide-navy-700">{factores.map(f => <li className="py-3 text-sm" key={f.id}><p>{f.friendly_name || 'Autenticador'} · confirmado</p><button className="text-danger mt-1" disabled={ocupado || factores.length < 2} onClick={() => { setRetirar(f); setFactorId(factores.find(x => x.id !== f.id)?.id || ''); setCodigo(''); }}>Retirar este factor</button></li>)}</ul>}
    {pendientes.length > 0 && <ul className="text-sm">{pendientes.map(f => <li key={f.id} className="py-2"><span>{f.friendly_name || 'Autenticador'} · sin confirmar</span><button className="block text-gold underline" disabled={ocupado} onClick={() => limpiarPendiente(f.id)}>Cancelar este enrolamiento pendiente</button></li>)}</ul>}
    {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    {mensaje && <p role="status" className="text-success text-sm">{mensaje}</p>}
    <p className="text-navy-400 text-xs">Para reemplazar un autenticador, añade y confirma otro antes de retirar el anterior. No ofrecemos códigos de recuperación. Si pierdes todos tus autenticadores, la cuenta permanecerá bloqueada hasta una revisión de identidad por el responsable del servicio; un correo de recuperación no basta.</p>
    {!gestion && <button className="text-sm text-navy-400 underline" onClick={async () => { const { error } = await createClient().auth.signOut({ scope: 'local' }); if (error) setError('No se pudo cerrar la sesión.'); else navegarTrasAutenticacion('/login'); }}>Cerrar esta sesión</button>}
    {!gestion && estado?.permitido && <a className="primary-button block" href={destinoSeguro(siguiente)}>Continuar</a>}
  </div>;
}
