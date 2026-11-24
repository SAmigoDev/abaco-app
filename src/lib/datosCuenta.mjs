import { saldoNumerico } from './saldos.mjs';

// Explicit payloads: never spread a snapshot of an existing account into UPDATE.
export function datosCuenta(form, edicion = false) {
  const credito = ['credito_nacional', 'credito_internacional', 'linea_credito'].includes(form.tipo_producto);
  const facturacion = ['credito_nacional', 'credito_internacional'].includes(form.tipo_producto);
  const datos = {
    alias: form.alias, ultimos_digitos: form.ultimos_digitos,
    tipo_producto: form.tipo_producto, moneda: form.moneda,
    cupo_maximo: credito ? Number(form.cupo_maximo) || null : null,
    dia_corte: facturacion ? Number(form.dia_corte) || null : null,
    dia_pago: facturacion ? Number(form.dia_pago) || null : null,
  };
  if (!edicion) datos.saldo_actual = saldoNumerico(form.saldo_actual);
  return datos;
}
