// Exact app destinations, never arbitrary URLs or callback/login loops.
const historialCuenta = /^\/cuentas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const destinos = new Set(['/', '/registrar', '/configuracion', '/auth/actualizar-clave']);
export function destinoSeguro(value) {
  return typeof value === 'string' && (destinos.has(value) || historialCuenta.test(value)) ? value : '/';
}

export function destinoAutenticado(estado, siguiente = '/') {
  const next = destinoSeguro(siguiente);
  if (!estado?.autenticado) return '/login';
  if (!estado.correo_confirmado) return '/login?mensaje=confirma';
  if (!estado.permitido && estado.requiere_mfa) return `/auth/mfa?next=${encodeURIComponent(next)}`;
  if (!estado.permitido) return '/login?error=seguridad';
  return next;
}
