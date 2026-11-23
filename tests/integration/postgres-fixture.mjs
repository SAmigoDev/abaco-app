import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const literal = value => "'" + String(value).replaceAll("'", "''") + "'";

// No .env, npm dependencies, link file or remote connection string is read here.
export async function crearBaseLocal({ authBootstrapUser } = {}) {
  assert.equal(process.env.ABACO_SQL_TEST_ACK, 'synthetic-only');
  const bin = process.env.ABACO_TEST_PG_BIN, data = process.env.ABACO_TEST_PG_DATA;
  const port = process.env.ABACO_TEST_PG_PORT;
  assert.ok(bin && data && /^5[0-9]{4}$/.test(port || ''));
  const database = 'abaco_it_' + randomUUID().replaceAll('-', '');
  assert.ok(!authBootstrapUser || authBootstrapUser === 'abaco_labroot');
  function sql(text, db = database, user = 'postgres') {
    return new Promise((resolve, reject) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG/i.test(k)));
      const child = spawn(path.join(bin, 'psql.exe'), ['-X', '-qAt', '-h', '127.0.0.1', '-p', port, '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1'], {
        windowsHide: true, env: { ...env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5', PGPASSFILE: path.join(data, 'abaco-no-passwords') },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || 'psql fallo')));
      child.stdin.end(text);
    });
  }
  const actual = (await sql('show data_directory', 'postgres', authBootstrapUser || 'postgres')).replaceAll('\\', '/');
  assert.equal((await realpath(actual)).toLowerCase(), (await realpath(data)).toLowerCase());
  assert.match(actual, /\/work\/staging-pg\/data$/i);
  await sql('create database ' + database, 'postgres');
  const file = relative => readFile(new URL(relative, import.meta.url), 'utf8');
  const cerrar = () => sql('drop database ' + database + ' with(force)', 'postgres');
  try {
    if (authBootstrapUser) {
      // Models provider-owned Auth/roles only; all public migrations run as NON-superuser postgres.
      await sql(await file('./local_auth.sql') + ';grant usage on schema auth to postgres;grant select,insert,update,delete,references,trigger on all tables in schema auth to postgres;grant anon,authenticated,service_role to postgres;', database, authBootstrapUser);
    } else await sql(await file('./local_auth.sql'));
    await sql("set abaco.staging_confirmed='empty-synthetic-only';" + await file('../../supabase/staging/00_base_public.sql'));
    await sql(await file('../../supabase/tests/auditoria_previa.sql'));
    for (const name of ['202611130001_usuarios_permisos.sql', '202611130002_registro_atajos.sql', '202611130003_revision_gastos.sql', '202611130004_auth_mfa.sql', '202611190005_instrumentos_vinculos.sql', '202611190006_alias_captura.sql', '202611220007_edicion_cuentas.sql', '202611220008_libro_ensayo.sql']) {
      await sql(await file('../../supabase/migrations/' + name));
    }
    await sql(await file('../../supabase/tests/auditoria_auth_mfa.sql'));
    await sql(await file('../../supabase/tests/auditoria_multitarjeta.sql'));
  } catch (error) { await cerrar(); throw error; }
  const como = (text, { user, role = 'authenticated', aal = 'aal1', session } = {}, ejecutar = sql) => {
    assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
    return ejecutar(`begin;set local role ${role};set local "request.jwt.claims"=${literal(JSON.stringify({ sub: user, role, aal, session_id: session }))};${text};commit;`);
  };
  const esperar = async text => {
    for (let n = 0; n < 25; n++) {
      if (Number(await sql(text)) > 0) return;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('No se observo el bloqueo esperado');
  };
  function conectar() {
    // Reusable independent backend for pool-like measurements. Same verified database/loopback.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG/i.test(k)));
    const child = spawn(path.join(bin, 'psql.exe'), ['-X', '-qAt', '-P', 'pager=off', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], {
      windowsHide: true, env: { ...env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5', PGPASSFILE: path.join(data, 'abaco-no-passwords') }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', errors = '', pending, ended = false, queue = Promise.resolve();
    const finished = new Promise(resolve => {
      child.on('error', error => { ended = true; pending?.reject(error); pending = null; resolve({ error }); });
      child.on('close', code => { ended = true; pending?.reject(new Error(errors || 'Conexion psql cerrada')); pending = null; resolve({ code }); });
    });
    child.stdout.on('data', b => {
      output += b;
      if (pending) {
        const at = output.indexOf(pending.marker);
        if (at >= 0) { const result = output.slice(0, at).trim(); output = output.slice(at + pending.marker.length).trimStart(); const resolve = pending.resolve; pending = null; resolve(result); }
      }
    });
    child.stderr.on('data', b => errors += b);
    child.stdin.on('error', error => { pending?.reject(error); pending = null; });
    const query = text => {
      const result = queue.then(() => new Promise((resolve, reject) => {
        if (ended) { reject(new Error('Conexion local finalizada')); return; }
        errors = ''; const marker = 'ABACO_DONE_' + randomUUID().replaceAll('-', ''); pending = { marker, resolve, reject };
        child.stdin.write(text + ';\n\\echo ' + marker + '\n');
      }));
      queue = result.catch(() => {}); return result;
    };
    const close = async () => { await queue; if (!ended) child.stdin.end(); const result = await finished; if (result.error || result.code !== 0) throw result.error || new Error('psql termino con error'); };
    return { query, close };
  }
  return { sql, como, file, cerrar, esperar, conectar };
}
