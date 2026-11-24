import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { destinoAutenticado } from '@/lib/auth/rutas.mjs';

const publicas = new Set(['/login', '/auth/callback', '/auth/confirm', '/offline.html']);
export async function proxy(request) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const mover = (destino) => {
    const result = NextResponse.redirect(new URL(destino, request.url));
    response.cookies.getAll().forEach(cookie => result.cookies.set(cookie));
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  };
  // No broad /auth* or /login* exemptions. Callbacks sanitize their own destination.
  if (publicas.has(path)) { response.headers.set('Cache-Control', 'private, no-store'); return response; }
  if (error || !data?.claims?.sub) return mover(`/login?next=${encodeURIComponent(path)}`);
  // MFA bootstrap is reachable with AAL1, never app data or SyncManager.
  if (path === '/auth/mfa') { response.headers.set('Cache-Control', 'private, no-store'); return response; }
  const seguridad = await supabase.rpc('estado_seguridad');
  if (seguridad.error) return mover('/login?error=seguridad');
  const destino = destinoAutenticado(seguridad.data, path);
  if (destino !== path) return mover(destino);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)'],
};
