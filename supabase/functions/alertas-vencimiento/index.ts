// ============================================================
// Edge Function: alertas-vencimiento
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { Resend } from 'https://esm.sh/resend@2.0.0';

// --- Configuración (ámbito GLOBAL de la función) ---
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
// ✅ La instancia se crea en el ámbito global de la función
const resend = new Resend(resendApiKey);

const FROM_EMAIL = 'alertas@tu-dominio.com'; // ⚠️ CAMBIAR POR TU EMAIL VERIFICADO EN RESEND

// ============================================================
// Handler principal
// ============================================================
Deno.serve(async (req: Request) => {
  try {
    // 1. Verificar el secreto (opcional)
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret !== Deno.env.get('CRON_SECRET')) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    // 2. Calcular la fecha objetivo (hoy + 3 días)
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 3);
    const targetDay = targetDate.getDate();

    console.log(`Buscando tarjetas con dia_pago = ${targetDay} para la fecha ${targetDate.toISOString().split('T')[0]}`);

    // 3. Buscar tarjetas que vencen en 3 días
    const { data: tarjetas, error } = await supabase
      .from('tarjetas')
      .select('alias, dia_pago, usuario_id, usuarios(email, nombre)')
      .eq('dia_pago', targetDay)
      .not('usuario_id', 'is', null)
      .not('email', 'is', null);

    if (error) {
      console.error('Error al consultar tarjetas:', error);
      throw new Error('Error al consultar la base de datos');
    }

    if (!tarjetas || tarjetas.length === 0) {
      console.log('No hay tarjetas por vencer en 3 días.');
      return new Response(JSON.stringify({ success: true, mensaje: 'No hay tarjetas para alertar.' }), { status: 200 });
    }

    console.log(`Se encontraron ${tarjetas.length} tarjetas para alertar.`);

    // 4. Enviar un correo por cada tarjeta
    for (const tarjeta of tarjetas) {
      const usuario = tarjeta.usuarios;
      if (!usuario || !usuario.email) continue;

      const subject = `🔔 Recordatorio: Pago de tu tarjeta ${tarjeta.alias} vence en 3 días`;
      const htmlContent = `
        <h1>Hola ${usuario.nombre || ''},</h1>
        <p>Te recordamos que el pago de tu tarjeta <strong>${tarjeta.alias}</strong> vence en <strong>3 días</strong> (${targetDate.toLocaleDateString('es-CL')}).</p>
        <p>Por favor, revisa tus saldos y realiza el pago a tiempo para evitar intereses.</p>
        <p>Saludos,<br>El equipo de Ábaco</p>
      `;

      try {
        // ✅ Ahora 'resend' está definido en el ámbito global y es accesible aquí
        const { data, error: emailError } = await resend.emails.send({
          from: FROM_EMAIL,
          to: [usuario.email],
          subject: subject,
          html: htmlContent,
        });

        if (emailError) {
          console.error(`Error al enviar correo a ${usuario.email}:`, emailError);
          await supabase.from('logs').insert({
            nivel: 'error',
            evento: 'alerta_vencimiento_email_fallido',
            detalle: { usuario_id: tarjeta.usuario_id, email: usuario.email, error: emailError.message }
          });
        } else {
          console.log(`✅ Correo enviado a ${usuario.email} para la tarjeta ${tarjeta.alias}`);
          await supabase.from('logs').insert({
            nivel: 'info',
            evento: 'alerta_vencimiento_email_enviado',
            detalle: { usuario_id: tarjeta.usuario_id, email: usuario.email, tarjeta: tarjeta.alias }
          });
        }
      } catch (emailError) {
        console.error(`Error inesperado al enviar correo a ${usuario.email}:`, emailError);
      }
    }

    return new Response(JSON.stringify({ success: true, mensaje: 'Proceso completado.' }), { status: 200 });

  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    console.error('Error en alertas-vencimiento:', errorObj);
    return new Response(JSON.stringify({ error: 'Error interno del servidor', mensaje: errorObj.message }), {
      status: 500,
    });
  }
});