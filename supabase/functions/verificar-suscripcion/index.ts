// ============================================================
// Edge Function: verificar-suscripcion (CON CORS)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// CORS Headers
// ============================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ============================================================
// Handler principal
// ============================================================
Deno.serve(async (req: Request) => {
  // 1. Manejar el preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validar método
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Método no permitido' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Obtener el usuario autenticado
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

    // 4. Consultar el estado de suscripción
    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select('estado_suscripcion, fecha_vencimiento, rol')
      .eq('id', user.id)
      .single();

    if (usuarioError || !usuario) {
      return new Response(JSON.stringify({ error: 'Usuario no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Verificar acceso
    const ahora = new Date();
    const fechaVencimiento = usuario.fecha_vencimiento ? new Date(usuario.fecha_vencimiento) : null;

    if (usuario.rol === 'tester' || usuario.rol === 'admin') {
      return new Response(JSON.stringify({
        acceso: true,
        mensaje: 'Usuario con rol especial (tester/admin)',
        estado_suscripcion: usuario.estado_suscripcion,
        rol: usuario.rol
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tieneAcceso = 
      usuario.estado_suscripcion === 'activa' && 
      (!fechaVencimiento || fechaVencimiento > ahora);

    return new Response(JSON.stringify({
      acceso: tieneAcceso,
      estado_suscripcion: usuario.estado_suscripcion,
      fecha_vencimiento: usuario.fecha_vencimiento,
      mensaje: tieneAcceso ? 'Acceso activo' : 'Suscripción vencida'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    console.error('Error en verificar-suscripcion:', errorObj);

    return new Response(JSON.stringify({ 
      error: 'Error interno del servidor',
      mensaje: errorObj.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});