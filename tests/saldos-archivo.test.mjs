import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { saldoNumerico, formatoSaldo, totalSaldos, cuentasActivas, SALDO_DESCONOCIDO } from '../src/lib/saldos.mjs';
import * as saldos from '../src/lib/saldos.mjs';
import { datosCuenta } from '../src/lib/datosCuenta.mjs';
import { cursorHistorial } from '../src/lib/historialCuenta.mjs';
import { destinoSeguro } from '../src/lib/auth/rutas.mjs';
import { exportarExcel } from '../src/lib/exportarDatos.js';

const cuentas=[{id:'a',alias:'TEST desconocida',tipo_producto:'cuenta_corriente',moneda:'CLP',saldo_actual:null},
 {id:'b',alias:'TEST cero',tipo_producto:'cuenta_corriente',moneda:'CLP',saldo_actual:0},
 {id:'c',alias:'TEST archivada',tipo_producto:'credito_internacional',moneda:'USD',saldo_actual:-1.25,archivado_at:'2026-01-01T00:00:00Z'}];
const props={transacciones:[],movimientosFijos:[],tarjetas:cuentas,metas:[],mesLabel:'TEST010'};

test('NULL, vacio y cero se distinguen; totales incompletos no aparentan ser cero',()=>{
 for(const x of[null,undefined,'', ' ',NaN]){assert.equal(saldoNumerico(x),null);assert.equal(formatoSaldo(x),SALDO_DESCONOCIDO);}
 for(const x of[0,'0']){assert.equal(saldoNumerico(x),0);assert.notEqual(formatoSaldo(x),SALDO_DESCONOCIDO);}
 assert.equal(totalSaldos(cuentas.slice(0,2)),null);assert.equal(totalSaldos([{saldo_actual:100},{saldo_actual:-20,archivado_at:'2026-01-01'}]),80);assert.equal(totalSaldos([{saldo_actual:'1.25'},{saldo_actual:'2.50'}]),3.75);assert.deepEqual(cuentasActivas(cuentas).map(c=>c.id),['a','b']);assert.equal(saldoNumerico(-1.25),-1.25);
});
test('alta opcional conserva NULL y edicion nunca envia el saldo ni el archivo del snapshot',()=>{
 for(const saldo of[null,undefined,'',0,'0',-1.25,100]){const f={alias:'TEST Alias',tipo_producto:'cuenta_corriente',saldo_actual:saldo,archivado_at:'2026-01-01'};assert.equal(Object.hasOwn(datosCuenta(f,true),'saldo_actual'),false);assert.equal(Object.hasOwn(datosCuenta(f,true),'archivado_at'),false);assert.equal(datosCuenta(f,false).saldo_actual,saldoNumerico(saldo));}
});
test('Excel real conserva tipo numerico de cero y negativos, desconocido explicito y archivo',async()=>{
 const cwd=process.cwd(),dir=await mkdtemp(path.join(os.tmpdir(),'abaco010-xlsx-'));const output=path.join(dir,'Abaco_Reporte_TEST010.xlsx');
 try{process.chdir(dir);exportarExcel(props);const book=XLSX.read(await readFile(output),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets['Estado de Tarjetas']);assert.equal(rows[0].Saldo_Actual,SALDO_DESCONOCIDO);assert.equal(rows[1].Saldo_Actual,0);assert.equal(rows[2].Saldo_Actual,-1.25);assert.equal(rows[2].Estado,'Archivada');assert.equal(rows[2].Moneda,'USD');}finally{process.chdir(cwd);await unlink(output);await rmdir(dir);}
});
const require=createRequire(import.meta.url);
async function jsx(relative,stubs={}){
 const filename=fileURLToPath(new URL(relative,import.meta.url));const swc=require('next/dist/build/swc');await swc.loadBindings();
 const {code}=swc.transformSync(await readFile(filename,'utf8'),{filename,jsc:{target:'es2022',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const compiled={exports:{}};const localRequire=id=>Object.hasOwn(stubs,id)?stubs[id]:require(id);
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename})(localRequire,compiled,compiled.exports);return compiled.exports;
}
test('PDF: documento final muestra desconocido y estado archivado; genera PDF valido',async()=>{
 const renderer=await import('@react-pdf/renderer');const {ReporteDocumento}=await jsx('../src/components/ReporteExport.jsx',{'@/lib/saldos.mjs':saldos,'@react-pdf/renderer':renderer});
 const doc=ReporteDocumento(props),texts=[];function visit(n){if(Array.isArray(n))return n.forEach(visit);if(typeof n==='string'||typeof n==='number')texts.push(String(n));else if(n?.props)visit(n.props.children);}visit(doc);
 assert.ok(texts.includes(SALDO_DESCONOCIDO));assert.ok(texts.includes(formatoSaldo(0)));assert.ok(texts.includes(formatoSaldo(-1.25,'USD')));assert.ok(texts.some(x=>x.includes('Archivada')));
 const stream=await renderer.renderToStream(doc),chunks=[];for await(const chunk of stream)chunks.push(chunk);const bytes=Buffer.concat(chunks);assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert.ok(bytes.length>1000);
});
test('Resumen renderizado conserva desconocido, cero y archivadas; no oculta saldo en total',async()=>{
 const noop=()=>null;const {default:Dashboard}=await jsx('../src/components/DashboardView.jsx',{'@/lib/saldos.mjs':saldos,'@/lib/categoryColors':{colorDeCategoria:()=>''},'@/components/ReporteExport':{default:noop,__esModule:true},'@/components/MovimientosPanel':{default:noop,__esModule:true},'next/link':{default:({children})=>React.createElement('span',null,children),__esModule:true},'recharts':Object.fromEntries(['PieChart','Pie','Cell','Tooltip','ResponsiveContainer','BarChart','Bar','XAxis','YAxis','CartesianGrid','Legend','LineChart','Line'].map(n=>[n,noop]))});
 const html=renderToStaticMarkup(React.createElement(Dashboard,{...props,tasasCambio:[]}));assert.ok(html.includes(SALDO_DESCONOCIDO));assert.ok(html.includes('TEST cero'));assert.ok(html.includes('TEST archivada'));assert.ok(html.includes('Cuentas archivadas (1)'));assert.ok(html.includes('Los totales incluyen las cuentas archivadas'));assert.ok(!html.includes('NaN'));
});
test('rutas de historial y cursores aceptan solo UUID/fecha; sin URLs abiertas ni filtros inyectados',()=>{
 const id='12345678-1234-4234-8234-123456789abc';assert.equal(destinoSeguro('/cuentas/'+id),'/cuentas/'+id);for(const x of['/cuentas/no-valida','//evil.invalid','/cuentas/'+id+'/otro','/cuentas/'+id+'?next=https://evil.invalid'])assert.equal(destinoSeguro(x),'/');assert.deepEqual(cursorHistorial({antes:'2026-01-01T12:00:00.123456+00:00',id}),{fecha:'2026-01-01T12:00:00.123456+00:00',id});for(const antes of['2026-01-01),id.gt.0','x',[],undefined])assert.equal(cursorHistorial({antes,id}),null);assert.equal(cursorHistorial({antes:'2026-01-01T00:00:00Z',id:'bad'}),null);
});

test('historial de cuenta archivada consulta anos anteriores con cursor estable y limite de 31',async()=>{
 const id='12345678-1234-4234-8234-123456789abc',calls=[];let visible;
 const account={...cuentas[2],id},rows=Array.from({length:31},(_,i)=>({id:String(i),comercio:'TEST antiguo',fecha:'2018-01-01T00:00:00Z',tarjeta_id:id,monto_original:1,moneda_original:'USD'}));
 const query={eq:(...v)=>{calls.push(['eq',...v]);return query;},order:(...v)=>{calls.push(['order',...v]);return query;},limit:n=>{calls.push(['limit',n]);return query;},or:v=>{calls.push(['or',v]);return query;},then:resolve=>Promise.resolve({data:rows,error:null}).then(resolve)};
 const supabase={from:table=>({select:()=>table==='tarjetas'?{eq:()=>({maybeSingle:()=>Promise.resolve({data:account,error:null})})}:query})};
 const {default:Page}=await jsx('../src/app/(app)/cuentas/[id]/page.js',{'@/lib/saldos.mjs':saldos,'@/lib/historialCuenta.mjs':await import('../src/lib/historialCuenta.mjs'),'@/lib/auth/server':{exigirSesion:async ruta=>{assert.equal(ruta,'/cuentas/'+id);return{supabase};}},'next/navigation':{notFound:()=>{throw new Error('NotFound');}},'next/link':{__esModule:true,default:({children})=>React.createElement('span',null,children)},'@/components/MovimientosPanel':{__esModule:true,default:props=>{visible=props.transacciones;return React.createElement('p',null,props.transacciones[0]?.comercio);}}});
 const element=await Page({params:Promise.resolve({id}),searchParams:Promise.resolve({antes:'2020-01-01T00:00:00.123456+00:00',id})});const html=renderToStaticMarkup(element);assert.equal(visible.length,30);assert.ok(html.includes('TEST antiguo'));assert.ok(html.includes('Archivada'));assert.ok(html.includes('Movimientos más antiguos'));assert.ok(calls.some(x=>x[0]==='eq'&&x[1]==='tarjeta_id'&&x[2]===id));assert.ok(calls.some(x=>x[0]==='limit'&&x[1]===31));assert.ok(calls.some(x=>x[0]==='or'&&x[1].includes('123456+00:00')));await assert.rejects(Page({params:Promise.resolve({id:'invalido'}),searchParams:Promise.resolve({})}),/NotFound/);
});
