'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import TarjetaForm from '@/components/TarjetaForm';
import CategoriaForm from '@/components/CategoriaForm';
import MetaAhorroForm from '@/components/MetaAhorroForm';

const ETIQUETA_TIPO = {
  cuenta_corriente: 'Cuenta Corriente',
  linea_credito: 'Línea de Crédito',
  credito_nacional: 'Crédito (Nacional)',
  credito_internacional: 'Crédito (Internacional)',
};

export default function ConfiguracionView({
  tarjetasIniciales,
  categoriasIniciales,
  presupuestoActivoInicial,
  metasIniciales,
}) {
  const [tarjetas, setTarjetas] = useState(tarjetasIniciales);
  const [categorias, setCategorias] = useState(categoriasIniciales);
  const [metas, setMetas] = useState(metasIniciales);
  const [presupuestoActivo, setPresupuestoActivo] = useState(presupuestoActivoInicial);
  const [modal, setModal] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [borrando, setBorrando] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState(null);
  const [guardandoPresupuesto, setGuardandoPresupuesto] = useState(false);
  const supabase = createClient();

  // ── Tarjetas ──
  function alGuardarTarjeta(tarjeta) {
    setTarjetas((prev) =>
      prev.some((t) => t.id === tarjeta.id) ? prev.map((t) => (t.id === tarjeta.id ? tarjeta : t)) : [...prev, tarjeta]
    );
    setModal(null);
  }

  async function eliminarTarjeta(id) {
    setBorrando(true);
    const { error } = await supabase.from('tarjetas').delete().eq('id', id);
    setBorrando(false);
    if (!error) setTarjetas((prev) => prev.filter((t) => t.id !== id));
    setConfirmando(null);
  }

  // ── Categorías ──
  function alGuardarCategoria(categoria) {
    setCategorias((prev) =>
      prev.some((c) => c.id === categoria.id)
        ? prev.map((c) => (c.id === categoria.id ? categoria : c))
        : [...prev, categoria].sort((a, b) => a.nombre.localeCompare(b.nombre))
    );
    setModal(null);
  }

  async function eliminarCategoria(categoria) {
    if (categoria.nombre === 'otros') {
      setErrorCategoria('La categoría "otros" no se puede eliminar — es el destino de respaldo cuando borras otras categorías.');
      return;
    }
    setBorrando(true);
    const { error } = await supabase.from('categorias').delete().eq('id', categoria.id);
    setBorrando(false);
    if (!error) setCategorias((prev) => prev.filter((c) => c.id !== categoria.id));
    setConfirmando(null);
  }

  // ── Metas de Ahorro ──
  function alGuardarMeta(meta) {
    setMetas((prev) => (prev.some((m) => m.id === meta.id) ? prev.map((m) => (m.id === meta.id ? meta : m)) : [...prev, meta]));
    setModal(null);
  }

  async function eliminarMeta(id) {
    setBorrando(true);
    const { error } = await supabase.from('metas_ahorro').delete().eq('id', id);
    setBorrando(false);
    if (!error) setMetas((prev) => prev.filter((m) => m.id !== id));
    setConfirmando(null);
  }

  // ── Presupuesto 50/30/20 ──
  async function alternarPresupuesto() {
    const nuevoValor = !presupuestoActivo;
    setGuardandoPresupuesto(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('usuarios').update({ regla_presupuesto_activa: nuevoValor }).eq('id', user.id);
    setGuardandoPresupuesto(false);
    if (!error) setPresupuestoActivo(nuevoValor);
  }

  return (
    <main className="min-h-screen bg-navy-900 px-4 py-8 md:px-8 max-w-5xl mx-auto">
      <h1 className="text-offwhite text-2xl font-semibold mb-6">Configuración</h1>

      {/* ── Tarjetas ── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-offwhite text-lg font-semibold">Tarjetas y cuentas</h2>
          <button onClick={() => setModal({ tipo: 'tarjeta', valor: 'nueva' })} className="px-4 py-2 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
            + Agregar tarjeta
          </button>
        </div>

        {tarjetas.length === 0 ? (
          <p className="text-navy-400 text-sm">No tienes tarjetas registradas todavía.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tarjetas.map((t) => (
              <div key={t.id} className="bg-navy-800 border border-navy-700 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-offwhite text-sm font-medium">{t.alias}</p>
                    <p className="text-navy-400 text-xs">•••• {t.ultimos_digitos} · {ETIQUETA_TIPO[t.tipo_producto]}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setModal({ tipo: 'tarjeta', valor: t })} className="text-navy-400 hover:text-gold text-xs">Editar</button>
                    <button onClick={() => setConfirmando({ tipo: 'tarjeta', valor: t })} className="text-navy-400 hover:text-danger text-xs">Eliminar</button>
                  </div>
                </div>
                {confirmando?.tipo === 'tarjeta' && confirmando.valor.id === t.id && (
                  <div className="mt-3 bg-navy-900 border border-danger rounded-lg p-3">
                    <p className="text-offwhite text-xs mb-2">¿Eliminar esta tarjeta? No se puede deshacer.</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmando(null)} className="flex-1 py-1.5 rounded-md border border-navy-700 text-navy-400 text-xs">Cancelar</button>
                      <button onClick={() => eliminarTarjeta(t.id)} disabled={borrando} className="flex-1 py-1.5 rounded-md bg-danger text-offwhite text-xs disabled:opacity-60">
                        {borrando ? 'Eliminando...' : 'Sí, eliminar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Categorías ── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-offwhite text-lg font-semibold">Categorías personalizadas</h2>
          <button onClick={() => setModal({ tipo: 'categoria', valor: 'nueva' })} className="px-4 py-2 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
            + Agregar categoría
          </button>
        </div>

        {errorCategoria && <p className="text-danger text-xs mb-3">{errorCategoria}</p>}

        <div className="flex flex-wrap gap-2">
          {categorias.map((c) => (
            <div key={c.id} className="flex items-center gap-2 bg-navy-800 border border-navy-700 rounded-full pl-3 pr-2 py-1.5">
              <span>{c.icono}</span>
              <span className="text-offwhite text-sm">{c.nombre}</span>
              <button onClick={() => setModal({ tipo: 'categoria', valor: c })} className="text-navy-400 hover:text-gold text-xs ml-1">✎</button>
              {c.nombre !== 'otros' && (
                <button onClick={() => setConfirmando({ tipo: 'categoria', valor: c })} className="text-navy-400 hover:text-danger text-xs">✕</button>
              )}
            </div>
          ))}
        </div>

        {confirmando?.tipo === 'categoria' && (
          <div className="mt-3 bg-navy-900 border border-danger rounded-lg p-3 max-w-sm">
            <p className="text-offwhite text-xs mb-2">
              ¿Eliminar “{confirmando.valor.nombre}”? Los gastos que tenían esta categoría pasarán a “otros”.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmando(null)} className="flex-1 py-1.5 rounded-md border border-navy-700 text-navy-400 text-xs">Cancelar</button>
              <button onClick={() => eliminarCategoria(confirmando.valor)} disabled={borrando} className="flex-1 py-1.5 rounded-md bg-danger text-offwhite text-xs disabled:opacity-60">
                {borrando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Metas de Ahorro ── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-offwhite text-lg font-semibold">Metas de ahorro</h2>
          <button onClick={() => setModal({ tipo: 'meta', valor: 'nueva' })} className="px-4 py-2 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
            + Agregar meta
          </button>
        </div>

        {metas.length === 0 ? (
          <p className="text-navy-400 text-sm">No tienes metas de ahorro todavía.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {metas.map((m) => {
              const porcentaje = Math.min(100, Math.round((m.monto_actual / m.monto_objetivo) * 100));
              return (
                <div key={m.id} className="bg-navy-800 border border-navy-700 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-offwhite text-sm font-medium">{m.nombre}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setModal({ tipo: 'meta', valor: m })} className="text-navy-400 hover:text-gold text-xs">Editar</button>
                      <button onClick={() => setConfirmando({ tipo: 'meta', valor: m })} className="text-navy-400 hover:text-danger text-xs">Eliminar</button>
                    </div>
                  </div>
                  <p className="text-navy-400 font-mono text-xs mb-2">
                    {new Intl.NumberFormat('es-CL').format(m.monto_actual)} / {new Intl.NumberFormat('es-CL').format(m.monto_objetivo)}
                  </p>
                  <div className="w-full h-2 bg-navy-900 rounded-full overflow-hidden">
                    <div className="h-full bg-gold" style={{ width: `${porcentaje}%` }} />
                  </div>

                  {confirmando?.tipo === 'meta' && confirmando.valor.id === m.id && (
                    <div className="mt-3 bg-navy-900 border border-danger rounded-lg p-3">
                      <p className="text-offwhite text-xs mb-2">¿Eliminar esta meta? No se puede deshacer.</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmando(null)} className="flex-1 py-1.5 rounded-md border border-navy-700 text-navy-400 text-xs">Cancelar</button>
                        <button onClick={() => eliminarMeta(m.id)} disabled={borrando} className="flex-1 py-1.5 rounded-md bg-danger text-offwhite text-xs disabled:opacity-60">
                          {borrando ? 'Eliminando...' : 'Sí, eliminar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Presupuesto 50/30/20 ── */}
      <section>
        <h2 className="text-offwhite text-lg font-semibold mb-3">Presupuesto 50/30/20</h2>
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-5 flex items-center justify-between max-w-md">
          <div>
            <p className="text-offwhite text-sm font-medium">Distribuir mi sueldo en billeteras virtuales</p>
            <p className="text-navy-400 text-xs mt-1">50% gastos libres · 30% gastos fijos · 20% ahorro</p>
          </div>
          <button
            onClick={alternarPresupuesto}
            disabled={guardandoPresupuesto}
            className={`relative w-12 h-6 p-0 rounded-full transition-colors ${presupuestoActivo ? 'bg-gold' : 'bg-navy-700'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-offwhite transition-transform ${presupuestoActivo ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
      </section>

      {/* ── Modales ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="w-full max-w-md bg-navy-800 border border-navy-700 rounded-xl p-6">
            {modal.tipo === 'tarjeta' ? (
              <>
                <h2 className="text-offwhite text-lg font-semibold mb-4">{modal.valor === 'nueva' ? 'Agregar tarjeta' : 'Editar tarjeta'}</h2>
                <TarjetaForm tarjetaExistente={modal.valor === 'nueva' ? null : modal.valor} onGuardado={alGuardarTarjeta} onCancelar={() => setModal(null)} />
              </>
            ) : modal.tipo === 'categoria' ? (
              <>
                <h2 className="text-offwhite text-lg font-semibold mb-4">{modal.valor === 'nueva' ? 'Agregar categoría' : 'Editar categoría'}</h2>
                <CategoriaForm categoriaExistente={modal.valor === 'nueva' ? null : modal.valor} onGuardado={alGuardarCategoria} onCancelar={() => setModal(null)} />
              </>
            ) : (
              <>
                <h2 className="text-offwhite text-lg font-semibold mb-4">{modal.valor === 'nueva' ? 'Agregar meta' : 'Editar meta'}</h2>
                <MetaAhorroForm existente={modal.valor === 'nueva' ? null : modal.valor} onGuardado={alGuardarMeta} onCancelar={() => setModal(null)} />
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}