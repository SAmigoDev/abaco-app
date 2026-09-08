'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function formDesde(m) {
  if (!m) return { nombre: '', monto_objetivo: '', monto_actual: '0' };
  return { nombre: m.nombre, monto_objetivo: m.monto_objetivo, monto_actual: m.monto_actual };
}

export default function MetaAhorroForm({ existente = null, onGuardado, onCancelar }) {
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
      monto_objetivo: Number(form.monto_objetivo),
      monto_actual: Number(form.monto_actual) || 0,
    };

    let resultado;
    if (esEdicion) {
      resultado = await supabase.from('metas_ahorro').update(payload).eq('id', existente.id).select().single();
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      resultado = await supabase.from('metas_ahorro').insert({ ...payload, usuario_id: user.id }).select().single();
    }

    setGuardando(false);
    if (resultado.error) {
      setError('No se pudo guardar la meta. Intenta de nuevo.');
      return;
    }
    onGuardado?.(resultado.data);
  }

  return (
    <form onSubmit={manejarEnvio}>
      <label className="block text-navy-400 text-xs mb-1">Nombre de la meta</label>
      <input required value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)}
        placeholder="Ej: Vacaciones 2027"
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

      <label className="block text-navy-400 text-xs mb-1">Monto objetivo</label>
      <input required type="number" step="0.01" value={form.monto_objetivo} onChange={(e) => actualizar('monto_objetivo', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite font-mono text-sm mb-3 outline-none focus:border-gold" />

      <label className="block text-navy-400 text-xs mb-1">Monto actual ahorrado</label>
      <input type="number" step="0.01" value={form.monto_actual} onChange={(e) => actualizar('monto_actual', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite font-mono text-sm mb-4 outline-none focus:border-gold" />

      {error && <p className="text-danger text-xs mb-3">{error}</p>}

      <div className="flex gap-3">
        <button type="button" onClick={onCancelar} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60">
          {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agregar meta'}
        </button>
      </div>
    </form>
  );
}