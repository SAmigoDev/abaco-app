import { createClient } from '@/lib/supabase/client';
import { obtenerCacheRegex, sincronizarCacheRegex } from '@/lib/indexedDb';
import { convertirFechaChileAISO } from '@/lib/fechaChile';

export async function parseTexto(textoPegado) {
  const supabase = createClient();

  async function obtenerVersionRemota() {
    const { data, error } = await supabase.rpc('version_global_regex_rules');
    if (error) throw error;
    return data;
  }

  async function obtenerReglasRemotas() {
    const { data, error } = await supabase
      .from('regex_rules')
      .select('id, banco_o_plataforma, tipo_fuente, patron, version')
      .eq('activa', true);
    if (error) throw error;
    return data;
  }

  let reglas = [];
  try {
    const resultado = await sincronizarCacheRegex(obtenerVersionRemota, obtenerReglasRemotas);
    reglas = resultado.reglas;
  } catch {
    const cache = await obtenerCacheRegex().catch(() => null);
    reglas = cache?.reglas || [];
  }

  for (const regla of reglas) {
    try {
      const regex = new RegExp(regla.patron, 'i');
      const match = textoPegado.match(regex);
      if (match?.groups?.monto) {
        const fechaISO = match.groups.fecha
          ? convertirFechaChileAISO(match.groups.fecha)
          : new Date().toISOString();

        return {
          exito: true,
          monto: Number(match.groups.monto.replace(/\./g, '').replace(',', '.')),
          comercio: match.groups.comercio?.trim() || null,
          fecha: fechaISO,
          moneda: 'CLP',
          fuenteDetectada: regla.tipo_fuente,
          ultimosDigitos: match.groups.ultimos4 || null,
        };
      }
    } catch {
      continue;
    }
  }

  return { exito: false, monto: null, comercio: null, fecha: null, moneda: null, fuenteDetectada: null, ultimosDigitos: null };
}