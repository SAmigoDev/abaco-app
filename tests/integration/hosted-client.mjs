import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { STAGING_REF, STAGING_URL, validarWorkspaceStaging } from './staging-target.mjs';

function* objetos(value) {
  if (!value || typeof value !== 'object') return;
  yield value;
  for (const child of Object.values(value)) yield* objetos(child);
}
export async function contextoAlojado() {
  if (process.env.ABACO_HOSTED_TEST_ACK !== `${STAGING_REF}:synthetic-only`) throw new Error('Falta confirmación del staging aislado');
  const workdir = process.env.ABACO_STAGING_WORKDIR;
  await validarWorkspaceStaging(workdir);
  const raw = JSON.parse(await readFile(process.env.ABACO_STAGING_KEYS_FILE, 'utf8'));
  const key = name => {
    for (const row of objetos(raw)) {
      if (row.name !== name) continue;
      const value = row.api_key || row.key;
      if (typeof value !== 'string' || value.includes('*')) continue;
      if (value.split('.').length === 3) {
        const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
        if (claims.ref && claims.ref !== STAGING_REF) throw new Error('Clave de otro proyecto rechazada');
      }
      return value;
    }
    throw new Error('Falta una clave de staging requerida; no se imprime su contenido');
  };
  const anon = key('anon'), service = key('service_role');
  const nuevo = () => createClient(STAGING_URL, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const admin = createClient(STAGING_URL, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = async texto => {
    await validarWorkspaceStaging(workdir);
    const token = (await readFile(path.join(process.env.ABACO_STAGING_HOME, 'access-token'), 'utf8')).trim();
    const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: texto }),
    });
    const raw = await response.text();
    if (!response.ok) {
      await writeFile(path.join(workdir, 'ultimo-error-sql-private.txt'), raw, { mode: 0o600 });
      throw new Error(`SQL de staging fall? (HTTP ${response.status}); salida retenida localmente`);
    }
    return JSON.parse(raw);
  };
  const solicitar = (ruta, init = {}) => {
    if (!ruta.startsWith('/functions/v1/') && !ruta.startsWith('/rest/v1/')) throw new Error('Ruta de prueba no admitida');
    return fetch(STAGING_URL + ruta, { ...init, redirect: 'error', headers: { apikey: anon, ...init.headers } });
  };
  return { admin, nuevo, sql, solicitar };
}
