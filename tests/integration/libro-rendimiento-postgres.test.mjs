import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { crearBaseLocal, literal } from './postgres-fixture.mjs';

const enabled = process.env.ABACO_SQL_TEST_ACK === 'synthetic-only' && process.env.ABACO_009_PERF_ACK === 'operational-history-only';
const stats = rows => {
  const values = rows.map(x => x.serverMs).sort((a, b) => a - b);
  return { samples: rows.map(({ serverMs, wallMs }) => ({ serverMs, wallMs })), medianMs: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2, p95Ms: values[Math.ceil(values.length * 0.95) - 1] };
};

test('009 historial operativo creciente: gasto real y reconstruccion local', { skip: !enabled }, async () => {
  const { sql, como, file, cerrar, conectar } = await crearBaseLocal();
  const initial = process.env.ABACO_009_PERF_PHASE === 'initial';
  const output = process.env.ABACO_009_PERF_RESULT_FILE || path.join(process.env.ABACO_TEST_PG_DATA, '..', '009-performance.json');
  const profiles = [
    { name: 'cash', user: '10000000-0000-4000-8000-000000000091', card: '20000000-0000-4000-8000-000000000091', session: '30000000-0000-4000-8000-000000000091', type: 'cuenta_corriente', initial: 1000000000, sign: -1 },
    { name: 'credit', user: '10000000-0000-4000-8000-000000000092', card: '20000000-0000-4000-8000-000000000092', session: '30000000-0000-4000-8000-000000000092', type: 'credito_nacional', initial: 0, sign: 1 },
  ];
  const result = { phase: initial ? 'initial-original' : 'matched-comparison', connections: initial ? 'new backend per sample' : 'independent reused backends; transaction per sample', synthetic: true, levels: [], environment: null, migrationSha256: null };
  const pool = [], operator = initial ? null : conectar();
  if (operator) pool.push(operator);
  const save = () => writeFile(output, JSON.stringify(result, null, 2) + '\n');
  try {
    const migration = await file('../../supabase/migrations/202611230009_escritor_financiero.sql');
    result.migrationSha256 = createHash('sha256').update(migration).digest('hex');
    await sql(migration);
    result.environment = JSON.parse(await sql("select json_build_object('postgres',version(),'sharedBuffers',current_setting('shared_buffers'),'workMem',current_setting('work_mem'),'maintenanceWorkMem',current_setting('maintenance_work_mem'),'maxConnections',current_setting('max_connections'))"));
    const sequence = (await sql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='libro_operaciones' and column_name='secuencia')")) === 't';
    for (const p of profiles) {
      await sql(`insert into auth.users(id,email,email_confirmed_at) values('${p.user}','bench009-${p.name}@abaco-test.invalid',now());insert into auth.sessions(id,user_id) values('${p.session}','${p.user}');insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${p.card}','${p.user}','BENCH009 SINTETICA','0000','${p.type}','CLP',${p.initial})`);
    }
    await sql(`select abaco_privado.activar_libro('${randomUUID()}','activar-libro-con-saldos-comprometidos')`);
    for (const p of profiles) p.opening = await sql(`select apertura_id from abaco_privado.libro_cuentas where tarjeta_id='${p.card}'`);
    if (!initial) for (const p of profiles) { p.connection = conectar(); pool.push(p.connection); }
    const optimized = initial ? null : migration.match(/create function abaco_privado\.escribir_proyeccion\([\s\S]*?\nend \$\$;/)[0].replace('create function', 'create or replace function');
    const baseline = initial ? null : await readFile(new URL('../fixtures/libro009-proyector-suma.sql', import.meta.url), 'utf8');
    const apply = method => initial ? Promise.resolve() : sql(method === 'sum' ? baseline : optimized);
    const count = p => sql(`select count(*) from libro_operaciones where apertura_id='${p.opening}' and tipo='gasto' and operativa`).then(Number);

    // Fixture generation is NOT business throughput. Only on the verified disposable database.
    // Pending receipts are bulk prepared, with publication disabled in the SAME transaction.
    // Balanced canonical operations/entries are then inserted and the real projector reconstructs.
    async function seed(p, target) {
      let current = await count(p);
      while (current < target) {
        const size = Math.min(10000, target - current);
        const seqColumn = sequence ? ',secuencia' : '', seqValue = sequence ? `,${current}+n+1` : '';
        await sql(`begin;set local statement_timeout='120s';create temp table bench009_seed on commit drop as select n,gen_random_uuid() as receipt,gen_random_uuid() as operation from generate_series(1,${size}) n;
          alter table transacciones disable trigger libro_contabilizar;
          insert into transacciones(id,usuario_id,tarjeta_id,monto_original,moneda_original,monto_clp,monto_cuenta,comercio,fecha,origen,evento_id,estado_revision)
          select receipt,'${p.user}','${p.card}',1,'CLP',1,null,'BENCH009 SINTETICO','2026-01-02T12:00:00Z','manual',gen_random_uuid(),'pendiente' from bench009_seed;
          update transacciones set estado_revision='confirmado',monto_cuenta=1 where id in(select receipt from bench009_seed);
          set constraints all immediate;
          alter table transacciones enable trigger libro_contabilizar;
          insert into libro_operaciones(id,usuario_id,apertura_id,tarjeta_id,tipo,transaccion_id,operativa${seqColumn}) select operation,'${p.user}','${p.opening}','${p.card}','gasto',receipt,true${seqValue} from bench009_seed order by n;
          insert into libro_apuntes(usuario_id,apertura_id,operacion_id,importe) select '${p.user}','${p.opening}',operation,${p.sign} from bench009_seed;commit;`);
        current += size;
      }
      assert.equal(await count(p), target);
    }
    async function measured(text, profile, connection = profile?.connection) {
      const start = performance.now();
      const body = `create temp table bench009_timing(ms numeric,pid integer) on commit drop;do $bench$ declare started timestamptz:=clock_timestamp();r record;begin ${text};insert into bench009_timing values(extract(epoch from clock_timestamp()-started)*1000,pg_backend_pid());end $bench$;select json_build_object('serverMs',ms,'pid',pid) from bench009_timing`;
      const raw = profile ? await como(body, { user: profile.user, session: profile.session }, connection?.query || sql) : await (operator?.query || sql)('begin;set local statement_timeout=\'120s\';' + body + ';commit;');
      return { ...JSON.parse(raw), wallMs: performance.now() - start };
    }
    const expense = (p, connection) => {
      const payload = { evento_id: randomUUID(), tarjetaId: p.card, monto: 1, moneda: 'CLP', comercio: 'BENCH009 MEDIDO', fecha: '2026-01-02T12:00:00Z', origen: 'manual' };
      return measured(`select * into r from public.registrar_gasto('${p.user}',${literal(JSON.stringify(payload))}::jsonb,null);if r.estado_revision<>'confirmado' then raise exception 'Gasto no confirmado';end if`, p, connection);
    };
    for (const target of [0, 1000, 10000, 100000]) {
      const seedStart = performance.now();
      for (const p of profiles) await seed(p, target);
      await sql('vacuum analyze transacciones;vacuum analyze libro_operaciones;vacuum analyze libro_apuntes');
      await sql("select abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes')");
      const level = { targetPerAccount: target, preparationWallMs: performance.now() - seedStart, methods: {} };
      const methods = initial ? ['original'] : ['sum', 'incremental', 'incremental', 'sum'];
      for (const method of methods) {
        await apply(method);
        const group = level.methods[method] ||= { expenses: {}, rebuild: [] };
        for (const p of profiles) {
          const entry = group.expenses[p.name] ||= { historiesBefore: [], raw: [] };
          entry.historiesBefore.push(await count(p));
          await expense(p); // warmup, excluded
          for (let n = 0; n < 5; n++) entry.raw.push(await expense(p));
        }
        if (!initial) await measured("perform abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes')");
        for (let n = 0; n < (initial ? 3 : 2); n++) group.rebuild.push(await measured("perform abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes')"));
      }
      for (const group of Object.values(level.methods)) {
        for (const entry of Object.values(group.expenses)) { entry.statistics = stats(entry.raw); delete entry.raw; }
        group.rebuild = stats(group.rebuild);
      }
      if (target === 100000) {
        level.concurrent = {};
        for (const method of initial ? ['original'] : ['sum', 'incremental']) {
          await apply(method);
          const connections = initial ? [] : Array.from({ length: 8 }, () => conectar());
          pool.push(...connections);
          if (!initial) for (const c of connections) await expense(profiles[0], c);
          const before = await count(profiles[0]), start = performance.now();
          const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => expense(profiles[0], connections[i])));
          assert.equal(new Set(rows.map(x => x.pid)).size, 8);
          assert.equal(await count(profiles[0]), before + 8);
          level.concurrent[method] = { ...stats(rows), historyBefore: before, wallMs: performance.now() - start, distinctConnections: 8 };
          await Promise.all(connections.map(c => c.close()));
        }
        if (sequence) {
          const summarize = node => ({ node: node['Node Type'], index: node['Index Name'], rows: node['Actual Rows'], loops: node['Actual Loops'], removed: node['Rows Removed by Filter'], sharedHit: node['Shared Hit Blocks'], sharedRead: node['Shared Read Blocks'], children: node.Plans?.map(summarize) });
          level.plans = {};
          for (const [name, query] of Object.entries({
            nextSequence: `select secuencia from libro_operaciones where apertura_id='${profiles[0].opening}' and operativa order by secuencia desc limit 1`,
            fullSum: `select sum(importe) from libro_apuntes where apertura_id='${profiles[0].opening}'`,
          })) {
            const [explain] = JSON.parse(await sql('set role abaco_financiero;explain(analyze,buffers,format json) ' + query));
            level.plans[name] = { executionMs: explain['Execution Time'], plan: summarize(explain.Plan) };
          }
        }
      }
      await apply('incremental');
      assert.equal(await sql('select abaco_privado.verificar_proyecciones()'), 't');
      for (const p of profiles) {
        const n = await count(p);
        assert.equal(await sql(`select saldo_actual::text from tarjetas where id='${p.card}'`), String(p.initial + p.sign * n));
      }
      result.levels.push(level); await save();
      console.log(`BENCH009 ${result.phase}: ${target} gastos iniciales por cuenta, invariantes correctas`);
    }
  } finally { await Promise.allSettled(pool.map(c => c.close())); await cerrar(); }
});
