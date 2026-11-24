'use client';

import { cuentasActivas } from '@/lib/saldos.mjs';
import { useEffect, useState } from 'react';
import VinculosAtajosPanel from './VinculosAtajosPanel';
import { createClient } from '@/lib/supabase/client';

export default function AtajosPanel({ tarjetas }) {
  const [integraciones, setIntegraciones] = useState([]);
  const activas = cuentasActivas(tarjetas);
  const [seleccion, setTarjeta] = useState(activas[0]?.id || '');
  const tarjeta = activas.some(t => t.id === seleccion) ? seleccion : '';
  const [secreto, setSecreto] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/registrar-gasto-atajo`;

  useEffect(() => {
    let activo = true;
    createClient().from('integraciones_atajos').select('id,tarjeta_id,created_at,revocado_at,vinculo_id').is('vinculo_id', null)
      .order('created_at', { ascending: false }).then(({ data, error }) => {
        if (!activo) return;
        if (error) setError('Atajos aún no está disponible. Comprueba que se aplicaron las migraciones.');
        else setIntegraciones(data || []);
      });
    return () => { activo = false; };
  }, []);

  async function crear() {
    setOcupado(true); setError(''); setSecreto('');
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = `abaco_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const { data, error } = await createClient().rpc('crear_integracion_atajo', { p_tarjeta: tarjeta, p_hash: hash });
      if (error) throw error;
      setIntegraciones(prev => [{ id: data, tarjeta_id: tarjeta, created_at: new Date().toISOString(), revocado_at: null }, ...prev]);
      setSecreto(token);
    } catch { setError('No se pudo crear la credencial. Revisa la conexión y las migraciones.'); }
    finally { setOcupado(false); }
  }

  async function revocar(id) {
    setOcupado(true); setError('');
    try {
      const { error } = await createClient().rpc('revocar_integracion_atajo', { p_id: id });
      if (error) throw error;
      setIntegraciones(prev => prev.map(i => i.id === id ? { ...i, revocado_at: new Date().toISOString() } : i));
      setSecreto('');
    } catch { setError('No se pudo revocar. Intenta nuevamente.'); }
    finally { setOcupado(false); }
  }

  return <section className="surface mb-10" aria-labelledby="atajos-titulo">
    <div className="eyebrow">Captura rápida</div>
    <h2 id="atajos-titulo" className="text-xl font-semibold mt-2">Ábaco en tus Atajos</h2>
    <p className="text-navy-400 text-sm mt-2 mb-5">Registra desde el Centro de control o una automatización de Wallet. Cada credencial permite registrar gastos en una sola cuenta.</p>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="flex-1 min-w-48 text-sm">Cuenta para este atajo
        <select className="field mt-2" value={tarjeta} onChange={e => setTarjeta(e.target.value)}>
          <option value="">Selecciona una cuenta activa</option>{activas.map(t => <option key={t.id} value={t.id}>{t.alias} · {t.moneda}</option>)}
        </select>
      </label>
      <button className="primary-button" disabled={!tarjeta || ocupado} onClick={crear}>Crear credencial</button>
    </div>
    {error && <p role="alert" className="text-danger text-sm mt-3">{error}</p>}
    {secreto && <div className="mt-4 p-4 border border-gold rounded-xl">
      <p className="text-sm mb-2">Copia esta credencial ahora. Solo se muestra durante esta sesión; guárdala dentro de tu atajo.</p>
      <code className="block break-all text-gold text-xs select-all">{secreto}</code>
      <button className="text-sm mt-3 underline" onClick={() => setSecreto('')}>Ya la guardé · ocultar</button>
    </div>}
    <details className="mt-5 text-sm">
      <summary className="cursor-pointer text-gold">Cómo conectar el atajo manual</summary>
      <ol className="list-decimal pl-5 space-y-2 mt-3 text-navy-400">
        <li>Solicita monto y comercio. Genera un UUID y conserva estos datos antes del envío para poder reintentar.</li>
        <li>Usa «Obtener contenido de URL», método POST, con esta URL: <code className="block break-all select-all mt-1">{endpoint}</code></li>
        <li>Cabeceras: <code>Authorization: Bearer TU_CREDENCIAL</code> y <code>Content-Type: application/json</code>.</li>
        <li>Envía un diccionario JSON con <code>evento_id</code>, <code>monto</code> (número), <code>moneda</code> (CLP o USD), <code>comercio</code>, <code>fecha</code> (ISO 8601 con zona horaria) y <code>origen: atajo_manual</code>.</li>
        <li>Comprueba la respuesta antes de borrar el evento guardado. Si falla la red, reintenta con el mismo UUID y los mismos datos.</li>
      </ol>
      <p className="text-navy-400 mt-3">Wallet: usa <code>apple_wallet</code> como origen. La disponibilidad de los datos depende del iPhone, iOS y tarjeta; compruébala con una compra real. La cola web no reintenta por el iPhone.</p>
    </details>
    <ul className="mt-5 divide-y divide-navy-700">
      {integraciones.map(i => <li key={i.id} className="py-3 flex justify-between gap-3 text-sm">
        <span>{tarjetas.find(t => t.id === i.tarjeta_id)?.alias || 'Cuenta eliminada'}<span className="block text-xs text-navy-400">{i.revocado_at ? 'Revocada' : 'Activa'} · {new Date(i.created_at).toLocaleDateString('es-CL')}</span></span>
        {!i.revocado_at && <button className="text-danger" disabled={ocupado} onClick={() => revocar(i.id)}>Revocar</button>}
      </li>)}
    </ul>
    <VinculosAtajosPanel tarjetas={tarjetas} />
  </section>;
}
