function formatoCLP(n) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0);
}

function calcularCuotaActual(fechaPrimeraCuota, numCuotas) {
  const inicio = new Date(fechaPrimeraCuota);
  const hoy = new Date();
  const mesesTranscurridos = (hoy.getFullYear() - inicio.getFullYear()) * 12 + (hoy.getMonth() - inicio.getMonth());
  return Math.min(numCuotas, Math.max(1, mesesTranscurridos + 1));
}

function generarCalendario(fechaPrimeraCuota, numCuotas, montoCuota) {
  const inicio = new Date(fechaPrimeraCuota);
  const cuotaActual = calcularCuotaActual(fechaPrimeraCuota, numCuotas);
  const meses = [];

  for (let i = 0; i < numCuotas; i++) {
    const fecha = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    const numero = i + 1;
    meses.push({
      numero,
      montoCuota,
      mesLabel: fecha.toLocaleDateString('es-CL', { month: 'short', year: 'numeric' }),
      estado: numero < cuotaActual ? 'pagada' : numero === cuotaActual ? 'actual' : 'pendiente',
    });
  }
  return meses;
}

const ESTILOS_ESTADO = {
  pagada: 'bg-navy-900 border-navy-700 text-navy-400',
  actual: 'bg-gold border-gold text-navy-900',
  pendiente: 'bg-navy-800 border-navy-700 text-offwhite',
};

export default function MisCuotas({ compras }) {
  if (compras.length === 0) {
    return <p className="text-navy-400 text-sm">No tienes compras en cuotas registradas.</p>;
  }

  return (
    <div className="space-y-4">
      {compras.map((c) => {
        const cuotaActual = calcularCuotaActual(c.fecha_primera_cuota, c.num_cuotas);
        const terminada = cuotaActual >= c.num_cuotas && new Date() > new Date(
          new Date(c.fecha_primera_cuota).getFullYear(),
          new Date(c.fecha_primera_cuota).getMonth() + c.num_cuotas - 1,
          new Date(c.fecha_primera_cuota).getDate()
        );
        const calendario = generarCalendario(c.fecha_primera_cuota, c.num_cuotas, c.monto_cuota);

        return (
          <div key={c.id} className="bg-navy-800 border border-navy-700 rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-offwhite text-sm font-medium">{c.comercio}</p>
                <p className="text-navy-400 text-xs">
                  {formatoCLP(c.monto_cuota)} / mes {c.tasa_interes_mensual ? `· ${c.tasa_interes_mensual}% mensual` : ''}
                </p>
              </div>
              <span className={`text-xs font-mono ${terminada ? 'text-success' : 'text-navy-400'}`}>
                {terminada ? 'Pagada' : `Cuota ${cuotaActual} de ${c.num_cuotas}`}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {calendario.map((mes) => (
                <div
                  key={mes.numero}
                  className={`border rounded-lg px-2.5 py-2 text-center min-w-[72px] ${ESTILOS_ESTADO[mes.estado]}`}
                >
                  <p className="text-[10px] capitalize opacity-80">{mes.mesLabel}</p>
                  <p className="text-xs font-mono font-semibold">#{mes.numero}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}