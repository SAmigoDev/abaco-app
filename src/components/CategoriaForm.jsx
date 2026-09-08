'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function CategoriaForm({ categoriaExistente = null, onGuardado, onCancelar }) {
  const [nombre, setNombre] = useState(categoriaExistente?.nombre || '');
  const [icono, setIcono] = useState(categoriaExistente?.icono || '📦');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const supabase = createClient();
  const esEdicion = Boolean(categoriaExistente);

  async function manejarEnvio(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = { nombre: nombre.trim().toLowerCase(), icono };
    let resultado;

    if (esEdicion) {
      resultado = await supabase.from('categorias').update(payload).eq('id', categoriaExistente.id).select().single();
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      resultado = await supabase.from('categorias').insert({ ...payload, usuario_id: user.id, es_por_defecto: false }).select().single();
    }

    setGuardando(false);

    if (resultado.error) {
      if (resultado.error.code === '23505') {
        setError('Ya tienes una categoría con ese nombre.');
      } else {
        setError('No se pudo guardar la categoría. Intenta de nuevo.');
      }
      return;
    }
    onGuardado?.(resultado.data);
  }

  return (
    <form onSubmit={manejarEnvio}>
      <label className="block text-navy-400 text-xs mb-1">Ícono (emoji)</label>
      <input
        value={icono}
        onChange={(e) => setIcono(e.target.value)}
        maxLength={4}
        className="w-16 px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-lg text-center mb-3 outline-none focus:border-gold"
      />

      <label className="block text-navy-400 text-xs mb-1">Nombre</label>
      <input
        required
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Ej: mascotas"
        className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold"
      />

      {error && <p className="text-danger text-xs mb-3">{error}</p>}

      <div className="flex gap-3 mt-1">
        {onCancelar && (
          <button type="button" onClick={onCancelar} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={guardando} className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60">
          {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agregar categoría'}
        </button>
      </div>
    </form>
  );
}