const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const idCuentaValido = valor => typeof valor === 'string' && uuid.test(valor);
export function cursorHistorial(params) {
  const fecha = params?.antes, id = params?.id;
  if (typeof fecha !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(fecha) || !Number.isFinite(Date.parse(fecha)) || !idCuentaValido(id)) return null;
  return { fecha, id };
}
