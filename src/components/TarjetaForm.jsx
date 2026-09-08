'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const TIPOS_PRODUCTO = [
  { value: 'cuenta_corriente', label: 'Cuenta Corriente / Vista' },
  { value: 'linea_credito', label: 'Línea de Crédito' },
  { value: 'credito_nacional', label: 'Tarjeta de Crédito (Cupo Nacional)' },
  { value: 'credito_internacional', label: 'Tarjeta de Crédito (Cupo Internacional)' },
];

function formDesdeTarjeta(t) {
  if (!t) {
    return { alias: '', ultimos_digitos: '', tipo_producto: 'cuenta_corriente', moneda: 'CLP', saldo_actual: '', cupo_maximo: '', dia_corte: '', dia_pago: '' };
  }
  return {
    alias: t.alias,
    ultimos_digitos: t.ultimos_digitos,
    tipo_producto: t.tipo_producto,
    moneda: t.moneda,
    saldo_actual: t.saldo_actual,
    cupo_maximo: t.cupo_maximo ?? '',
    dia_corte: t.dia_corte ?? '',
    dia_pago: t.dia_pago ?? '',
  };
}

export default function TarjetaForm({ tarjetaExistente = null, onGuardado, onCancelar, textoBoton }) {
  const [form, setForm] = useState(() => formDesdeTarjeta(tarjetaExistente));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const supabase = createClient();
  const esEdicion = Boolean(tarjetaExistente);
  const requiereCupo = ['credito_nacional', 'credito_internacional', 'linea_credito'].includes(form.tipo_producto);
  const requiereFechasFacturacion = ['credito_nacional', 'credito_internacional'].includes(form.tipo_producto);

  function actualizarCampo(campo, valor) {
    setForm((prev) => {
      const siguiente = { ...prev, [campo]: valor };
      if (campo === 'tipo_producto') {
        siguiente.moneda = valor === 'credito_internacional' ? 'USD' : 'CLP';
      }
      return siguiente;
    });
  }

  async function manejarEnvio(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = {
      alias: form.alias,
      ultimos_digitos: form.ultimos_digitos,
      tipo_producto: form.tipo_producto,
      moneda: form.moneda,
      saldo_actual: Number(form.saldo_actual) || 0,
      cupo_maximo: requiereCupo ? Number(form.cupo_maximo) || null : null,
      dia_corte: requiereFechasFacturacion ? Number(form.dia_corte) || null : null,
      dia_pago: requiereFechasFacturacion ? Number(form.dia_pago) || null : null,
    };

    let resultado;
    if (esEdicion) {
      resultado = await supabase.from('tarjetas').update(payload).eq('id', tarjetaExistente.id).select().single();
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      resultado = await supabase.from('tarjetas').insert({ ...payload, usuario_id: user.id }).select().single();
    }

    setGuardando(false);

    if (resultado.error) {
      setError('No se pudo guardar la tarjeta. Intenta de nuevo.');
      return;
    }
    onGuardado?.(resultado.data);
  }

  return (
    <form onSubmit={manejarEnvio}>
      <label className="block text-navy-400 text-xs mb-1">Alias</label>
      <input required value={form.alias} onChange={(e) => actualizarCampo('alias', e.target.value)}
        placeholder="Ej: Débito Banco de Chile"
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

      <label className="block text-navy-400 text-xs mb-1">Últimos 4 dígitos</label>
      <input required maxLength={4} pattern="[0-9]{4}" value={form.ultimos_digitos}
        onChange={(e) => actualizarCampo('ultimos_digitos', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

      <label className="block text-navy-400 text-xs mb-1">Tipo</label>
      <select value={form.tipo_producto} onChange={(e) => actualizarCampo('tipo_producto', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold">
        {TIPOS_PRODUCTO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      <label className="block text-navy-400 text-xs mb-1">Saldo actual ({form.moneda})</label>
      <input required type="number" step="0.01" value={form.saldo_actual}
        onChange={(e) => actualizarCampo('saldo_actual', e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

      {requiereCupo && (
        <>
          <label className="block text-navy-400 text-xs mb-1">Cupo máximo ({form.moneda})</label>
          <input type="number" step="0.01" value={form.cupo_maximo} onChange={(e) => actualizarCampo('cupo_maximo', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />
        </>
      )}
      {requiereFechasFacturacion && (
        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-navy-400 text-xs mb-1">Día de corte</label>
            <input type="number" min="1" max="31" value={form.dia_corte} onChange={(e) => actualizarCampo('dia_corte', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm outline-none focus:border-gold" />
          </div>
          <div className="flex-1">
            <label className="block text-navy-400 text-xs mb-1">Día de pago</label>
            <input type="number" min="1" max="31" value={form.dia_pago} onChange={(e) => actualizarCampo('dia_pago', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm outline-none focus:border-gold" />
          </div>
        </div>
      )}

      {error && <p className="text-danger text-xs mb-3">{error}</p>}

      <div className="flex gap-3 mt-1">
        {onCancelar && (
          <button type="button" onClick={onCancelar} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={guardando} className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60">
          {guardando ? 'Guardando...' : (textoBoton || (esEdicion ? 'Guardar cambios' : 'Guardar tarjeta'))}
        </button>
      </div>
    </form>
  );
}