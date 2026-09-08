'use client';

import { useState } from 'react';

function formatoCLP(n) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0);
}

// Resuelve la tasa mensual implícita con bisección sobre la fórmula de anualidad:
// precioContado = valorCuota * (1 - (1+r)^-n) / r
function calcularTasaImplicita(precioContado, valorCuota, numCuotas) {
  if (valorCuota * numCuotas <= precioContado) return 0;

  function valorPresente(r) {
    if (r === 0) return valorCuota * numCuotas;
    return (valorCuota * (1 - Math.pow(1 + r, -numCuotas))) / r;
  }

  let lo = 0;
  let hi = 1; // hasta 100% mensual, rango amplio y seguro
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (valorPresente(mid) > precioContado) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function evaluarTasa(tasaMensualPorcentaje) {
  if (tasaMensualPorcentaje <= 0) {
    return { color: 'text-success', texto: 'Sin interés (o con descuento) — esta cuota te sale igual o más barata que el contado.' };
  }
  if (tasaMensualPorcentaje < 1.5) {
    return { color: 'text-success', texto: 'Es una tasa relativamente baja.' };
  }
  if (tasaMensualPorcentaje < 3) {
    return { color: 'text-gold', texto: 'Es una tasa moderada — común en el retail chileno.' };
  }
  return { color: 'text-danger', texto: 'Es una tasa alta. Si puedes pagar al contado, normalmente conviene más.' };
}

export default function SimuladorCuotas() {
  const [precioContado, setPrecioContado] = useState('');
  const [valorCuota, setValorCuota] = useState('');
  const [numCuotas, setNumCuotas] = useState('');
  const [conoceTasa, setConoceTasa] = useState(false);
  const [tasaDeclarada, setTasaDeclarada] = useState('');
  const [resultado, setResultado] = useState(null);

  function calcular(e) {
    e.preventDefault();

    const pc = Number(precioContado);
    const vc = Number(valorCuota);
    const n = Number(numCuotas);

    const costoTotalCredito = vc * n;
    const interesTotal = costoTotalCredito - pc;
    const recargoPorcentaje = pc > 0 ? (interesTotal / pc) * 100 : 0;

    const tasaMensual = conoceTasa
      ? Number(tasaDeclarada) / 100
      : calcularTasaImplicita(pc, vc, n);

    const tasaMensualPorcentaje = tasaMensual * 100;
    const caeAnualAprox = (Math.pow(1 + tasaMensual, 12) - 1) * 100;

    setResultado({
      costoTotalCredito,
      interesTotal,
      recargoPorcentaje,
      tasaMensualPorcentaje,
      caeAnualAprox,
      fuenteTasa: conoceTasa ? 'declarada por ti' : 'calculada a partir de los datos',
      evaluacion: evaluarTasa(tasaMensualPorcentaje),
    });
  }

  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-6">
      <p className="text-navy-400 text-xs mb-4">
        Compara el precio contado contra el valor de la cuota para saber cuánto interés real estás pagando.
      </p>

      <form onSubmit={calcular}>
        <label className="block text-navy-400 text-xs mb-1">Precio contado</label>
        <input required type="number" step="0.01" value={precioContado} onChange={(e) => setPrecioContado(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite font-mono text-sm mb-3 outline-none focus:border-gold" />

        <label className="block text-navy-400 text-xs mb-1">Valor de la cuota</label>
        <input required type="number" step="0.01" value={valorCuota} onChange={(e) => setValorCuota(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite font-mono text-sm mb-3 outline-none focus:border-gold" />

        <label className="block text-navy-400 text-xs mb-1">Número de cuotas</label>
        <input required type="number" min="1" value={numCuotas} onChange={(e) => setNumCuotas(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />

        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input type="checkbox" checked={conoceTasa} onChange={(e) => setConoceTasa(e.target.checked)} className="w-4 h-4 accent-gold" />
          <span className="text-navy-400 text-sm">Conozco el valor de la tasa de interés mensual declarada</span>
        </label>

        {conoceTasa && (
          <>
            <label className="block text-navy-400 text-xs mb-1">Tasa de interés mensual declarada (%)</label>
            <input required type="number" step="0.01" value={tasaDeclarada} onChange={(e) => setTasaDeclarada(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-navy-700 bg-navy-900 text-offwhite text-sm mb-3 outline-none focus:border-gold" />
          </>
        )}

        <button type="submit" className="w-full py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm mt-2">
          Calcular
        </button>
      </form>

      {resultado && (
        <div className="mt-6 pt-5 border-t border-navy-700">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-navy-400 text-xs">Costo total a crédito</p>
              <p className="font-mono text-offwhite text-sm">{formatoCLP(resultado.costoTotalCredito)}</p>
            </div>
            <div>
              <p className="text-navy-400 text-xs">Interés total pagado</p>
              <p className="font-mono text-danger text-sm">{formatoCLP(resultado.interesTotal)}</p>
            </div>
            <div>
              <p className="text-navy-400 text-xs">Recargo sobre el contado</p>
              <p className="font-mono text-offwhite text-sm">{resultado.recargoPorcentaje.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-navy-400 text-xs">Tasa mensual ({resultado.fuenteTasa})</p>
              <p className="font-mono text-offwhite text-sm">{resultado.tasaMensualPorcentaje.toFixed(2)}%</p>
            </div>
          </div>

          <p className="text-navy-400 text-xs mb-1">CAE anual aproximado: {resultado.caeAnualAprox.toFixed(1)}%</p>

          <p className={`text-sm font-medium mt-3 ${resultado.evaluacion.color}`}>
            {resultado.evaluacion.texto}
          </p>

          <p className="text-navy-400 text-xs mt-3 italic">
            Esto es una estimación informativa, no es asesoría financiera.
          </p>
        </div>
      )}
    </div>
  );
}