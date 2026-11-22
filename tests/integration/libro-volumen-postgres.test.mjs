import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Opt-in. Does not read .env.local, CLI link, PGHOST, remote URLs or any real account.
const habilitado=process.env.ABACO_SQL_TEST_ACK==='synthetic-only';
test('008 benchmark local sintetico de constraint', {skip:!habilitado},async t=>{
 const bin=process.env.ABACO_TEST_PG_BIN;
 const dataDir=process.env.ABACO_TEST_PG_DATA;
 const port=process.env.ABACO_TEST_PG_PORT;
 assert.ok(bin && dataDir && /^5[0-9]{4}$/.test(port||''),'Debe declarar binarios, PGDATA aislado y puerto de pruebas');
 const nombre='abaco_it_'+randomUUID().replaceAll('-','');
 const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
 function sql(text,db='postgres') {
  return new Promise((resolve,reject)=>{
   const entorno=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
   const proc=spawn(path.join(bin,'psql.exe'),['-X','-qAt','-h','127.0.0.1','-p',port,'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],{
    windowsHide:true,env:{...entorno,PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'5',PGPASSFILE:path.join(dataDir,'abaco-no-passwords')},stdio:['pipe','pipe','pipe']
   });
   let out='',err='';proc.stdout.on('data',b=>out+=b);proc.stderr.on('data',b=>err+=b);
   proc.on('error',reject);proc.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err.trim()||'psql falló')));
   proc.stdin.end(text);
  });
 }
 const actual=(await sql('show data_directory;')).replaceAll('\\','/');
 assert.equal(path.normalize(await realpath(actual)).toLowerCase(),path.normalize(await realpath(dataDir)).toLowerCase(),'Rechaza cualquier clúster distinto del aislado');
 assert.match(actual.replaceAll('\\','/'),/\/work\/staging-pg\/data$/i,'PGDATA debe ser el clúster creado para estas pruebas');
 await sql('create database '+nombre+';');
 const ejecutar=text=>sql(text,nombre);
 const uno=async text=>JSON.parse(await ejecutar(text));
 const uid='10000000-0000-4000-8000-000000000001';
 const otro='10000000-0000-4000-8000-000000000002';
 const admin='10000000-0000-4000-8000-000000000003';
 const tarjeta='20000000-0000-4000-8000-000000000001';
 const ajena='20000000-0000-4000-8000-000000000002';
 const credito='20000000-0000-4000-8000-000000000003';
 const sid='30000000-0000-4000-8000-000000000001';
 const aid='30000000-0000-4000-8000-000000000003';
 const factor='40000000-0000-4000-8000-000000000001';
 function como(text,{user=uid,aal='aal1',role='authenticated',session=sid}={}){
  assert.ok(['authenticated','service_role','anon'].includes(role));
  return ejecutar(`begin;set local role ${role};set local "request.jwt.claims"=${literal(JSON.stringify({sub:user,role,aal,session_id:session}))};${text};commit;`);
 }
 const datos=(extra={})=>({evento_id:randomUUID(),tarjetaId:tarjeta,monto:100,moneda:'CLP',comercio:'Comercio ficticio',fecha:'2026-01-02T12:00:00Z',origen:'manual',...extra});
 const registrar=(payload,opts={})=>como(`select row_to_json(t) from public.registrar_gasto(${literal(opts.user||uid)},${literal(JSON.stringify(payload))}::jsonb,null) t`,opts).then(JSON.parse);
 const token=(payload,hash='a'.repeat(64))=>como(`select row_to_json(t) from public.registrar_gasto(null,${literal(JSON.stringify(payload))}::jsonb,${literal(hash)}) t`,{user:null,role:'service_role'}).then(JSON.parse);
 const saldo=async id=>Number(await ejecutar(`select saldo_actual from public.tarjetas where id=${literal(id||tarjeta)};`));
 try {
  await ejecutar(await readFile(new URL('./local_auth.sql',import.meta.url),'utf8'));
  const base=await readFile(new URL('../../supabase/staging/00_base_public.sql',import.meta.url),'utf8');
  await assert.rejects(ejecutar(base),/Staging/);
  await ejecutar("set abaco.staging_confirmed='empty-synthetic-only';\n"+base);
  await ejecutar(await readFile(new URL('../../supabase/tests/auditoria_previa.sql',import.meta.url),'utf8'));
  for(const file of ['202611130001_usuarios_permisos.sql','202611130002_registro_atajos.sql','202611130003_revision_gastos.sql','202611130004_auth_mfa.sql','202611190005_instrumentos_vinculos.sql','202611190006_alias_captura.sql','202611220007_edicion_cuentas.sql']) await ejecutar(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await ejecutar(await readFile(new URL('../../supabase/tests/auditoria_auth_mfa.sql',import.meta.url),'utf8'));
  await ejecutar(await readFile(new URL('../../supabase/tests/auditoria_multitarjeta.sql',import.meta.url),'utf8'));
  await ejecutar(`set role supabase_auth_admin;insert into auth.users(id,email,email_confirmed_at) values
   ('${uid}','uno@abaco-test.invalid',now()),('${otro}','dos@abaco-test.invalid',now()),('${admin}','admin@abaco-test.invalid',now());
   insert into auth.sessions(id,user_id) values('${sid}','${uid}'),('${aid}','${admin}');reset role;
   update public.usuarios set rol='admin' where id='${admin}';
   insert into public.tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual,cupo_maximo) values
   ('${tarjeta}','${uid}','Cuenta ficticia','0001','cuenta_corriente','CLP',10000,null),
   ('${ajena}','${otro}','Cuenta ajena ficticia','0002','cuenta_corriente','CLP',10000,null),
   ('${credito}','${uid}','Crédito ficticio','0003','credito_nacional','CLP',0,100000);
   insert into public.tasas_cambio(moneda,valor) values('USD',950);`);

  const {performance}=await import('node:perf_hooks');const results=[];
  await ejecutar("create table bench008_cuentas as select n,gen_random_uuid() as id from generate_series(1,1000) n;insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) select id,'"+uid+"','Bench008-'||n,'0000','cuenta_corriente','CLP',1000000 from bench008_cuentas;");
  for(const target of [100000,1000000]){
   const existing=Number(await ejecutar('select count(*) from transacciones'));
   const seedStart=performance.now();
   await ejecutar("insert into transacciones(usuario_id,tarjeta_id,monto_original,moneda_original,monto_clp,monto_cuenta,comercio,fecha,origen,evento_id,estado_revision) select '"+uid+"',c.id,1,'CLP',1,1,'Comercio sintetico '||g.n||repeat('x',80),now()-g.n*interval '1 second','atajo_manual',gen_random_uuid(),'pendiente' from generate_series("+(existing+1)+","+target+") g(n) join bench008_cuentas c on c.n=((g.n-1)%1000)+1;update transacciones set estado_revision='confirmado' where estado_revision='pendiente';analyze transacciones;");
   const seedMs=performance.now()-seedStart;
   const trials=[];
   for(let repeat=0;repeat<3;repeat++){
    const wall=performance.now();
    const metrics=JSON.parse(await ejecutar("set lock_timeout='2s';set statement_timeout='30s';create temp table bench008_timing(ms numeric);do $$declare started timestamptz:=clock_timestamp();begin alter table public.transacciones add constraint libro_transaccion_propietario unique(usuario_id,id,tarjeta_id);insert into bench008_timing values(extract(epoch from clock_timestamp()-started)*1000);end $$;select json_build_object('serverDdlMs',(select ms from bench008_timing),'indexBytes',pg_relation_size('public.libro_transaccion_propietario'),'tableBytes',pg_total_relation_size('public.transacciones'),'rows',(select count(*) from transacciones));"));
    assert.equal(metrics.rows,target);
    trials.push({...metrics,localWallMs:performance.now()-wall});await ejecutar('alter table transacciones drop constraint libro_transaccion_propietario');
   }
   results.push({target,seedMs,trials});
  }
  const start=performance.now();await ejecutar(await readFile(new URL('../../supabase/migrations/202611220008_libro_ensayo.sql',import.meta.url),'utf8'));
  const output={postgres:await ejecutar('select version()'),synthetic:true,accounts:1000,owners:1,results,fullMigrationAtMillionWallMs:performance.now()-start};
  const {writeFile}=await import('node:fs/promises');await writeFile('C:/Users/tatan/Documents/Codex/2026-11-13/esd/work/008-volume-result.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
 } finally {
  // Only the unique database created by this run, on the verified disposable cluster.
  await sql('drop database '+nombre+' with (force);');
 }
});
