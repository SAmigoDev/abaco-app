// ============================================================
// Edge Function: transacciones (CON CORS)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// Configuración del cliente Supabase
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

const MINDICADOR_API_URL = Deno.env.get('MINDICADOR_API_URL') || 'https://mindicador.cl/api';

// ============================================================
// CORS Headers
// ============================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Para desarrollo. En producción, restringir a dominio específico
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ============================================================
// Handler principal
// ============================================================
Deno.serve(async (req: Request) => {
  // 1. Manejar el preflight (OPTIONS) ANTES de cualquier otra lógica
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validar método
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Método no permitido' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Obtener el usuario autenticado (desde el JWT)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Token de autenticación requerido' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Usuario no autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Obtener el cuerpo de la solicitud
    const body = await req.json();
    
    // 5. Validar campos obligatorios
    // ✅ CORREGIDO: Usar 'let' en lugar de 'const' para poder reasignar tarjetaId
    let { 
      tarjetaId, 
      monto, 
      moneda, 
      comercio, 
      fecha, 
      origen,
      categoriaId,
      autorizacionLineaCredito = false 
    } = body;

    if (!tarjetaId || !monto || !moneda || !comercio || !fecha) {
      return new Response(JSON.stringify({ 
        error: 'Faltan campos obligatorios: tarjetaId, monto, moneda, comercio, fecha' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Verificar que la tarjeta pertenece al usuario
    const { data: tarjeta, error: tarjetaError } = await supabase
      .from('tarjetas')
      .select('*')
      .eq('id', tarjetaId)
      .eq('usuario_id', user.id)
      .single();

    if (tarjetaError || !tarjeta) {
      return new Response(JSON.stringify({ error: 'Tarjeta no encontrada o no pertenece al usuario' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Prevención de duplicados (5 minutos, mismo monto y comercio)
    const fechaLimite = new Date(new Date(fecha).getTime() - 5 * 60 * 1000);
    
    const { data: duplicados, error: duplicadosError } = await supabase
      .from('transacciones')
      .select('id')
      .eq('usuario_id', user.id)
      .eq('monto_original', monto)
      .eq('comercio', comercio)
      .gte('fecha', fechaLimite.toISOString())
      .lte('fecha', new Date(fecha).toISOString());

    if (duplicados && duplicados.length > 0) {
      return new Response(JSON.stringify({
        duplicadoDetectado: true,
        transaccionExistenteId: duplicados[0].id,
        mensaje: 'Ya existe una transacción similar en los últimos 5 minutos.'
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Lógica de Línea de Crédito
    if (tarjeta.tipo_producto === 'cuenta_corriente') {
      const nuevoSaldo = Number(tarjeta.saldo_actual) - Number(monto);
      
      // Si el saldo es insuficiente y la autorización NO está confirmada
      if (nuevoSaldo < 0 && !autorizacionLineaCredito) {
        return new Response(JSON.stringify({
          requiereAutorizacion: true,
          saldoDisponibleCC: tarjeta.saldo_actual,
          montoGasto: monto,
          mensajeUsuario: 'Tu cuenta corriente está en negativo. ¿Deseas cubrir este gasto con tu Línea de Crédito? (Esto genera intereses)'
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Si el saldo es insuficiente y la autorización ESTÁ confirmada
      if (nuevoSaldo < 0 && autorizacionLineaCredito) {
        // Buscar la línea de crédito asociada a esta cuenta
        const { data: lineaCredito, error: lineaError } = await supabase
          .from('tarjetas')
          .select('*')
          .eq('usuario_id', user.id)
          .eq('tipo_producto', 'linea_credito')
          .single();

        if (lineaError || !lineaCredito) {
          return new Response(JSON.stringify({ 
            error: 'No tienes una Línea de Crédito configurada para cubrir este gasto.' 
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Verificar que la línea de crédito tenga suficiente cupo disponible
        const disponibleLinea = Number(lineaCredito.cupo_maximo) - Number(lineaCredito.saldo_actual);
        if (disponibleLinea < Number(monto)) {
          return new Response(JSON.stringify({
            error: `No tienes suficiente cupo disponible en tu Línea de Crédito. Disponible: $${disponibleLinea.toFixed(0)}`
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // ✅ CAMBIO CLAVE: En lugar de actualizar manualmente, cambiar la tarjeta destino a la línea de crédito
        // La transacción se registrará con la línea de crédito como destino
        tarjetaId = lineaCredito.id;  // <--- REASIGNACIÓN DE tarjetaId
        // NOTA: La variable 'tarjetaId' se usará en el INSERT de la transacción
      }
    }

    // 9. Conversión de divisas (USD → CLP) con fallback a tasas_cambio
    let montoClp = Number(monto);
    let monedaOriginal = moneda;
    let fuenteValor = 'mindicador';

    if (moneda === 'USD') {
      let valorDolar: number | null = null;

      try {
        // Intentar consultar Mindicador.cl
        const response = await fetch(`${MINDICADOR_API_URL}/dolar`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.serie && data.serie.length > 0) {
            valorDolar = data.serie[0].valor;
          }
        }
      } catch (error) {
        console.warn('Mindicador no disponible, usando fallback de tasas_cambio:', error);
      }

      // Si Mindicador no responde, usar el último valor de tasas_cambio
      if (valorDolar === null || valorDolar === undefined) {
        const { data: tasaData, error: tasaError } = await supabase
          .from('tasas_cambio')
          .select('valor')
          .eq('moneda', 'USD')
          .single();

        if (tasaError || !tasaData) {
          throw new Error('No se pudo obtener el valor del dólar ni desde Mindicador ni desde tasas_cambio');
        }

        valorDolar = Number(tasaData.valor);
        fuenteValor = 'cache';
        console.info(`Usando valor de USD desde tasas_cambio: $${valorDolar}`);
      }

      montoClp = Number(monto) * valorDolar;
      montoClp = Math.round(montoClp * 100) / 100;

      // Registrar en logs qué fuente se usó (opcional)
      await supabase
        .from('logs')
        .insert({
          nivel: 'info',
          evento: 'conversion_divisa',
          detalle: {
            moneda: 'USD',
            valor_usado: valorDolar,
            fuente: fuenteValor,
            monto_original: monto,
            monto_clp: montoClp
          }
        });
    }

    // 10. Insertar la transacción (con tarjetaId ya actualizado si se usó línea de crédito)
    const { data: transaccion, error: transaccionError } = await supabase
      .from('transacciones')
      .insert({
        usuario_id: user.id,
        tarjeta_id: tarjetaId,  // Puede ser la cuenta corriente original o la línea de crédito
        categoria_id: categoriaId || null,
        monto_original: monto,
        moneda_original: monedaOriginal,
        monto_clp: montoClp,
        comercio: comercio,
        fecha: fecha,
        origen: origen || 'regex_sms',
        sincronizado: true,
        intentos_sync: 0
      })
      .select()
      .single();

    if (transaccionError) {
      console.error('Error al insertar transacción:', transaccionError);
      return new Response(JSON.stringify({ error: 'Error al guardar la transacción' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 11. Registrar en logs
    await supabase
      .from('logs')
      .insert({
        nivel: 'info',
        evento: 'transaccion_creada',
        detalle: {
          usuario_id: user.id,
          transaccion_id: transaccion.id,
          monto: monto,
          moneda: monedaOriginal,
          comercio: comercio
        }
      });

    // 12. Devolver la transacción creada
    return new Response(JSON.stringify({
      success: true,
      data: transaccion,
      mensaje: 'Transacción creada exitosamente'
    }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // Manejo seguro del error
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    console.error('Error en transacciones:', errorObj);
    
    try {
      await supabase
        .from('logs')
        .insert({
          nivel: 'error',
          evento: 'transacciones_error',
          detalle: {
            mensaje: errorObj.message,
            stack: errorObj.stack || 'No stack disponible'
          }
        });
    } catch (logError) {
      // Si falla el log, al menos no rompe la función
      console.error('Error al guardar log:', logError);
    }

    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});