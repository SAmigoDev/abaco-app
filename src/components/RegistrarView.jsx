'use client';

import { useState } from 'react';
import { cuentasActivas } from '@/lib/saldos.mjs';
import { parseTexto } from '@/lib/parseTexto';
import { enviarTransaccion } from '@/lib/transacciones';
import { agregarTransaccionCola } from '@/lib/indexedDb';
import MovimientoFijoForm from '@/components/MovimientoFijoForm';
import SimuladorCuotas from '@/components/SimuladorCuotas';
import { createClient } from '@/lib/supabase/client';
import MisCuotas from '@/components/MisCuotas';

function ahoraISOLocal() {
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  return ahora.toISOString().slice(0, 16);
}

const FORM_VACIO = {
  monto: '', comercio: '', fecha: ahoraISOLocal(), moneda: 'CLP',
  tarjetaId: '', categoriaId: '', origen: 'manual',
};

export default function RegistrarView({ tarjetas, categorias, movimientosFijosIniciales, comprasCuotas }) {
  const activas = cuentasActivas(tarjetas);
  const [modo, setModo] = useState('puntual'); // 'puntual' | 'fijo'
  const [paso, setPaso] = useState('inicial');
  const [textoPegado, setTextoPegado] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeExito, setMensajeExito] = useState(null);
  const [modalLineaCredito, setModalLineaCredito] = useState(null);
  const [movimientosFijos, setMovimientosFijos] = useState(movimientosFijosIniciales);
  const [modalFijo, setModalFijo] = useState(null);
  const [registrandoId, setRegistrandoId] = useState(null);
  const [esCuotas, setEsCuotas] = useState(false);
  const [numCuotas, setNumCuotas] = useState('');
  const [conoceTasaCuotas, setConoceTasaCuotas] = useState(false);
  const [tasaCuotas, setTasaCuotas] = useState('');

  function actualizarCampo(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function reiniciar() {
    setForm(FORM_VACIO);
    setTextoPegado('');
    setError(null);
    setEsCuotas(false);
    setNumCuotas('');
    setConoceTasaCuotas(false);
    setTasaCuotas('');
    setPaso('inicial');
  }

  async function analizarTexto() {
    if (!textoPegado.trim()) return;
    setAnalizando(true);
    const resultado = await parseTexto(textoPegado);
    setAnalizando(false);

    if (resultado.exito) {
      const tarjetaCoincidente = resultado.ultimosDigitos
        ? activas.find((t) => t.ultimos_digitos === resultado.ultimosDigitos)
        : null;

      setForm({
        monto: resultado.monto,
        comercio: resultado.comercio || '',
        fecha: resultado.fecha ? resultado.fecha.slice(0, 16) : ahoraISOLocal(),
        moneda: resultado.moneda || 'CLP',
        tarjetaId: tarjetaCoincidente?.id || '',
        categoriaId: '',
        origen: resultado.fuenteDetectada === 'email' ? 'regex_email' : 'regex_sms',
      });
    } else {
      setForm({ ...FORM_VACIO });
    }
    setPaso('formulario');
  }

  function irAManual() {
    setForm({ ...FORM_VACIO });
    setPaso('formulario');
  }

  function construirPayload(autorizado) {
    const montoNumerico = Number(form.monto);
    return {
      tarjetaId: form.tarjetaId,
      monto: form.moneda === 'CLP' ? Math.round(montoNumerico) : montoNumerico,
      moneda: form.moneda,
      comercio: form.comercio,
      fecha: new Date(form.fecha).toISOString(),
      origen: form.origen,
      categoriaId: form.categoriaId || undefined,
      autorizacionLineaCredito: autorizado,
    };
  }

  async function confirmarGasto(e, autorizado = false) {
    e?.preventDefault();
    setError(null);
    setGuardando(true);
    const payload = construirPayload(autorizado);

    if (!navigator.onLine) {
      await agregarTransaccionCola(payload);
      setGuardando(false);
      setMensajeExito('Sin conexión: el gasto quedó guardado y se subirá solo cuando vuelvas a tener internet.');
      reiniciar();
      return;
    }

    const resultado = await enviarTransaccion(payload);
    setGuardando(false);

    if (resultado.ok) {
      if (esCuotas && numCuotas) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('compras_cuotas').insert({
          usuario_id: user.id,
          transaccion_id: resultado.data?.id || null,
          tarjeta_id: form.tarjetaId,
          comercio: form.comercio,
          monto_total: Number(form.monto),
          num_cuotas: Number(numCuotas),
          monto_cuota: Number(form.monto) / Number(numCuotas),
          fecha_primera_cuota: form.fecha.slice(0, 10),
          tasa_interes_mensual: conoceTasaCuotas ? Number(tasaCuotas) : null,
        });
      }
      setMensajeExito('Gasto registrado correctamente.');
      reiniciar();
      return;
    }
    if (resultado.status === 402) {
      setModalLineaCredito(resultado.data);
      return;
    }
    if (resultado.status === 409) {
      setError('Ya existe un gasto igual registrado en los últimos 5 minutos.');
      return;
    }
    setError(resultado.data?.error || 'No se pudo registrar el gasto. Intenta de nuevo.');
  }

  return (
    <main className="min-h-screen bg-navy-900 px-4 py-8 md:px-8 max-w-2xl mx-auto">
      <h1 className="text-offwhite text-2xl font-semibold mb-4">Registrar</h1>

      <div className="flex gap-1 mb-6 bg-navy-800 border border-navy-700 rounded-lg p-1 w-fit">
        <button onClick={() => { setModo('puntual'); reiniciar(); }}
          className={`px-4 py-1.5 rounded-md text-sm ${modo === 'puntual' ? 'bg-navy-700 text-offwhite' : 'text-navy-400'}`}>
          Gasto puntual
        </button>
        <button onClick={() => setModo('fijo')}
          className={`px-4 py-1.5 rounded-md text-sm ${modo === 'fijo' ? 'bg-navy-700 text-offwhite' : 'text-navy-400'}`}>
          Gasto fijo
        </button>
        <button onClick={() => setModo('simulador')}
          className={`px-4 py-1.5 rounded-md text-sm ${modo === 'simulador' ? 'bg-navy-700 text-offwhite' : 'text-navy-400'}`}>
          Simulador de cuotas
        </button>
        <button onClick={() => setModo('cuotas')}
          className={`px-4 py-1.5 rounded-md text-sm ${modo === 'cuotas' ? 'bg-navy-700 text-offwhite' : 'text-navy-400'}`}>
          Mis Cuotas
        </button>
      </div>

      {mensajeExito && (
        <div className="bg-navy-800 border border-success rounded-lg p-3 mb-4">
          <p className="text-success text-sm">{mensajeExito}</p>
        </div>
      )}

      {modo === 'fijo' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setModalFijo('nuevo')} className="px-4 py-2 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
              + Agregar movimiento fijo
            </button>
          </div>

          {movimientosFijos.length === 0 ? (
            <p className="text-navy-400 text-sm">No tienes gastos o ingresos fijos registrados todavía.</p>
          ) : (
            <div className="space-y-3">
              {movimientosFijos.map((m) => (
                <div key={m.id} className="bg-navy-800 border border-navy-700 rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-offwhite text-sm font-medium">{m.nombre}</p>
                      <p className="text-navy-400 text-xs">
                        {m.categorias?.icono} {m.categorias?.nombre || 'Sin categoría'} · Día {m.dia_cobro} · {m.tarjetas?.alias || 'Sin tarjeta'}
                      </p>
                      <p className={`font-mono text-sm mt-1 ${m.tipo === 'ingreso' ? 'text-success' : 'text-offwhite'}`}>
                        {m.tipo === 'ingreso' ? '+' : '-'} {new Intl.NumberFormat('es-CL').format(m.monto)} {m.moneda}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setModalFijo(m)} className="text-navy-400 hover:text-gold text-xs">Editar</button>
                    </div>
                  </div>
                  <button
                    disabled={registrandoId === m.id || !activas.some(t => t.id === m.tarjeta_id)}
                    onClick={async () => {
                      setRegistrandoId(m.id);
                      const payload = {
                        tarjetaId: m.tarjeta_id,
                        monto: Number(m.monto),
                        moneda: m.moneda,
                        comercio: m.nombre,
                        fecha: new Date().toISOString(),
                        origen: 'fijo',
                        categoriaId: m.categoria_id || undefined,
                      };
                      const resultado = navigator.onLine
                        ? await enviarTransaccion(payload)
                        : (await agregarTransaccionCola(payload), { ok: true });
                      setRegistrandoId(null);
                      setMensajeExito(resultado.ok ? `"${m.nombre}" registrado hoy.` : 'No se pudo registrar. Intenta de nuevo.');
                    }}
                    className="w-full mt-3 py-2 rounded-lg border border-navy-700 text-navy-400 hover:text-gold text-xs font-medium disabled:opacity-60"
                  >
                    {!activas.some(t => t.id === m.tarjeta_id) ? 'Selecciona una cuenta activa' : registrandoId === m.id ? 'Registrando...' : 'Registrar hoy'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {modalFijo && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
              <div className="w-full max-w-md bg-navy-800 border border-navy-700 rounded-xl p-6">
                <h2 className="text-offwhite text-lg font-semibold mb-4">
                  {modalFijo === 'nuevo' ? 'Agregar movimiento fijo' : 'Editar movimiento fijo'}
                </h2>
                <MovimientoFijoForm
                  existente={modalFijo === 'nuevo' ? null : modalFijo}
                  tarjetas={tarjetas}
                  categorias={categorias}
                  onGuardado={(m) => {
                    setMovimientosFijos((prev) => prev.some((x) => x.id === m.id) ? prev.map((x) => x.id === m.id ? { ...x, ...m } : x) : [...prev, m]);
                    setModalFijo(null);
                  }}
                  onCancelar={() => setModalFijo(null)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {modo === 'puntual' && paso === 'inicial' && (
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-6">
          <label className="block text-navy-400 text-xs mb-2">Pega el SMS o correo de confirmación</label>
          <textarea
            value={textoPegado}
            onChange={(e) => setTextoPegado(e.target.value)}
            rows={5}
            placeholder="Ej: Te informamos que se ha realizado una compra por $15.000..."
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-4 outline-none focus:border-gold resize-none"
          />
          <button onClick={analizarTexto} disabled={analizando || !textoPegado.trim()}
            className="w-full py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60 mb-3">
            {analizando ? 'Analizando...' : 'Analizar texto'}
          </button>
          <button onClick={irAManual} className="w-full py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
            Ingresar manualmente
          </button>
        </div>
      )}

      {modo === 'puntual' && paso === 'formulario' && (
        <form onSubmit={(e) => confirmarGasto(e, false)} className="bg-navy-800 border border-navy-700 rounded-xl p-6">
          <p className="text-navy-400 text-xs mb-4">
            {form.origen === 'manual' ? 'Completa los datos del gasto.' : 'Revisa que los datos detectados sean correctos.'}
          </p>

          <label className="block text-navy-400 text-xs mb-1">Monto ({form.moneda})</label>
          <input required type="number" step="0.01" value={form.monto}
            onChange={(e) => actualizarCampo('monto', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite font-mono text-sm mb-3 outline-none focus:border-gold" />

          <label className="block text-navy-400 text-xs mb-1">Comercio</label>
          <input required value={form.comercio} onChange={(e) => actualizarCampo('comercio', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-navy-400 text-xs mb-1">Fecha y hora</label>
              <input required type="datetime-local" value={form.fecha} onChange={(e) => actualizarCampo('fecha', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm outline-none focus:border-gold" />
            </div>
            <div className="w-28">
              <label className="block text-navy-400 text-xs mb-1">Moneda</label>
              <select value={form.moneda} onChange={(e) => actualizarCampo('moneda', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm outline-none focus:border-gold">
                <option value="CLP">CLP</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <label className="block text-navy-400 text-xs mb-1">Tarjeta</label>
          <select required value={form.tarjetaId} onChange={(e) => actualizarCampo('tarjetaId', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold">
            <option value="" disabled>Selecciona una tarjeta</option>
            {activas.map((t) => <option key={t.id} value={t.id}>{t.alias}</option>)}
          </select>

          <label className="block text-navy-400 text-xs mb-1">Categoría</label>
          <select value={form.categoriaId} onChange={(e) => actualizarCampo('categoriaId', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-4 outline-none focus:border-gold">
            <option value="">Sin categoría (se asigna “otros”)</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>)}
          </select>

          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={esCuotas} onChange={(e) => setEsCuotas(e.target.checked)} className="w-4 h-4 accent-gold" />
            <span className="text-navy-400 text-sm">Es una compra en cuotas</span>
          </label>

          {esCuotas && (
            <div className="bg-navy-900 border border-navy-700 rounded-lg p-3 mb-3">
              <label className="block text-navy-400 text-xs mb-1">Número de cuotas</label>
              <input required={esCuotas} type="number" min="2" value={numCuotas} onChange={(e) => setNumCuotas(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-800 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={conoceTasaCuotas} onChange={(e) => setConoceTasaCuotas(e.target.checked)} className="w-4 h-4 accent-gold" />
                <span className="text-navy-400 text-xs">Conozco la tasa de interés mensual declarada</span>
              </label>

              {conoceTasaCuotas && (
                <input type="number" step="0.01" placeholder="Tasa mensual (%)" value={tasaCuotas} onChange={(e) => setTasaCuotas(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-800 text-offwhite text-sm outline-none focus:border-gold" />
              )}
            </div>
          )}

          {error && <p className="text-danger text-xs mb-3">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={reiniciar} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm disabled:opacity-60">
              {guardando ? 'Guardando...' : 'Confirmar y guardar'}
            </button>
          </div>
        </form>
      )}

      {modo === 'simulador' && <SimuladorCuotas />}
      {modo === 'cuotas' && <MisCuotas compras={comprasCuotas} />}

      {modalLineaCredito && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50">
          <div className="w-full max-w-sm bg-navy-800 border border-navy-700 rounded-xl p-6">
            <h2 className="text-offwhite text-lg font-semibold mb-2">Saldo insuficiente</h2>
            <p className="text-navy-400 text-sm mb-5">{modalLineaCredito.mensajeUsuario}</p>
            <div className="flex gap-3">
              <button onClick={() => setModalLineaCredito(null)} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
                Cancelar
              </button>
              <button onClick={() => { setModalLineaCredito(null); confirmarGasto(null, true); }}
                className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
                Usar línea de crédito
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}