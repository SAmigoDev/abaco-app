import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSesion } from '@/lib/auth/server';
import { formatoSaldo } from '@/lib/saldos.mjs';
import { cursorHistorial, idCuentaValido } from '@/lib/historialCuenta.mjs';
import MovimientosPanel from '@/components/MovimientosPanel';

export default async function HistorialCuenta({ params, searchParams }) {
  const { id } = await params;
  if (!idCuentaValido(id)) notFound();
  const ruta = '/cuentas/' + id;
  const { supabase } = await exigirSesion(ruta);
  const { data: cuenta, error } = await supabase.from('tarjetas').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar la cuenta.');
  if (!cuenta) notFound(); // Auth + MFA + owner RLS, never a service key.
  const cursor = cursorHistorial(await searchParams);
  let query = supabase.from('transacciones').select('id,tarjeta_id,monto_original,moneda_original,monto_clp,comercio,fecha,origen,estado_revision,motivo_revision,categoria_id,categorias(nombre,icono)').eq('tarjeta_id', id).order('fecha', { ascending: false }).order('id', { ascending: false }).limit(31);
  if (cursor) query = query.or('fecha.lt.' + cursor.fecha + ',and(fecha.eq.' + cursor.fecha + ',id.lt.' + cursor.id + ')');
  const { data, error: errorMovimientos } = await query;
  if (errorMovimientos) throw new Error('No se pudo consultar el historial.');
  const filas = data || [], visibles = filas.slice(0, 30), ultimo = visibles.at(-1);
  return <main className="max-w-5xl mx-auto px-4 py-8"><Link href="/configuracion" className="text-gold underline">Volver a Configuración</Link><h1 className="text-2xl mt-5">{cuenta.alias}</h1><p className="my-3">{formatoSaldo(cuenta.saldo_actual, cuenta.moneda)} · {cuenta.moneda} · {cuenta.archivado_at ? 'Archivada' : 'Activa'}</p>{cuenta.archivado_at && <p className="text-navy-400 text-sm mb-5">Conserva sus movimientos y permite resolver pendientes previos; no admite nuevas capturas.</p>}<MovimientosPanel key={cursor ? cursor.fecha + cursor.id : 'inicio'} transacciones={visibles} tarjetas={[cuenta]} /><nav aria-label="Paginación del historial" className="flex gap-5">{cursor && <Link href={ruta} className="text-gold underline">Más recientes</Link>}{filas.length > 30 && <Link href={{ pathname: ruta, query: { antes: ultimo.fecha, id: ultimo.id } }} className="text-gold underline">Movimientos más antiguos</Link>}</nav></main>;
}
