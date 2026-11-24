import { destinoSeguro, destinoAutenticado } from './rutas.mjs';

export async function completarCallback(supabase, params, modo = 'pkce') {
  const fallo = '/login?error=auth';
  try {
    if (modo === 'pkce') {
      const code = params.get('code');
      if (!code || code.length > 2048) return fallo;
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return fallo;
    } else {
      const token_hash = params.get('token_hash');
      const type = params.get('type');
      if (!token_hash || token_hash.length > 2048 || !['email', 'signup', 'magiclink', 'recovery'].includes(type)) return fallo;
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });
      if (error) return fallo;
    }
    const { data, error } = await supabase.rpc('estado_seguridad');
    if (error) return '/login?error=seguridad';
    const siguiente = modo !== 'pkce' && params.get('type') === 'recovery' ? '/auth/actualizar-clave' : destinoSeguro(params.get('next'));
    return destinoAutenticado(data, siguiente);
  } catch { return fallo; }
}
