import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { destinoAutenticado } from './rutas.mjs';

export async function sesionVerificada() {
  const supabase = await createClient();
  // Validates the JWT; never authorize from getSession() alone.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { supabase, estado: null };
  const seguridad = await supabase.rpc('estado_seguridad');
  return { supabase, estado: seguridad.error ? null : seguridad.data };
}

export async function exigirSesion(siguiente = '/') {
  const resultado = await sesionVerificada();
  const destino = destinoAutenticado(resultado.estado, siguiente);
  if (destino !== siguiente) redirect(destino);
  return resultado;
}
