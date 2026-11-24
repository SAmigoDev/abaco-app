import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { completarCallback } from '@/lib/auth/callbacks.mjs';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const path = await completarCallback(await createClient(), searchParams);
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
