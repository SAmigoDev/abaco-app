import * as XLSX from 'xlsx';

export function exportarExcel({ transacciones, movimientosFijos, tarjetas, metas, mesLabel }) {
  const wb = XLSX.utils.book_new();

  const hojaGastos = transacciones.map((t) => ({
    Fecha: new Date(t.fecha).toLocaleDateString('es-CL'),
    Comercio: t.comercio,
    Categoría: t.categorias?.nombre || 'otros',
    Monto_CLP: t.monto_clp,
    Origen: t.origen,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaGastos), 'Gastos Puntuales');

  const hojaFijos = movimientosFijos.map((m) => ({
    Nombre: m.nombre,
    Tipo: m.tipo,
    Monto: m.monto,
    Moneda: m.moneda,
    Categoría: m.categorias?.nombre || '-',
    Tarjeta: m.tarjetas?.alias || '-',
    Día_Cobro: m.dia_cobro,
    Activo: m.activo ? 'Sí' : 'No',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaFijos), 'Ingresos y Egresos Fijos');

  const hojaTarjetas = tarjetas.map((t) => ({
    Alias: t.alias,
    Tipo: t.tipo_producto,
    Saldo_Actual: t.saldo_actual,
    Cupo_Maximo: t.cupo_maximo || '-',
    Moneda: t.moneda,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaTarjetas), 'Estado de Tarjetas');

  const hojaMetas = metas.map((m) => ({
    Nombre: m.nombre,
    Monto_Actual: m.monto_actual,
    Monto_Objetivo: m.monto_objetivo,
    Porcentaje: Math.round((m.monto_actual / m.monto_objetivo) * 100) + '%',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaMetas), 'Metas de Ahorro');

  XLSX.writeFile(wb, `Abaco_Reporte_${mesLabel}.xlsx`);
}