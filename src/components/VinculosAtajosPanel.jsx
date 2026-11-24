'use client';
import { cuentasActivas } from '@/lib/saldos.mjs';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
const fecha = value => new Date(value).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
const corto = id => `${id.slice(0, 8)}…${id.slice(-4)}`;
function Identificador({ id }) {
  const [mensaje, setMensaje] = useState('');
  return <span className="inline-flex flex-wrap items-center gap-2 text-xs"><code>{corto(id)}</code><button type="button" className="underline" title={`Copiar identificador completo: ${id}`} onClick={async () => { try { await navigator.clipboard.writeText(id); setMensaje('Copiado'); } catch { setMensaje(`Copia este ID: ${id}`); } }}>Copiar ID</button><span role="status" className="break-all">{mensaje}</span></span>;
}
function Nombre({ tipo, item, nombre, ocupado, renombrar }) {
  const [editar, setEditar] = useState(false);
  const [valor, setValor] = useState('');
  return <div className="flex flex-wrap items-center gap-3">{editar ? <form className="flex flex-wrap gap-2 w-full" onSubmit={async e => { e.preventDefault(); if (await renombrar(tipo, item.id, valor)) setEditar(false); }}><label className="flex-1 min-w-40">Alias<input aria-label={`Alias de ${nombre}`} className="field mt-1" maxLength={80} value={valor} onChange={e => setValor(e.target.value)} /></label><button disabled={ocupado || !valor.trim()} className="underline">Guardar alias</button><button type="button" disabled={ocupado} onClick={() => setEditar(false)}>Cancelar</button><p className="w-full text-xs text-navy-400">Solo cambia el nombre visible; identidad y destino se conservan.</p></form> : <><h4 className="font-semibold break-words">{nombre}</h4><button className="text-xs underline" disabled={ocupado} onClick={() => { setValor(nombre); setEditar(true); }}>Renombrar</button></>}</div>;
}
export default function VinculosAtajosPanel({ tarjetas }) {
  const activas = cuentasActivas(tarjetas);
  const [estado, setEstado] = useState({ instrumentos: [], vinculos: [], credenciales: [] });
  const [alias, setAlias] = useState('');
  const [cuentas, setCuentas] = useState({});
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(true);
  const [secreto, setSecreto] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);
  const bloqueo = useRef(false);
  const dialogo = useRef(null);
  useEffect(() => { if (confirmacion) dialogo.current?.showModal(); }, [confirmacion]);
  async function cargar() {
    const c = createClient();
    const rows = await Promise.all([
      c.from('instrumentos_pago').select('id,alias,tipo,created_at,archivado_at').order('created_at'),
      c.from('vinculos_captura').select('id,alias,instrumento_id,tarjeta_id,moneda_cuenta,created_at,revocado_at').order('created_at'),
      c.from('integraciones_atajos').select('id,alias,vinculo_id,created_at,revocado_at').not('vinculo_id', 'is', null).order('created_at'),
    ]);
    if (rows.some(r => r.error)) throw new Error('No se pudo actualizar el panel. Comprueba la conexión y tu sesión de seguridad.');
    return { instrumentos: rows[0].data, vinculos: rows[1].data, credenciales: rows[2].data };
  }
  useEffect(() => { let activo = true; cargar().then(data => { if (activo) setEstado(data); }).catch(e => { if (activo) setError(e.message); }).finally(() => { if (activo) setOcupado(false); }); return () => { activo = false; }; }, []);
  async function ejecutar(nombre, params, contexto) {
    if (bloqueo.current) return false;
    bloqueo.current = true; setOcupado(true); setError('');
    let completado = false;
    try {
      if (contexto) {
        const token = `abaco_${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')}`;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        params = { ...params, p_hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
        contexto = { ...contexto, token };
      }
      const { data, error } = await createClient().rpc(nombre, params);
      if (error) throw new Error('No se pudo completar la operación. Revisa conexión, permisos y MFA antes de reintentar.');
      completado = true;
      if (nombre.startsWith('revocar_') || nombre === 'archivar_instrumento_pago') setSecreto(null);
      if (contexto) setSecreto({ ...contexto, id: data });
      if (nombre === 'crear_instrumento_pago') setAlias('');
      setConfirmacion(null);
      setEstado(await cargar());
    } catch (e) { setError(completado ? 'Operación completada. No se pudo refrescar la lista; recarga antes de repetir.' : e.message); }
    finally { bloqueo.current = false; setOcupado(false); }
    return completado;
  }
  const renombrar = (tipo, id, nombre) => ejecutar('renombrar_captura', { p_tipo: tipo, p_id: id, p_alias: nombre });
  const destino = v => `${tarjetas.find(t => t.id === v.tarjeta_id)?.alias || 'Cuenta no disponible'} · ${v.moneda_cuenta}`;
  const nombreV = v => v.alias || `Captura en ${destino(v)}`;
  const nombreC = c => c.alias || `Credencial ${corto(c.id)}`;
  const pedir = (nombre, descripcion, rpc, params) => setConfirmacion({ nombre, descripcion, rpc, params });
  function meta(item, status) { return <div className="text-xs text-navy-400 space-y-1 mt-2"><p>{status} · Creado: {fecha(item.created_at)}</p><Identificador id={item.id} /></div>; }
  function credencial(c, i, v, historico) {
    return <article key={c.id} className="rounded-xl border border-navy-600 bg-navy-950 p-4 mt-3 text-sm">
      <Nombre tipo="credencial" item={c} nombre={nombreC(c)} ocupado={ocupado} renombrar={renombrar} />
      <p className="text-xs mt-2">{i.alias} → {destino(v)}</p>{meta(c, c.revocado_at ? `Revocada el ${fecha(c.revocado_at)}` : 'Activa')}
      {!historico && !c.revocado_at && <button disabled={ocupado} className="text-danger underline mt-3" onClick={() => pedir(nombreC(c), `Los atajos que usen esta credencial de «${i.alias}» para ${destino(v)} dejarán de registrar gastos, incluidos sus reintentos. Las otras credenciales seguirán funcionando. No se borran gastos.`, 'revocar_integracion_atajo', { p_id: c.id })}>Revocar credencial</button>}
    </article>;
  }
  function vinculo(v, i, historico = false) {
    const cred = estado.credenciales.filter(c => c.vinculo_id === v.id);
    const revocadas = cred.filter(c => c.revocado_at);
    return <section key={v.id} className="rounded-2xl border-2 border-navy-600 bg-navy-900 p-4 sm:p-5 mt-4">
      <Nombre tipo="vinculo" item={v} nombre={nombreV(v)} ocupado={ocupado} renombrar={renombrar} />
      <p className="text-sm mt-2">Cuenta de destino: <strong>{destino(v)}</strong></p>{meta(v, v.revocado_at ? `Revocado el ${fecha(v.revocado_at)}` : 'Activo')}
      {!historico && !v.revocado_at && <div className="flex flex-wrap gap-4 mt-4 text-sm">
        <button className="primary-button" disabled={ocupado || !!secreto} onClick={() => ejecutar('crear_credencial_vinculo', { p_vinculo: v.id }, { instrumento: i.alias, cuenta: destino(v), vinculo: v.id })}>Crear credencial para este vínculo</button>
        <button className="text-danger underline" disabled={ocupado} onClick={() => pedir(nombreV(v), `Se revocarán todas las credenciales de este vínculo de «${i.alias}» hacia ${destino(v)}. Sus atajos y reintentos dejarán de funcionar. Los gastos y el historial se conservan.`, 'revocar_vinculo_captura', { p_vinculo: v.id })}>Revocar vínculo</button>
      </div>}
      <h5 className="text-sm font-semibold mt-5">Credenciales {historico ? 'del vínculo' : 'activas'}</h5>
      {cred.filter(c => !c.revocado_at).map(c => credencial(c, i, v, historico))}
      {!cred.some(c => !c.revocado_at) && <p className="text-xs text-navy-400 mt-2">Sin credenciales activas.</p>}
      {revocadas.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm">Historial de credenciales revocadas ({revocadas.length})</summary>{revocadas.map(c => credencial(c, i, v, true))}</details>}
    </section>;
  }
  function instrumento(i, historico = false) {
    const vs = estado.vinculos.filter(v => v.instrumento_id === i.id);
    const revocados = vs.filter(v => v.revocado_at);
    const elegida = cuentas[i.id] ?? activas[0]?.id ?? '';
    const cuenta = activas.some(t => t.id === elegida) ? elegida : '';
    const existente = vs.some(v => !v.revocado_at && v.tarjeta_id === cuenta);
    return <article key={i.id} className="rounded-2xl border-2 border-navy-500 bg-navy-950 p-4 sm:p-6 mt-6 shadow-lg">
      <div className="eyebrow mb-2">Instrumento · {i.tipo}</div><Nombre tipo="instrumento" item={i} nombre={i.alias} ocupado={ocupado} renombrar={renombrar} />{meta(i, i.archivado_at ? `Archivado el ${fecha(i.archivado_at)}` : 'Activo')}
      {!historico && <><div className="flex flex-wrap gap-3 items-end mt-5 p-4 border border-navy-600 rounded-xl"><label className="flex-1 min-w-40 text-sm">Cuenta para un nuevo vínculo<select className="field mt-2" value={cuenta} onChange={e => setCuentas(prev => ({ ...prev, [i.id]: e.target.value }))}><option value="">Selecciona una cuenta activa</option>{activas.map(t => <option key={t.id} value={t.id}>{t.alias} · {t.moneda}</option>)}</select></label><button className="primary-button" disabled={ocupado || !cuenta || existente} onClick={() => ejecutar('crear_vinculo_captura', { p_instrumento: i.id, p_tarjeta: cuenta })}>Crear vínculo</button>{existente && <p className="text-xs text-navy-400 w-full">Ya existe un vínculo activo hacia esta cuenta; úsalo abajo.</p>}</div>
        {vs.filter(v => !v.revocado_at).map(v => vinculo(v, i))}
        {!vs.some(v => !v.revocado_at) && <p className="text-sm text-navy-400 mt-4">Sin vínculos activos.</p>}
      </>}
      {(historico ? vs : revocados).length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm">Historial de vínculos ({(historico ? vs : revocados).length})</summary>{(historico ? vs : revocados).map(v => vinculo(v, i, true))}</details>}
      {!historico && <button className="text-danger underline text-sm mt-5" disabled={ocupado} onClick={() => pedir(i.alias, `Se archivará «${i.alias}» y se revocarán todos sus vínculos y credenciales. Todos los atajos asociados dejarán de registrar gastos. Se conserva el historial y no se puede reactivar.`, 'archivar_instrumento_pago', { p_instrumento: i.id })}>Archivar instrumento</button>}
    </article>;
  }
  return <div className="mt-8 border-t border-navy-700 pt-6">
    <h3 className="text-xl font-semibold">Instrumentos y vínculos de captura</h3><p className="text-sm text-navy-400 mt-2">Instrumento → vínculo con una cuenta → credenciales de sus atajos. Renombrar solo cambia el alias; para cambiar un destino crea otro vínculo.</p>
    <form className="flex flex-wrap gap-3 items-end mt-5" onSubmit={e => { e.preventDefault(); ejecutar('crear_instrumento_pago', { p_alias: alias, p_tipo: 'wallet' }); }}><label className="flex-1 min-w-40 text-sm">Alias del nuevo instrumento<input className="field mt-2" maxLength={80} value={alias} onChange={e => setAlias(e.target.value)} placeholder="Ej: Wallet personal" /></label><button className="primary-button" disabled={ocupado || !alias.trim()}>Crear instrumento</button></form>
    {error && <p role="alert" className="text-danger mt-4">{error}</p>}
    {secreto && <section aria-label="Credencial recién creada" className="border-2 border-gold rounded-2xl bg-navy-950 p-5 mt-6 space-y-3"><h4 className="font-semibold">Credencial creada para {secreto.instrumento}</h4><p>Cuenta de destino: <strong>{secreto.cuenta}</strong></p><p>ID de credencial: <Identificador id={secreto.id} /></p><p>ID de vínculo: <Identificador id={secreto.vinculo} /></p><p className="text-sm">Guarda el secreto ahora; solo se muestra durante esta sesión. Este identificador no sustituye al secreto.</p><code className="block break-all select-all text-gold">{secreto.token}</code><p className="text-xs">En v2 usa version: 2 y binding_id: {secreto.vinculo}. Conserva el evento completo y su UUID al reintentar.</p><button className="underline" onClick={() => setSecreto(null)}>Ya lo guardé · ocultar secreto</button></section>}
    {confirmacion && <dialog ref={dialogo} onCancel={e => { e.preventDefault(); if (!bloqueo.current) setConfirmacion(null); }} role="alertdialog" aria-modal="true" aria-labelledby="confirmar-captura" aria-describedby="consecuencia-captura" className="fixed inset-0 m-auto max-w-lg w-[calc(100%-2rem)] border-2 border-red-400 rounded-2xl p-5 bg-navy-950 text-white backdrop:bg-black/70"><h4 id="confirmar-captura" className="font-semibold">Confirmar: {confirmacion.nombre}</h4><p id="consecuencia-captura" className="text-sm mt-3">{confirmacion.descripcion}</p><div className="flex flex-wrap gap-5 mt-4"><button className="text-danger underline" disabled={ocupado} onClick={() => ejecutar(confirmacion.rpc, confirmacion.params)}>Confirmar revocación / archivo</button><button className="underline" disabled={ocupado} onClick={() => setConfirmacion(null)}>Cancelar · conservar activo</button></div></dialog>}
    <h4 className="font-semibold mt-8">Instrumentos activos</h4>{estado.instrumentos.filter(i => !i.archivado_at).map(i => instrumento(i))}
    {!ocupado && !estado.instrumentos.some(i => !i.archivado_at) && <p className="text-sm text-navy-400 mt-3">Aún no tienes instrumentos activos.</p>}
    {estado.instrumentos.some(i => i.archivado_at) && <details className="mt-8 border border-navy-600 rounded-2xl p-4"><summary className="cursor-pointer">Historial de instrumentos archivados ({estado.instrumentos.filter(i => i.archivado_at).length})</summary>{estado.instrumentos.filter(i => i.archivado_at).map(i => instrumento(i, true))}</details>}
  </div>;
}
