import{test}from'node:test';import assert from'node:assert/strict';import{datosCuenta}from'../src/lib/datosCuenta.mjs';
test('edicion excluye saldo incluso si el formulario contiene snapshot antiguo; creacion conserva apertura',()=>{
 const form={alias:'Alias nuevo',ultimos_digitos:'0001',tipo_producto:'cuenta_corriente',moneda:'CLP',saldo_actual:10000};
 const update=datosCuenta(form,true);assert.equal(Object.hasOwn(update,'saldo_actual'),false);assert.equal(update.alias,'Alias nuevo');assert.equal(datosCuenta(form,false).saldo_actual,10000);
});
