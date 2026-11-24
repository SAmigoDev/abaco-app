import { createClient } from '@/lib/supabase/client';

export async function enviarTransaccion(payload) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, status: 401, data: { error: 'Vuelve a iniciar sesión.' } };
  payload.evento_id ||= crypto.randomUUID();

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/transacciones`;
  let response;
  try { response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }); } catch { return { ok: false, status: 0, data: { error: 'No se pudo conectar. Reintenta con los mismos datos.' } }; }

  const data = await response.json().catch(() => ({}));
  if (response.status === 201) return { ok: true, status: 201, data: data.data };
  return { ok: false, status: response.status, data };
}
