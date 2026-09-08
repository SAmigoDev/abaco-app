// ============================================================
// Edge Function: cron-divisas
// Descripción: Cron diario (1:00 AM) que actualiza la tabla
// tasas_cambio con los valores de Mindicador.cl
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

const MINDICADOR_API_URL = Deno.env.get('MINDICADOR_API_URL') || 'https://mindicador.cl/api';

// ============================================================
// Handler principal
// ============================================================
Deno.serve(async (req: Request) => {
  try {
    console.log('🔄 Iniciando actualización de tasas de cambio...');

    // 1. Obtener datos de Mindicador
    const response = await fetch(MINDICADOR_API_URL);
    
    if (!response.ok) {
      throw new Error(`Error al consultar Mindicador: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // 2. Extraer valores de las monedas
    const monedas = [
      { codigo: 'USD', valor: data.dolar?.valor || null },
      { codigo: 'EUR', valor: data.euro?.valor || null },
      { codigo: 'UF', valor: data.uf?.valor || null }
    ];

    // 3. Actualizar cada moneda en la tabla tasas_cambio
    let actualizados = 0;
    for (const moneda of monedas) {
      if (moneda.valor === null) {
        console.warn(`⚠️ No se pudo obtener el valor de ${moneda.codigo}`);
        continue;
      }

      const { error } = await supabase
        .from('tasas_cambio')
        .upsert({
          moneda: moneda.codigo,
          valor: moneda.valor,
          fecha_actualizacion: new Date().toISOString()
        }, {
          onConflict: 'moneda'
        });

      if (error) {
        console.error(`❌ Error al actualizar ${moneda.codigo}:`, error);
      } else {
        actualizados++;
        console.log(`✅ ${moneda.codigo}: $${moneda.valor}`);
      }
    }

    // 4. Registrar en logs
    await supabase
      .from('logs')
      .insert({
        nivel: 'info',
        evento: 'cron_divisas_ejecutado',
        detalle: {
          monedas_actualizadas: actualizados,
          fecha: new Date().toISOString()
        }
      });

    console.log(`✅ Cron de divisas completado. ${actualizados} monedas actualizadas.`);

    return new Response(JSON.stringify({
      success: true,
      mensaje: `Cron de divisas ejecutado correctamente. ${actualizados} monedas actualizadas.`,
      monedas_actualizadas: actualizados,
      fecha: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error en cron-divisas:', error);

    // Registrar error en logs
    await supabase
      .from('logs')
      .insert({
        nivel: 'error',
        evento: 'cron_divisas_error',
        detalle: {
          mensaje: error.message,
          stack: error.stack
        }
      });

    return new Response(JSON.stringify({
      success: false,
      error: 'Error al actualizar las tasas de cambio'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});