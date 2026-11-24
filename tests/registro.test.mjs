import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL fixture based on the supplied schema; never connects to Supabase.
import { fixture } from './fixtures/base.mjs';

const usuario = '00000000-0000-4000-8000-000000000001';
const tarjeta = '00000000-0000-4000-8000-000000000011';
const hash = 'a'.repeat(64);

test('migraciones: permisos, registro atómico, credenciales y conciliación', async t => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    for (const file of ['202611130001_usuarios_permisos.sql','202611130002_registro_atajos.sql','202611130003_revision_gastos.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
    }
    const query = (sql, args=[]) => db.query(sql,args);
    const gasto = (overrides={}) => ({ evento_id: crypto.randomUUID(),tarjetaId:tarjeta,monto:1000,moneda:'CLP',comercio:'Prueba',fecha:'2026-01-02T12:00:00Z',origen:'manual',...overrides });
    const registrar = (datos,token=null) => query('select (public.registrar_gasto($1,$2::jsonb,$3)).*',[usuario,JSON.stringify(datos),token]);
    const saldo = async () => Number((await query('select saldo_actual from tarjetas where id=$1',[tarjeta])).rows[0].saldo_actual);
    await t.test('revoca grants de tabla y columna sin impedir perfil', async () => {
      for (const rol of ['anon','authenticated']) {
        for (const columna of ['id','email','rol','estado_suscripcion','fecha_vencimiento','created_at']) {
          assert.equal((await query("select has_column_privilege($1,'usuarios',$2,'UPDATE') as permitido",[rol,columna])).rows[0].permitido,false);
        }
      }
      await db.exec(`set request.jwt.claim.sub='${usuario}'; set request.jwt.claim.role='authenticated'; set role authenticated;`);
      await query("update usuarios set nombre='Perfil',regla_presupuesto_activa=true where id=$1",[usuario]);
      await assert.rejects(query("update usuarios set rol='admin' where id=$1",[usuario]),/permission denied/);
      await assert.rejects(query("insert into transacciones(usuario_id) values($1)",[usuario]),/permission denied/);
      await db.exec('reset role');
      // Simulate a future accidental broad grant: trigger still blocks escalation.
      await db.exec('grant update(rol) on usuarios to authenticated; set role authenticated;');
      await assert.rejects(query("update usuarios set rol='admin' where id=$1",[usuario]),/Solo el servidor/);
      await db.exec('reset role; revoke update(rol) on usuarios from authenticated;');
    });
    await t.test('reintentos descuentan una vez; IDs distintos son compras distintas', async () => {
      const datos = gasto();
      const resultados = await Promise.all([registrar(datos),registrar(datos),registrar(datos)]);
      assert.equal(new Set(resultados.map(r=>r.rows[0].id)).size,1);
      assert.equal(await saldo(),9000);
      await assert.rejects(registrar({...datos,monto:2000}),/otros datos/);
      await registrar(gasto());
      assert.equal(await saldo(),8000);
    });
    await t.test('valida monto, fecha, moneda y referencias cruzadas sin alterar saldo', async () => {
      for (const datos of [{monto:-1},{monto:'NaN'},{moneda:'EUR'},{fecha:'infinity'},{fecha:'2026-01-02'},{tipo:'ingreso'},
        {tarjetaId:'00000000-0000-4000-8000-000000000012'}, {categoriaId:'00000000-0000-4000-8000-000000000022'}]) {
        await assert.rejects(registrar(gasto(datos)));
      }
      assert.equal(await saldo(),8000);
    });
    await t.test('discrepancias quedan pendientes y conciliación se aplica una vez', async () => {
      const a = (await registrar(gasto({monto:20000}))).rows[0];
      const b = (await registrar(gasto({moneda:'USD',monto:5}))).rows[0];
      assert.equal(a.estado_revision,'pendiente'); assert.equal(b.motivo_revision,'moneda_cuenta_distinta');
      assert.equal(Number(b.monto_clp),4750); assert.equal(await saldo(),8000);
      await db.exec('set role authenticated');
      await query('select confirmar_gasto_pendiente($1,4750)',[b.id]);
      await query('select confirmar_gasto_pendiente($1,4750)',[b.id]);
      await db.exec('reset role');
      assert.equal(await saldo(),3250);
    });
    await t.test('token limitado a cuenta; hash privado, límite de uso y revocación', async () => {
      await db.exec('set role authenticated');
      const id=(await query('select crear_integracion_atajo($1,$2) as id',[tarjeta,hash])).rows[0].id;
      await assert.rejects(query('select token_hash from integraciones_atajos'),/permission denied/);
      await db.exec('reset role');
      const datos=gasto({tarjetaId:undefined,origen:'atajo_manual',monto:100});
      assert.equal((await registrar(datos,hash)).rows[0].tarjeta_id,tarjeta);
      await query('update integraciones_atajos set usos=30 where id=$1',[id]);
      await registrar(datos,hash); // Safe retries work at the rate limit.
      await assert.rejects(registrar(gasto({origen:'atajo_manual'}),hash),/Límite/);
      await db.exec('set role authenticated');
      await query('select revocar_integracion_atajo($1)',[id]);
      await db.exec('reset role');
      await assert.rejects(registrar(datos,hash),/Credencial inválida/);
    });
    await t.test('cuotas se guardan con el gasto o se revierte toda la operación', async () => {
      const antes=await saldo();
      const datos=gasto({monto:300,numCuotas:3,tasaCuotas:0});
      await registrar(datos); await registrar(datos);
      await assert.rejects(registrar({...datos,numCuotas:4}),/otras cuotas/);
      assert.equal((await query('select count(*)::int as total from compras_cuotas')).rows[0].total,1);
      assert.equal(await saldo(),antes-300);
      const fallido=gasto({monto:999999,numCuotas:3});
      await assert.rejects(registrar(fallido),/Revisa la cuenta/);
      assert.equal((await query('select count(*)::int as total from transacciones where evento_id=$1',[fallido.evento_id])).rows[0].total,0);
      assert.equal(await saldo(),antes-300);
    });
  } finally { await db.close(); }
});
