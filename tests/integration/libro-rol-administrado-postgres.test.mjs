import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearBaseLocal, literal } from './postgres-fixture.mjs';

test('009 modelo local de instalador postgres sin SUPERUSER', {
  skip: process.env.ABACO_SQL_TEST_ACK !== 'synthetic-only' || process.env.ABACO_009_MANAGED_ROLE_ACK !== 'nonsuper-local-model',
}, async () => {
  const { sql, como, file, cerrar } = await crearBaseLocal({ authBootstrapUser: 'abaco_labroot' });
  try {
    assert.equal(await sql("select current_user='postgres' and not rolsuper and rolcreaterole from pg_roles where rolname=current_user"), 't');
    await sql(await file('../../supabase/migrations/202611230009_escritor_financiero.sql'));
    assert.equal(await sql("select pg_has_role('postgres','abaco_financiero','SET') and pg_has_role('postgres','abaco_financiero','USAGE')"), 't');
    await sql(await file('../../supabase/tests/auditoria_libro009.sql'));
    const user = randomUUID(), card = randomUUID(), session = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at) values('${user}','modelo009@abaco-test.invalid',now());insert into auth.sessions(id,user_id) values('${session}','${user}');insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${card}','${user}','TEST009 MODELO','0000','cuenta_corriente','CLP',1000);select abaco_privado.activar_libro('${randomUUID()}','activar-libro-con-saldos-comprometidos')`);
    const p = { evento_id: randomUUID(), tarjetaId: card, monto: 100, moneda: 'CLP', comercio: 'TEST009 MODELO', origen: 'manual', fecha: '2026-01-02T12:00:00Z' };
    const receive = () => como(`select (registrar_gasto('${user}',${literal(JSON.stringify(p))}::jsonb,null)).id`, { user, session });
    assert.equal(await receive(), await receive());
    assert.equal(await sql(`select saldo_actual::text from tarjetas where id='${card}'`), '900');
    await sql("select abaco_privado.pausar_libro('pausar-escritores');select abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes');select abaco_privado.reanudar_libro('reanudar-libro-validado')");
    await sql(await file('../../supabase/tests/auditoria_libro009.sql'));
    assert.equal(await sql('select abaco_privado.verificar_proyecciones()'), 't');
  } finally { await cerrar(); }
});
