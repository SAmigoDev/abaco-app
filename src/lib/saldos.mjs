export const SALDO_DESCONOCIDO = 'Sin saldo definido';

export function saldoNumerico(valor) {
  if (valor == null || (typeof valor === 'string' && !valor.trim())) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}
export function formatoSaldo(valor, moneda = 'CLP') {
  const numero = saldoNumerico(valor);
  return numero === null ? SALDO_DESCONOCIDO : new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda }).format(numero);
}
// Never publish a partial sum as a complete balance. Archived balances remain part of the total.
export function totalSaldos(cuentas) {
  const valores = cuentas.map(c => saldoNumerico(c.saldo_actual));
  return valores.some(v => v === null) ? null : valores.reduce((total, v) => total + v, 0);
}
export const cuentasActivas = cuentas => cuentas.filter(c => !c.archivado_at);
export function filaCuentaExportada(cuenta) {
  return { Alias: cuenta.alias, Tipo: cuenta.tipo_producto, Saldo_Actual: saldoNumerico(cuenta.saldo_actual) ?? SALDO_DESCONOCIDO,
    Cupo_Maximo: cuenta.cupo_maximo ?? '-', Moneda: cuenta.moneda, Estado: cuenta.archivado_at ? 'Archivada' : 'Activa', Archivada_El: cuenta.archivado_at ?? '' };
}
