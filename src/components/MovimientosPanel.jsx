'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const MOTIVOS = { saldo_insuficiente: 'Saldo insuficiente', moneda_cuenta_distinta: 'Confirma el importe en la moneda de la cuenta', cupo_insuficiente: 'Cupo insuficiente', saldo_desconocido: 'Saldo de cuenta desconocido' };

export default function MovimientosPanel({ transacciones, tarjetas }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [revision, setRevision] = useState(null);
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const router = useRouter();
  const dialogo = useRef(null);
  useEffect(() => {
    if (!revision) return;
    const anterior = document.activeElement;
    const campos = () => Array.from(dialogo.current?.querySelectorAll('input, button') || []);
    campos()[0]?.focus();
    function teclado(e) {
      if (e.key === 'Escape') { setRevision(null); return; }
      if (e.key !== 'Tab') return;
      const lista = campos();
      const primero = lista[0], ultimo = lista.at(-1);
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
    }
    document.addEventListener('keydown', teclado);
    return () => { document.removeEventListener('keydown', teclado); anterior?.focus(); };
  }, [revision]);
  const movimientos = transacciones.filter(t =>
    (filtro !== 'pendientes' || t.estado_revision === 'pendiente') &&
    `${t.comercio} ${t.categorias?.nombre || ''}`.toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es'))
  ).toSorted((a,b) => new Date(b.fecha) - new Date(a.fecha)).slice(0,30);
  const cuenta = tarjetas.find(t => t.id === revision?.tarjeta_id);

  async function confirmar(e) {
    e.preventDefault(); setOcupado(true); setError('');
    try {
      const { error } = await createClient().rpc('confirmar_gasto_pendiente', { p_id: revision.id, p_monto_cuenta: Number(monto) });
      if (error) throw error;
      setRevision(null); router.refresh();
    } catch { setError('No se pudo confirmar. Revisa el importe y vuelve a intentarlo.'); }
    finally { setOcupado(false); }
  }

  return <section className="surface mb-8" aria-labelledby="movimientos-titulo">
    <div className="flex flex-wrap justify-between gap-4 mb-5">
      <div><div className="eyebrow">Tu actividad</div><h2 id="movimientos-titulo" className="text-xl font-semibold mt-1">Movimientos</h2></div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Buscar movimientos" className="field w-48" placeholder="Buscar comercio o categoría" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <select aria-label="Estado del movimiento" className="field w-auto" value={filtro} onChange={e => setFiltro(e.target.value)}><option value="todos">Todos</option><option value="pendientes">Por revisar</option></select>
      </div>
    </div>
    {movimientos.length === 0 && <p className="text-navy-400 py-8 text-center">No hay movimientos para este filtro.</p>}
    <ul className="divide-y divide-navy-700">
      {movimientos.map(t => <li key={t.id} className="flex items-center justify-between gap-3 py-4">
        <div className="min-w-0"><p className="font-medium truncate">{t.categorias?.icono || '↗'} {t.comercio}</p>
          <p className="text-navy-400 text-xs mt-1">{t.categorias?.nombre || 'Sin categoría'} · {new Date(t.fecha).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })} · {t.origen === 'apple_wallet' ? 'Wallet' : t.origen === 'atajo_manual' ? 'Atajo' : 'Web'}</p>
          {t.estado_revision === 'pendiente' && <button className="text-gold text-xs mt-2 underline" onClick={() => { setRevision(t); setMonto(t.motivo_revision === 'moneda_cuenta_distinta' ? '' : String(t.monto_original)); setError(''); }}>Por revisar · {MOTIVOS[t.motivo_revision] || 'Revisar datos'}</button>}
        </div>
        <span className="font-mono whitespace-nowrap text-sm">−{new Intl.NumberFormat('es-CL', { style: 'currency', currency: t.moneda_original || 'CLP' }).format(t.monto_original ?? t.monto_clp)}</span>
      </li>)}
    </ul>
    <p className="text-navy-400 text-xs mt-4">Hasta 30 resultados. Los pendientes se conservan sin modificar el saldo.</p>
    {revision && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="revision-titulo">
      <form ref={dialogo} onSubmit={confirmar} className="surface w-full max-w-md">
        <h3 id="revision-titulo" className="text-xl font-semibold">Revisar {revision.comercio}</h3>
        <p className="text-navy-400 text-sm my-4">Confirma cuánto se cargó a {cuenta?.alias}. Este importe se descontará del saldo o se sumará a la deuda de esta cuenta, incluso si excede el saldo o cupo registrado.</p>
        <label className="text-sm">Importe en {cuenta?.moneda}<input autoFocus required type="number" min="0.01" step="0.01" className="field mt-2" value={monto} onChange={e => setMonto(e.target.value)} /></label>
        {error && <p role="alert" className="text-danger text-sm mt-3">{error}</p>}
        <div className="flex gap-3 mt-5"><button type="button" className="field" onClick={() => setRevision(null)}>Cancelar</button><button className="primary-button" disabled={ocupado}>Confirmar cargo</button></div>
      </form>
    </div>}
  </section>;
}
