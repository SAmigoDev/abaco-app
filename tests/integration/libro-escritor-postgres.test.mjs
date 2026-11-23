import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearBaseLocal, literal } from './postgres-fixture.mjs';

test('009 escritor financiero unico y corte local sintetico', { skip: process.env.ABACO_SQL_TEST_ACK !== 'synthetic-only' }, async t => {
  const { sql, como, file, cerrar, esperar } = await crearBaseLocal();
  const uid = '10000000-0000-4000-8000-000000000001', otro = '10000000-0000-4000-8000-000000000002';
  const card = '20000000-0000-4000-8000-000000000001', credit = '20000000-0000-4000-8000-000000000002';
  const ajena = '20000000-0000-4000-8000-000000000003', unknown = '20000000-0000-4000-8000-000000000004';
  const sid = '30000000-0000-4000-8000-000000000001', sid2 = '30000000-0000-4000-8000-000000000002';
  const cut = randomUUID();
  const mine = (text, opts = {}) => como(text, { user: uid, session: sid, ...opts });
  const data = (extra = {}) => ({ evento_id: randomUUID(), tarjetaId: card, monto: 100, moneda: 'CLP', comercio: 'TEST009 SINTETICO', fecha: '2026-01-02T12:00:00Z', origen: 'manual', ...extra });
  const registrar = (p, opts) => mine(`select row_to_json(r) from registrar_gasto(${literal(opts?.user || uid)},${literal(JSON.stringify(p))}::jsonb,null) r`, opts).then(JSON.parse);
  const token = (p, hash, app) => como(`${app ? `set local application_name=${literal(app)};` : ''}select row_to_json(r) from registrar_gasto(null,${literal(JSON.stringify(p))}::jsonb,${literal(hash)}) r`, { role: 'service_role' }).then(JSON.parse);
  const saldo = async (id = card) => JSON.parse(await sql(`select coalesce(to_json(saldo_actual)::text,'null') from tarjetas where id='${id}'`));
  const count = table => sql('select count(*) from ' + table).then(Number);
  const verificar = () => sql('select abaco_privado.verificar_proyecciones()');
  const activar = () => sql(`select abaco_privado.activar_libro('${cut}','activar-libro-con-saldos-comprometidos')`);
  const confirmar = id => mine(`select confirmar_gasto_pendiente('${id}',100)`);
  let historical, pending, pendingAtCut, historicalToken, credential, replayPayload, replayId;
  const preV1 = data({ origen: 'atajo_manual', monto: 10 });
  try {
    await sql(`insert into auth.users(id,email,email_confirmed_at) values('${uid}','uno009@abaco-test.invalid',now()),('${otro}','dos009@abaco-test.invalid',now());
      insert into auth.sessions(id,user_id) values('${sid}','${uid}'),('${sid2}','${otro}');
      insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual,cupo_maximo) values
      ('${card}','${uid}','TEST009 Efectivo','0001','cuenta_corriente','CLP',10000,null),
      ('${credit}','${uid}','TEST009 Credito','0002','credito_nacional','CLP',0,100000),
      ('${ajena}','${otro}','TEST009 Ajena','0003','cuenta_corriente','CLP',10000,null),
      ('${unknown}','${uid}','TEST009 Desconocida','0004','cuenta_corriente','USD',null,null);
      insert into tasas_cambio(moneda,valor) values('USD',950);`);
    // A synthetic legacy confirmed row whose account amount was never recorded.
    // Pre-009 the old trigger handles INSERT only; this represents committed legacy history.
    await sql(`insert into transacciones(usuario_id,tarjeta_id,monto_original,moneda_original,monto_clp,comercio,fecha,origen,estado_revision)
      values('${uid}','${unknown}',1,'USD',950,'TEST009 Legacy desconocido',now(),'manual','pendiente');
      update transacciones set estado_revision='confirmado' where tarjeta_id='${unknown}';`);
    historical = await registrar(data({ monto: 1000 }));
    pending = await registrar(data({ monto: 20000 }));
    pendingAtCut = await registrar(data({ monto: 20001 }));
    credential = await mine(`select crear_integracion_atajo('${card}','${'a'.repeat(64)}')`);
    historicalToken = await token(preV1, 'a'.repeat(64));
    const rehearsal = await sql(`select abaco_privado.preparar_apertura_ensayo('${uid}','${card}','${randomUUID()}','ensayo-sin-activacion')`);
    const migration = await file('../../supabase/migrations/202611230009_escritor_financiero.sql');

    await t.test('instalacion NOWAIT rechaza lectores existentes sin instalar parcialmente', async () => {
      const holder = sql("begin;set local application_name='test009_ddl_holder';lock table tarjetas in access share mode;select pg_sleep(1.2);commit;");
      try {
        await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test009_ddl_holder' and wait_event='PgSleep'");
        await assert.rejects(sql(migration), /lock|bloque/i);
        assert.equal(await sql("select to_regclass('abaco_privado.libro_control') is null"), 't');
      } finally { await holder; }
    });

    await t.test('no se adopta un rol preexistente con funciones o vistas al conceder escritura de saldo', async () => {
      const roles = await sql("select count(*) from pg_roles where rolname='abaco_financiero'");
      const setup = "begin;do $$begin if not exists(select 1 from pg_roles where rolname='abaco_financiero') then create role abaco_financiero nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end $$;grant create on schema public to abaco_financiero;create function public.test009_owner_collision() returns integer language sql security definer set search_path='' as 'select 1';alter function public.test009_owner_collision() owner to abaco_financiero;";
      await assert.rejects(sql(setup + migration), /Rol financiero ya posee objetos/);
      assert.equal(await sql("select to_regprocedure('public.test009_owner_collision()') is null and to_regclass('abaco_privado.libro_control') is null"), 't');
      const view = "begin;do $$begin if not exists(select 1 from pg_roles where rolname='abaco_financiero') then create role abaco_financiero nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end $$;grant create on schema public to abaco_financiero;create view public.test009_view_collision as select saldo_actual from tarjetas;alter view public.test009_view_collision owner to abaco_financiero;grant select on public.test009_view_collision to public;";
      await assert.rejects(sql(view + migration), /Rol financiero ya posee objetos/);
      assert.equal(await sql("select to_regclass('public.test009_view_collision') is null and to_regclass('abaco_privado.libro_control') is null"), 't');
      assert.equal(await sql("select count(*) from pg_roles where rolname='abaco_financiero'"), roles);
      assert.equal(await saldo(), 8990);
    });

    await t.test('fallo DDL tardio restaura triggers, funciones, grants y expansiones anteriores', async () => {
      const before = await sql("select md5(pg_get_functiondef('abaco_privado.confirmar_gasto_pendiente(uuid,numeric)'::regprocedure))");
      const grants = await sql("select coalesce(string_agg(attname||':'||coalesce(attacl::text,''),';' order by attnum),'') from pg_attribute where attrelid='tarjetas'::regclass and attnum>0 and not attisdropped");
      const roles = await sql("select count(*) from pg_roles where rolname='abaco_financiero'");
      await sql('create table public.libro_saldos_calculados(marcador integer)');
      try {
        await assert.rejects(sql(migration), /already exists|ya existe/i);
        assert.equal(await sql("select to_regclass('abaco_privado.libro_control') is null and to_regclass('public.libro_proyecciones') is null"), 't');
        assert.equal(await sql("select count(*) from information_schema.columns where table_schema='public' and table_name='libro_operaciones' and column_name='operativa'"), '0');
        assert.equal(await sql("select md5(pg_get_functiondef('abaco_privado.confirmar_gasto_pendiente(uuid,numeric)'::regprocedure))"), before);
        assert.equal(await sql("select coalesce(string_agg(attname||':'||coalesce(attacl::text,''),';' order by attnum),'') from pg_attribute where attrelid='tarjetas'::regclass and attnum>0 and not attisdropped"), grants);
        assert.equal(await sql("select count(*) from pg_roles where rolname='abaco_financiero'"), roles);
        assert.equal(await sql("select count(*) from pg_trigger where tgrelid='transacciones'::regclass and tgname='trigger_actualizar_saldo_tarjeta'"), '1');
        assert.equal(await sql("select to_regprocedure('abaco_privado.escribir_proyeccion(uuid,numeric,uuid)') is null"), 't');
        assert.equal(await saldo(), 8990);
      } finally { await sql('drop table public.libro_saldos_calculados'); }
    });

    await sql(migration);
    await sql(await file('../../supabase/tests/auditoria_libro009.sql'));

    await t.test('instalacion no activa; solo el nuevo proyector escribe saldo, tambien antes del corte', async () => {
      assert.equal(await sql('select modo from abaco_privado.libro_control'), 'legacy');
      assert.equal(await count('abaco_privado.libro_cuentas'), 0);
      assert.equal(await saldo(), 8990);
      const writers = JSON.parse(await sql("select json_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','abaco_privado') and p.prokind='f' and p.prosrc ilike '%update public.tarjetas set saldo_actual=%'"));
      assert.deepEqual(writers, ['escribir_proyeccion']);
      assert.equal(await sql("select to_regprocedure('public.actualizar_saldo_tarjeta()') is null"), 't');
      const p = data({ monto: 10 }); const r = await registrar(p);
      assert.equal((await registrar(p)).id, r.id); assert.equal(await saldo(), 8980);
      assert.equal(await count('abaco_privado.libro_cuentas'), 0);
      await assert.rejects(sql(`update tarjetas set saldo_actual=123 where id='${card}'`), /exclusivo/);
    });

    await t.test('fallo parcial del corte revierte aperturas, proyecciones, modo y auditoria', async () => {
      const before = await count('libro_aperturas');
      await sql(`create function public.test009_fallo_corte() returns trigger language plpgsql as $$begin if new.tarjeta_id='${unknown}' then raise exception 'FALLO CORTE SINTETICO';end if;return new;end $$;
        create trigger test009_fallo_corte after insert on abaco_privado.libro_cuentas for each row execute function public.test009_fallo_corte();`);
      try { await assert.rejects(activar(), /FALLO CORTE/); } finally { await sql('drop trigger test009_fallo_corte on abaco_privado.libro_cuentas;drop function public.test009_fallo_corte()'); }
      assert.equal(await count('libro_aperturas'), before); assert.equal(await count('libro_proyecciones'), 0);
      assert.equal(await count('abaco_privado.libro_cuentas'), 0); assert.equal(await count('abaco_privado.libro_eventos_control'), 0);
      assert.equal(await sql('select modo from abaco_privado.libro_control'), 'legacy'); assert.equal(await saldo(), 8980);
    });

    await t.test('guion de corte solo admite base local confirmada y hace rollback integral', async () => {
      const script = await file('../../supabase/tests/ensayo_corte_libro009_local.sql'), before = await count('libro_aperturas');
      await assert.rejects(sql(script), /local sintetica/);
      await sql("set abaco.libro009_local='base-local-sintetica';" + script);
      assert.equal(await count('libro_aperturas'), before); assert.equal(await count('libro_proyecciones'), 0);
      assert.equal(await sql('select modo from abaco_privado.libro_control'), 'legacy');
      assert.equal(await count('abaco_privado.libro_eventos_control'), 0); assert.equal(await saldo(), 8980);
    });

    await t.test('corte espera commit anterior y bloquea nuevos escritores hasta publicar aperturas nuevas', async () => {
      const before = await saldo(); const p = data({ monto: 10 });
      const writer = mine(`set local application_name='test009_antes';select registrar_gasto('${uid}',${literal(JSON.stringify(p))}::jsonb,null);select confirmar_gasto_pendiente('${pendingAtCut.id}',100);select pg_sleep(1.2)`);
      await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test009_antes' and wait_event='PgSleep'");
      const cutting = sql(`begin;set local application_name='test009_corte';select abaco_privado.activar_libro('${cut}','activar-libro-con-saldos-comprometidos');select pg_sleep(1.2);commit;`);
      await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test009_corte' and cardinality(pg_blocking_pids(pid))>0");
      await writer;
      await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test009_corte' and wait_event='PgSleep'");
      const next = registrar(data({ monto: 10 })); await cutting; await next;
      assert.equal(await saldo(), before - 120); assert.equal(await verificar(), 't');
      const opening = JSON.parse(await sql(`select row_to_json(a) from libro_aperturas a join abaco_privado.libro_cuentas m on m.apertura_id=a.id where m.tarjeta_id='${card}'`));
      assert.notEqual(opening.id, rehearsal); assert.equal(opening.saldo_inicial, before - 110);
      assert.equal(await sql(`select count(*) from libro_historicos_incluidos where apertura_id='${opening.id}' and transaccion_id='${historical.id}'`), '1');
      assert.equal(await sql(`select count(*) from libro_historicos_incluidos where apertura_id='${opening.id}' and transaccion_id='${pendingAtCut.id}'`), '1');
      await confirmar(pendingAtCut.id); assert.equal(await saldo(), before - 120);
      const countBefore = await count('libro_aperturas'); assert.equal(await activar(), cut); assert.equal(await count('libro_aperturas'), countBefore);
      await assert.rejects(sql(`select abaco_privado.activar_libro('${randomUUID()}','activar-libro-con-saldos-comprometidos')`), /Ya existe/);
      assert.equal((await token(preV1, 'a'.repeat(64))).id, historicalToken.id); assert.equal(await saldo(), before - 120);
    });

    await t.test('ocho reintentos manuales: una recepcion, un apunte y una version', async () => {
      const before = await saldo(), prev = Number(await sql(`select version from libro_proyecciones where tarjeta_id='${card}'`));
      const p = data(); const rows = await Promise.all(Array.from({ length: 8 }, () => registrar(p)));
      replayPayload = p; replayId = rows[0].id;
      assert.equal(new Set(rows.map(r => r.id)).size, 1); assert.equal(await saldo(), before - 100);
      assert.equal(await sql(`select count(*) from libro_operaciones where transaccion_id='${rows[0].id}' and operativa`), '1');
      assert.equal(Number(await sql(`select version from libro_proyecciones where tarjeta_id='${card}'`)), prev + 1);
      assert.equal(await verificar(), 't');
    });

    await t.test('gastos distintos concurrentes en dos usuarios no pierden actualizaciones', async () => {
      const before = await saldo(), beforeOther = await saldo(ajena);
      const rows = await Promise.all([
        ...Array.from({ length: 6 }, () => registrar(data({ monto: 1 }))),
        ...Array.from({ length: 6 }, () => registrar(data({ tarjetaId: ajena, monto: 1 }), { user: otro, session: sid2 })),
      ]);
      assert.equal(new Set(rows.map(r => r.id)).size, 12); assert.equal(await saldo(), before - 6); assert.equal(await saldo(ajena), beforeOther - 6);
      assert.equal(await verificar(), 't');
    });

    await t.test('edicion descriptiva concurrente no impone un saldo obsoleto al proyector', async () => {
      const before = await saldo();
      await Promise.all([mine(`update tarjetas set alias='TEST009 Alias concurrente' where id='${card}'`), registrar(data({ monto: 1 }))]);
      assert.equal(await sql(`select alias from tarjetas where id='${card}'`), 'TEST009 Alias concurrente');
      assert.equal(await saldo(), before - 1); assert.equal(await verificar(), 't');
    });

    await t.test('pendiente heredado confirmado concurrentemente conserva ID y tiene un solo efecto', async () => {
      const before = await saldo(); await Promise.all(Array.from({ length: 8 }, () => confirmar(pending.id)));
      assert.equal(await saldo(), before - 100); assert.equal(await sql(`select count(*) from libro_operaciones where transaccion_id='${pending.id}' and operativa`), '1');
      assert.equal(await sql(`select estado_revision from transacciones where id='${pending.id}'`), 'confirmado');
      assert.equal(await verificar(), 't');
    });

    await t.test('v1/v2 mantienen identidades, destino inmutable, MFA de gestion y revocacion', async () => {
      const instrument = await mine("select crear_instrumento_pago('TEST009 Wallet','wallet')");
      const binding = await mine(`select crear_vinculo_captura('${instrument}','${card}')`);
      const cred2 = await mine(`select crear_credencial_vinculo('${binding}','${'b'.repeat(64)}')`);
      const before = await saldo();
      const wrong = data({ origen: 'apple_wallet', version: 2, binding_id: randomUUID() }); delete wrong.tarjetaId;
      await assert.rejects(token(wrong, 'b'.repeat(64)), /Vinculo/);
      assert.equal(await saldo(), before);
      for (const [hash, extra] of [['a'.repeat(64), {}], ['b'.repeat(64), { version: 2, binding_id: binding }]]) {
        const p = data({ origen: 'apple_wallet', monto: 10, ...extra }); delete p.tarjetaId;
        const rows = await Promise.all(Array.from({ length: 6 }, () => token(p, hash)));
        assert.equal(new Set(rows.map(r => r.id)).size, 1);
        assert.equal(await sql(`select count(*) from libro_operaciones where transaccion_id='${rows[0].id}' and operativa`), '1');
        if (extra.version) assert.equal(rows[0].vinculo_captura_id, binding);
      }
      assert.equal(await saldo(), before - 20);
      const pendingPayload = data({ origen: 'apple_wallet', monto: 1, moneda: 'USD', version: 2, binding_id: binding }); delete pendingPayload.tarjetaId;
      const pendingCapture = await token(pendingPayload, 'b'.repeat(64)); assert.equal(pendingCapture.estado_revision, 'pendiente');
      assert.equal(await saldo(), before - 20);
      await Promise.all(Array.from({ length: 6 }, () => confirmar(pendingCapture.id)));
      assert.equal((await token(pendingPayload, 'b'.repeat(64))).id, pendingCapture.id);
      assert.equal(await saldo(), before - 120);
      assert.equal(await sql(`select count(*) from libro_operaciones where transaccion_id='${pendingCapture.id}' and operativa`), '1');
      await mine(`select revocar_integracion_atajo('${credential}')`);
      await assert.rejects(token(preV1, 'a'.repeat(64)), /Credencial/);
      await mine(`select revocar_vinculo_captura('${binding}')`);
      const p = data({ origen: 'apple_wallet', monto: 10, version: 2, binding_id: binding }); delete p.tarjetaId;
      await assert.rejects(token(p, 'b'.repeat(64)), /Credencial/);
      assert.equal(await sql(`select revocado_at is not null from integraciones_atajos where id='${cred2}'`), 't');
      assert.equal(await verificar(), 't');
    });

    await t.test('credencial de otra cuenta fija propietario/destino y no se revoca desde otro usuario', async () => {
      const before = await saldo(), otherBefore = await saldo(ajena);
      const id = await mine(`select crear_integracion_atajo('${ajena}','${'d'.repeat(64)}')`, { user: otro, session: sid2 });
      const p = data({ origen: 'atajo_manual', monto: 10 }); // forged tarjetaId is ignored by v1
      const r = await token(p, 'd'.repeat(64)); assert.equal(r.tarjeta_id, ajena); assert.equal(r.usuario_id, otro);
      assert.equal(await saldo(), before); assert.equal(await saldo(ajena), otherBefore - 10);
      await mine(`select revocar_integracion_atajo('${id}')`);
      assert.equal((await token(p, 'd'.repeat(64))).id, r.id);
      await mine(`select revocar_integracion_atajo('${id}')`, { user: otro, session: sid2 });
      await assert.rejects(token(p, 'd'.repeat(64)), /Credencial/); assert.equal(await verificar(), 't');
    });

    await t.test('revocacion concurrente se confirma antes del envio en espera, sin nuevo gasto', async () => {
      const id = await mine(`select crear_integracion_atajo('${card}','${'f'.repeat(64)}')`);
      const before = await saldo(), receipts = await count('transacciones');
      const revoking = mine(`set local application_name='test009_revoca';select revocar_integracion_atajo('${id}');select pg_sleep(1.2)`);
      await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test009_revoca' and wait_event='PgSleep'");
      const attempt = token(data({ origen: 'atajo_manual' }), 'f'.repeat(64), 'test009_revocado_writer').then(row => ({ row }), error => ({ error }));
      await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test009_revocado_writer' and cardinality(pg_blocking_pids(pid))>0");
      await revoking; const result = await attempt; assert.match(result.error?.message || '', /Credencial/);
      assert.equal(await saldo(), before); assert.equal(await count('transacciones'), receipts); assert.equal(await verificar(), 't');
    });

    await t.test('cuotas cargan capital total una sola vez y fallar tras crear calendario revierte todo', async () => {
      const p = data({ tarjetaId: credit, monto: 300, numCuotas: 3, tasaCuotas: 0 }); const r = await registrar(p);
      assert.equal((await registrar(p)).id, r.id); assert.equal(await saldo(credit), 300); assert.equal(await count('compras_cuotas'), 1);
      const prev = await count('libro_operaciones'), receipts = await count('transacciones');
      await sql("create function public.test009_fallo_cuotas() returns trigger language plpgsql as $$begin raise exception 'FALLO CUOTAS SINTETICO';end $$;create trigger test009_fallo_cuotas after insert on compras_cuotas for each row execute function public.test009_fallo_cuotas()");
      try { await assert.rejects(registrar(data({ tarjetaId: credit, monto: 300, numCuotas: 3, tasaCuotas: 0 })), /FALLO CUOTAS/); }
      finally { await sql('drop trigger test009_fallo_cuotas on compras_cuotas;drop function public.test009_fallo_cuotas()'); }
      assert.equal(await saldo(credit), 300); assert.equal(await count('libro_operaciones'), prev); assert.equal(await count('transacciones'), receipts); assert.equal(await count('compras_cuotas'), 1);
      assert.equal(await verificar(), 't');
    });

    await t.test('altas posteriores tienen una apertura atomica; null no se transforma en cero', async () => {
      for (const initial of [5000, 0, -100, null]) {
        const id = randomUUID(); await mine(`insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${id}','${uid}','TEST009 Alta','0000','cuenta_corriente','CLP',${initial === null ? 'null' : initial})`);
        assert.equal(await saldo(id), initial); assert.equal(await sql(`select count(*) from abaco_privado.libro_cuentas where tarjeta_id='${id}'`), '1');
        assert.equal(await sql(`select fuente from libro_aperturas where id=(select apertura_id from abaco_privado.libro_cuentas where tarjeta_id='${id}')`), 'alta_cuenta_no_conciliada');
        const openings = await count('libro_aperturas');
        await assert.rejects(mine(`insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${id}','${uid}','TEST009 Repetida','0000','cuenta_corriente','CLP',1)`), /duplicate key|duplicada/i);
        assert.equal(await count('libro_aperturas'), openings);
      }
      const r = await registrar(data({ tarjetaId: unknown, moneda: 'USD', monto: 1 })); assert.equal(r.estado_revision, 'pendiente');
      await confirmar(r.id); assert.equal(await saldo(unknown), null);
      assert.equal(await sql(`select saldo is null from libro_proyecciones where tarjeta_id='${unknown}'`), 't');
      assert.equal(await sql(`select count(*) from libro_operaciones where transaccion_id='${r.id}' and operativa`), '1'); assert.equal(await verificar(), 't');
      const precise = randomUUID();
      await mine(`insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${precise}','${uid}','TEST009 Precision','0000','cuenta_corriente','CLP',1000000000000000001)`);
      await registrar(data({ tarjetaId: precise, monto: 1 }));
      assert.equal(await sql(`select saldo_actual::text from tarjetas where id='${precise}'`), '1000000000000000000');
      const usd = randomUUID();
      await mine(`insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${usd}','${uid}','TEST009 USD','0000','cuenta_corriente','USD',10.25)`);
      await registrar(data({ tarjetaId: usd, monto: 0.1, moneda: 'USD' }));
      assert.equal(await sql(`select saldo_actual::text from tarjetas where id='${usd}'`), '10.15'); assert.equal(await verificar(), 't');
    });

    await t.test('fallo del proyector durante alta revierte cuenta, apertura, historia y cache', async () => {
      const before = await Promise.all(['tarjetas', 'libro_aperturas', 'abaco_privado.libro_cuentas', 'libro_operaciones', 'libro_apuntes', 'libro_proyecciones'].map(count));
      await sql("create function public.test009_fallo_alta() returns trigger language plpgsql as $$begin raise exception 'FALLO ALTA SINTETICO';end $$;create trigger test009_fallo_alta after insert on libro_proyecciones for each row execute function public.test009_fallo_alta()");
      try { await assert.rejects(mine(`insert into tarjetas(usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${uid}','TEST009 Alta fallida','0000','cuenta_corriente','CLP',5000)`), /FALLO ALTA/); }
      finally { await sql('drop trigger test009_fallo_alta on libro_proyecciones;drop function public.test009_fallo_alta()'); }
      assert.deepEqual(await Promise.all(['tarjetas', 'libro_aperturas', 'abaco_privado.libro_cuentas', 'libro_operaciones', 'libro_apuntes', 'libro_proyecciones'].map(count)), before); assert.equal(await verificar(), 't');
    });

    await t.test('excepcion despues de actualizar saldo revierte recepcion, operacion, apunte y cache', async () => {
      const before = await saldo(), counts = await Promise.all(['transacciones', 'libro_operaciones', 'libro_apuntes'].map(count));
      const projection = await sql(`select row_to_json(p) from libro_proyecciones p where tarjeta_id='${card}'`);
      await sql("create function public.test009_fallo_saldo() returns trigger language plpgsql as $$begin raise exception 'FALLO FINAL SINTETICO';end $$;create trigger test009_fallo_saldo after update on tarjetas for each row execute function public.test009_fallo_saldo()");
      try { await assert.rejects(registrar(data()), /FALLO FINAL/); }
      finally { await sql('drop trigger test009_fallo_saldo on tarjetas;drop function public.test009_fallo_saldo()'); }
      assert.equal(await saldo(), before); assert.deepEqual(await Promise.all(['transacciones', 'libro_operaciones', 'libro_apuntes'].map(count)), counts);
      assert.equal(await sql(`select row_to_json(p) from libro_proyecciones p where tarjeta_id='${card}'`), projection); assert.equal(await verificar(), 't');
    });

    await t.test('incremento exige el apunte nuevo, no acepta repetir operacion ni inventar un delta', async () => {
      const p = data({ monto: 1 }), before = await saldo(), r = await registrar(p);
      const op = await sql(`select id from libro_operaciones where transaccion_id='${r.id}' and operativa`);
      const projection = await sql(`select row_to_json(p) from libro_proyecciones p where tarjeta_id='${card}'`);
      await assert.rejects(sql(`select abaco_privado.escribir_proyeccion('${card}',999,'${op}')`), /secuencia inconsistente/);
      assert.equal(await sql(`select row_to_json(p) from libro_proyecciones p where tarjeta_id='${card}'`), projection);
      await sql(`select abaco_privado.escribir_proyeccion('${card}',999)`); // explicit rebuild ignores numeric delta in operative mode
      assert.equal(await saldo(), before - 1); assert.equal((await registrar(p)).id, r.id); assert.equal(await verificar(), 't');
    });

    await t.test('cache perdida o version corrupta bloquea nuevo gasto y reconstruir permite reintento atomico', async () => {
      for (const damage of [`delete from libro_proyecciones where tarjeta_id='${card}'`, `update libro_proyecciones set version=version+7 where tarjeta_id='${card}'`]) {
        const before = await saldo(), counts = await Promise.all(['transacciones', 'libro_operaciones', 'libro_apuntes'].map(count)), p = data({ monto: 1 });
        await sql('set role abaco_financiero;' + damage + ';reset role');
        await assert.rejects(registrar(p), /Proyeccion (ausente|o secuencia inconsistente)/);
        assert.deepEqual(await Promise.all(['transacciones', 'libro_operaciones', 'libro_apuntes'].map(count)), counts); assert.equal(await saldo(), before);
        await sql("select abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes')");
        const r = await registrar(p); assert.equal((await registrar(p)).id, r.id); assert.equal(await saldo(), before - 1); assert.equal(await verificar(), 't');
      }
    });

    await t.test('pausa bloquea escritores y altas; reconstruir cache perdida/corrupta conserva libro e IDs', async () => {
      const before = await saldo(), entries = await count('libro_apuntes');
      const spare = await mine(`select crear_integracion_atajo('${card}','${'c'.repeat(64)}')`);
      await sql("select abaco_privado.pausar_libro('pausar-escritores')");
      await mine(`select revocar_integracion_atajo('${spare}')`);
      assert.equal(await sql(`select revocado_at is not null from integraciones_atajos where id='${spare}'`), 't');
      assert.equal((await registrar(replayPayload)).id, replayId); assert.equal(await saldo(), before);
      assert.equal(await activar(), cut); assert.equal(await sql('select modo from abaco_privado.libro_control'), 'pausado');
      await assert.rejects(registrar(data()), /pausada/);
      await assert.rejects(mine(`insert into tarjetas(usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${uid}','TEST009 Bloqueada','0000','cuenta_corriente','CLP',1)`), /pausada/);
      await sql(`set role abaco_financiero;delete from libro_proyecciones where tarjeta_id='${card}';update libro_proyecciones set saldo=999 where tarjeta_id='${credit}';reset role`);
      assert.equal(await verificar(), 'f');
      await assert.rejects(sql("select abaco_privado.reanudar_libro('reanudar-libro-validado')"), /inconsistente/);
      await sql("select abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes')");
      assert.equal(await sql('select modo from abaco_privado.libro_control'), 'pausado'); assert.equal(await verificar(), 't');
      assert.equal(await saldo(), before); assert.equal(await count('libro_apuntes'), entries);
      await sql("select abaco_privado.reanudar_libro('reanudar-libro-validado')");
      await assert.rejects(sql("update abaco_privado.libro_control set modo='legacy',corte_id=null,activado_at=null where singleton"), /foreign key|foránea/i);
      const p = data({ monto: 1 }); const r = await registrar(p); assert.equal((await registrar(p)).id, r.id); assert.equal(await saldo(), before - 1);
    });

    await t.test('aislamiento entre usuarios/cuentas y no hay privilegios de escritura/operacion para APIs', async () => {
      assert.equal(await mine('select count(*) from libro_proyecciones', { user: otro, session: sid2 }), '1');
      assert.equal(await mine(`select count(*) from libro_proyecciones where usuario_id='${uid}'`, { user: otro, session: sid2 }), '0');
      assert.equal(await mine(`select count(*) from libro_saldos_calculados where usuario_id='${uid}'`, { user: otro, session: sid2 }), '0');
      await assert.rejects(registrar(data({ tarjetaId: ajena })), /autorizado/);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(await sql(`select pg_has_role('${role}','abaco_financiero','MEMBER')`), 'f');
        await assert.rejects(como('select abaco_privado.activar_libro(gen_random_uuid(),null)', { role, user: uid, session: sid }), /permission denied|permiso denegado/i);
        await assert.rejects(como(`update tarjetas set saldo_actual=1 where id='${card}'`, { role, user: uid, session: sid }), /permission denied|permiso denegado/i);
        await assert.rejects(como(`update libro_proyecciones set saldo=1 where tarjeta_id='${card}'`, { role, user: uid, session: sid }), /permission denied|permiso denegado/i);
      }
      assert.equal(await sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values ('anon'),('authenticated'),('service_role')) r(rol) where n.nspname='abaco_privado' and has_function_privilege(r.rol,p.oid,'EXECUTE')"), '0');
      const machine = await mine(`select crear_integracion_atajo('${card}','${'e'.repeat(64)}')`);
      const factor = randomUUID(); await sql(`set role supabase_auth_admin;insert into auth.mfa_factors values('${factor}','${uid}','verified','totp');update auth.sessions set aal='aal2',factor_id='${factor}' where id='${sid}';reset role`);
      assert.equal(await mine('select count(*) from libro_proyecciones'), '0');
      assert.equal(await mine('select count(*) from libro_saldos_calculados'), '0');
      await assert.rejects(registrar(data()), /MFA/);
      await assert.rejects(mine(`select revocar_integracion_atajo('${machine}')`), /MFA/);
      await assert.rejects(mine(`select crear_integracion_atajo('${card}','${'12'.repeat(32)}')`), /MFA/);
      const automated = data({ origen: 'atajo_manual', monto: 1 });
      const receipt = await token(automated, 'e'.repeat(64)); assert.equal((await token(automated, 'e'.repeat(64))).id, receipt.id);
      assert.ok(Number(await mine('select count(*) from libro_proyecciones', { aal: 'aal2' })) > 0);
      assert.ok(Number(await mine('select count(*) from libro_saldos_calculados', { aal: 'aal2' })) > 0);
      await mine(`select revocar_integracion_atajo('${machine}')`, { aal: 'aal2' });
      await assert.rejects(token(automated, 'e'.repeat(64)), /Credencial/);
      await sql(`update usuarios set rol='admin' where id='${otro}'`);
      assert.equal(await mine('select count(*) from libro_proyecciones', { user: otro, session: sid2 }), '0');
      await assert.rejects(registrar(data({ tarjetaId: ajena }), { user: otro, session: sid2 }), /MFA/);
      const p = data({ monto: 1 }); const r = await registrar(p, { aal: 'aal2' }); assert.equal((await registrar(p, { aal: 'aal2' })).id, r.id);
      assert.equal(await verificar(), 't');
      await sql(await file('../../supabase/tests/auditoria_libro009.sql'));
    });
  } finally { await cerrar(); }
});
