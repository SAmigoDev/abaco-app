'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function formDesde(m) {
  if (!m) return { nombre: '', tipo: 'gasto', monto: '', moneda: 'CLP', categoriaId: '', tarjetaId: '', diaCobro: '', esSuscripcion: false };
  return {
    nombre: m.nombre, tipo: m.tipo, monto: m.monto, moneda: m.moneda,
    categoriaId: m.categoria_id || '', tarjetaId: m.tarjeta_id || '', diaCobro: m.dia_cobro,
    esSuscripcion: m.es_suscripcion || false,
  };
}

export default function MovimientoFijoForm({ existente = null, tarjetas, categorias, onGuardado, onCancelar }) {
  const [form, setForm] = useState(() => formDesde(existente));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const supabase = createClient();
  const esEdicion = Boolean(existente);

  function actualizar(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  async function manejarEnvio(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = {
      nombre: form.nombre,
      tipo: form.tipo,
      monto: Number(form.monto),
      moneda: form.moneda,
      categoria_id: form.categoriaId || null,
      tarjeta_id: form.tarjetaId || null,
      dia_cobro: Number(form.diaCobro),
      es_suscripcion: form.esSuscripcion,
    };

    let resultado;
    if (esEdicion) {
      resultado = await supabase.from('movimientos_fijos').update(payload).eq('id', existente.id).select().single();
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      resultado = await supabase.from('movimientos_fijos').insert({ ...payload, usuario_id: user.id, activo: true }).select().single();
    }

    setGuardando(false);
    if (resultado.error) {
      setError('No se pudo guardar. Intenta de nuevo.');
      return;
    }
    onGuardado?.(resultado.data);
  }

  return (
    <form onSubmit={manejarEnvio}>
      <div className="flex gap-2 mb-3">
        <button type="button" onClick={() => actualizar('tipo', 'gasto')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium ${form.tipo === 'gasto' ? 'bg-danger text-offwhite' : 'bg-navy-900 border border-navy-700 text-navy-400'}`}>
          Gasto
        </button>
        <button type="button" onClick={() => actualizar('tipo', 'ingreso')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium ${form.tipo === 'ingreso' ? 'bg-success text-navy-900' : 'bg-navy-900 border border-navy-700 text-navy-400'}`}>
          Ingreso
        </button>
      </div>

      <label className="block text-navy-400 text-xs mb-1">Nombre</label>
      <input required value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)}
        placeholder="Ej: Suscripción Netflix"
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <label className="block text-navy-400 text-xs mb-1">Monto</label>
          <input required type="number" step="0.01" value={form.monto} onChange={(e) => actualizar('monto', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite font-mono text-sm outline-none focus:border-gold" />
        </div>
        <div className="w-24">
          <label className="block text-navy-400 text-xs mb-1">Moneda</label>
          <select value={form.moneda} onChange={(e) => actualizar('moneda', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm outline-none focus:border-gold">
            <option value="CLP">CLP</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      <label className="block text-navy-400 text-xs mb-1">Día de cobro (1-31)</label>
      <input required type="number" min="1" max="31" value={form.diaCobro} onChange={(e) => actualizar('diaCobro', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

      <label className="block text-navy-400 text-xs mb-1">Tarjeta</label>
      <select value={form.tarjetaId} onChange={(e) => actualizar('tarjetaId', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold">
        <option value="">Sin tarjeta asignada</option>
        {tarjetas.map((t) => <option key={t.id} value={t.id}>{t.alias}</option>)}
      </select>

      <label className="block text-navy-400 text-xs mb-1">Categoría</label>
      <select value={form.categoriaId} onChange={(e) => actualizar('categoriaId', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-4 outline-none focus:border-gold">
        <option value="">Sin categoría</option>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>)}
      </select>

      {error && <p className="text-danger text-xs mb-3">{error}</p>}

      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={form.esSuscripcion}
          onChange={(e) => actualizar('esSuscripcion', e.target.checked)}
          className="w-4 h-4 accent-gold"
        />
        <span className="text-navy-400 text-sm">Es una suscripción (para el Termómetro)</span>
      </label>

      <div className="flex gap-3">
        <button type="button" onClick={onCancelar} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60">
          {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agregar'}
        </button>
      </div>
    </form>
  );
}