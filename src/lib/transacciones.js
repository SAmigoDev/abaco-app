import { createClient } from '@/lib/supabase/client';

export async function enviarTransaccion(payload) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/transacciones`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 201) return { ok: true, status: 201, data: data.data };
  return { ok: false, status: response.status, data };
}