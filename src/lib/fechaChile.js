// Convierte "dd/mm/yyyy HH:MM" (hora local de Chile) a ISO 8601 UTC,
// usando la zona horaria real America/Santiago (nunca un offset fijo,
// porque Chile alterna entre UTC-3 y UTC-4 por decreto).
export function convertirFechaChileAISO(fechaStr) {
  const [fecha, hora] = fechaStr.split(' ');
  const [dia, mes, anio] = fecha.split('/').map(Number);
  const [horas, minutos] = hora.split(':').map(Number);

  const naiveUTC = new Date(Date.UTC(anio, mes - 1, dia, horas, minutos));

  const formateador = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const partes = Object.fromEntries(
    formateador.formatToParts(naiveUTC).map((p) => [p.type, p.value])
  );
  const horaSantiagoComoUTC = new Date(Date.UTC(
    Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    Number(partes.hour) === 24 ? 0 : Number(partes.hour), Number(partes.minute)
  ));

  const offsetMs = naiveUTC.getTime() - horaSantiagoComoUTC.getTime();
  return new Date(naiveUTC.getTime() + offsetMs).toISOString();
}