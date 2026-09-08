'use client';

import { useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  LineChart, Line,
} from 'recharts';
import { colorDeCategoria } from '@/lib/categoryColors';
import ReporteExport from '@/components/ReporteExport';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatoCLP(valor) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(valor || 0);
}

export default function DashboardView({ tarjetas, transacciones, errorTransacciones, metas, movimientosFijos, tasasCambio }) {
  const hoy = new Date();
  const [mesSeleccionado, setMesSeleccionado] = useState(hoy.getMonth());

  const tarjetasCredito = tarjetas.filter(
    (t) => t.tipo_producto === 'credito_nacional' || t.tipo_producto === 'credito_internacional'
  );

  const saldoDisponible = tarjetas
    .filter((t) => t.tipo_producto === 'cuenta_corriente')
    .reduce((acc, t) => acc + Number(t.saldo_actual || 0), 0);

  const deudaTotalCredito = tarjetasCredito.reduce(
    (acc, t) => acc + Number(t.saldo_actual || 0),
    0
  );

  const dataLinea = useMemo(() => {
    const totalesPorMes = Array(12).fill(0);
    transacciones.forEach((t) => {
      const mes = new Date(t.fecha).getMonth();
      totalesPorMes[mes] += Number(t.monto_clp || 0);
    });
    return MESES.map((mes, i) => ({ mes, total: totalesPorMes[i], mesIndex: i })).slice(0, hoy.getMonth() + 1);
  }, [transacciones]);

  const dataDona = useMemo(() => {
    const porCategoria = {};
    transacciones
      .filter((t) => new Date(t.fecha).getMonth() === mesSeleccionado)
      .forEach((t) => {
        const nombre = t.categorias?.nombre || 'otros';
        porCategoria[nombre] = (porCategoria[nombre] || 0) + Number(t.monto_clp || 0);
      });
    return Object.entries(porCategoria).map(([nombre, valor]) => ({
      name: nombre,
      value: valor,
      color: colorDeCategoria(nombre),
    }));
  }, [transacciones, mesSeleccionado]);

  const totalMesSeleccionado = dataDona.reduce((acc, d) => acc + d.value, 0);
  const transaccionesDelMes = transacciones.filter((t) => new Date(t.fecha).getMonth() === mesSeleccionado);
  const mesLabel = `${MESES[mesSeleccionado]}_${hoy.getFullYear()}`;

  const categoriasUnicas = useMemo(() => {
    const set = new Set(transacciones.map((t) => t.categorias?.nombre || 'otros'));
    return Array.from(set);
  }, [transacciones]);

  const dataBarras = useMemo(() => {
    const base = MESES.slice(0, hoy.getMonth() + 1).map((mes) => ({ mes }));
    transacciones.forEach((t) => {
      const mes = new Date(t.fecha).getMonth();
      const nombreCat = t.categorias?.nombre || 'otros';
      base[mes][nombreCat] = (base[mes][nombreCat] || 0) + Number(t.monto_clp || 0);
    });
    return base;
  }, [transacciones]);

  const resumenSuscripciones = useMemo(() => {
    const suscripciones = movimientosFijos.filter(
      (m) => m.tipo === 'gasto' && m.es_suscripcion && m.activo
    );

    const valorUSD = tasasCambio.find((t) => t.moneda === 'USD')?.valor || 0;

    const totalMensualClp = suscripciones.reduce((acc, m) => {
      const monto = Number(m.monto);
      return acc + (m.moneda === 'USD' ? monto * valorUSD : monto);
    }, 0);

    return {
      suscripciones,
      totalMensualClp,
      totalAnualClp: totalMensualClp * 12,
    };
  }, [movimientosFijos, tasasCambio]);

  return (
    <main className="min-h-screen bg-navy-900 px-4 py-8 md:px-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-offwhite text-2xl font-semibold">Dashboard</h1>
        <ReporteExport
          transacciones={transaccionesDelMes}
          movimientosFijos={movimientosFijos}
          tarjetas={tarjetas}
          metas={metas}
          mesLabel={mesLabel}
        />
      </div>

      {errorTransacciones && (
        <p className="text-danger text-sm mb-4">
          No se pudieron cargar tus transacciones: {errorTransacciones}
        </p>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-5">
          <p className="text-navy-400 text-xs mb-1">Saldo disponible (cuentas)</p>
          <p className="font-mono text-2xl font-semibold text-offwhite">{formatoCLP(saldoDisponible)}</p>
        </div>
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-5">
          <p className="text-navy-400 text-xs mb-1">Deuda en tarjetas de crédito</p>
          <p className="font-mono text-2xl font-semibold text-danger">{formatoCLP(deudaTotalCredito)}</p>
        </div>
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-5">
          <p className="text-navy-400 text-xs mb-1">Gasto de {MESES[mesSeleccionado]}</p>
          <p className="font-mono text-2xl font-semibold text-offwhite">{formatoCLP(totalMesSeleccionado)}</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-offwhite text-lg font-semibold mb-3">Tus cuentas y tarjetas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tarjetas.map((t) => (
            <div key={t.id} className="bg-navy-800 border border-navy-700 rounded-xl p-4">
              <p className="text-offwhite text-sm font-medium">{t.alias}</p>
              <p className="text-navy-400 text-xs mb-2">•••• {t.ultimos_digitos}</p>
              <p className="font-mono text-lg text-offwhite">
                {formatoCLP(t.saldo_actual)} <span className="text-navy-400 text-xs">{t.moneda}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy-800 border border-navy-700 rounded-xl p-5 mb-8">
        <h2 className="text-offwhite text-lg font-semibold mb-1">Gasto mensual — {hoy.getFullYear()}</h2>
        <p className="text-navy-400 text-xs mb-4">Haz clic en un mes para ver su detalle abajo.</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={dataLinea}
            onClick={(e) => {
              if (e && e.activePayload && e.activePayload[0]) {
                setMesSeleccionado(e.activePayload[0].payload.mesIndex);
              }
            }}
          >
            <CartesianGrid stroke="#274272" strokeDasharray="3 3" />
            <XAxis dataKey="mes" stroke="#6C90C3" fontSize={12} />
            <YAxis stroke="#6C90C3" fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip
              formatter={(v) => formatoCLP(v)}
              contentStyle={{ background: '#171F55', border: '1px solid #274272', borderRadius: 8 }}
              labelStyle={{ color: '#EDF1FA' }}
            />
            <Line type="monotone" dataKey="total" stroke="#C9A66B" strokeWidth={2} dot={{ r: 4, cursor: 'pointer' }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <section className="bg-navy-800 border border-navy-700 rounded-xl p-5">
          <h2 className="text-offwhite text-lg font-semibold mb-4">
            Gastos por categoría — {MESES[mesSeleccionado]}
          </h2>
          {dataDona.length === 0 ? (
            <p className="text-navy-400 text-sm">Sin gastos registrados este mes.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={dataDona} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                  {dataDona.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => formatoCLP(v)}
                  contentStyle={{ background: '#171F55', border: '1px solid #274272', borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6C90C3' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="bg-navy-800 border border-navy-700 rounded-xl p-5">
          <h2 className="text-offwhite text-lg font-semibold mb-4">Comparativo mensual</h2>
          {dataBarras.length === 0 ? (
            <p className="text-navy-400 text-sm">Aún no hay suficientes datos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dataBarras}>
                <CartesianGrid stroke="#274272" strokeDasharray="3 3" />
                <XAxis dataKey="mes" stroke="#6C90C3" fontSize={12} />
                <YAxis stroke="#6C90C3" fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={(v) => formatoCLP(v)}
                  contentStyle={{ background: '#171F55', border: '1px solid #274272', borderRadius: 8 }}
                />
                {categoriasUnicas.map((cat) => (
                  <Bar key={cat} dataKey={cat} stackId="gastos" fill={colorDeCategoria(cat)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      {resumenSuscripciones.suscripciones.length > 0 && (
        <section className="bg-navy-800 border border-navy-700 rounded-xl p-5 mb-8">
          <h2 className="text-offwhite text-lg font-semibold mb-1">🌡️ Termómetro de Suscripciones</h2>
          <p className="text-navy-400 text-sm mb-4">
            Estás gastando{' '}
            <span className="text-danger font-mono font-semibold">{formatoCLP(resumenSuscripciones.totalAnualClp)}</span>{' '}
            al año en suscripciones.
          </p>
          <div className="space-y-2">
            {resumenSuscripciones.suscripciones.map((s) => (
              <div key={s.id} className="flex justify-between text-sm">
                <span className="text-offwhite">{s.nombre}</span>
                <span className="text-navy-400 font-mono">
                  {formatoCLP(s.monto)} {s.moneda} / mes
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {metas.length > 0 && (
        <section className="bg-navy-800 border border-navy-700 rounded-xl p-5">
          <h2 className="text-offwhite text-lg font-semibold mb-4">Metas de ahorro</h2>
          <div className="space-y-4">
            {metas.map((m) => {
              const porcentaje = Math.min(100, Math.round((m.monto_actual / m.monto_objetivo) * 100));
              return (
                <div key={m.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-offwhite">{m.nombre}</span>
                    <span className="text-navy-400 font-mono text-xs">
                      {formatoCLP(m.monto_actual)} / {formatoCLP(m.monto_objetivo)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-navy-900 rounded-full overflow-hidden">
                    <div className="h-full bg-gold" style={{ width: `${porcentaje}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}