import test from 'node:test';
import assert from 'node:assert/strict';
import { postInvoices } from '../app/payroll/erp.ts';

test('ERP posting obtains a batch first and sends AP invoices with an isolated fake transport', async()=>{
  const calls=[];
  const fake=async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/batch')?{batchNumber:'B-42'}:{id:'I-1'});};
  const result=await postInvoices({invoiceUrl:'https://erp.example.test/invoices',invoiceMethod:'POST',batchUrl:'https://erp.example.test/batch',batchMethod:'GET',apiKey:'test-key'},batch=>[{businessUnitCode:'BU1',vendorCode:'SAL001',status:'DRAFT',currency:'EGP',exchangeRate:2,batchNumber:batch,lines:[{accountId:'5000',amount:100}]}],fake);
  assert.equal(result.batchNumber,'B-42');
  assert.equal(calls[0].url,'https://erp.example.test/batch');
  assert.equal(JSON.parse(calls[1].init.body).batchNumber,'B-42');
  assert.equal(calls[1].init.headers['x-api-key'],'test-key');
});

test('a failed invoice does not report full success',async()=>{
  const fake=async(url)=>url.endsWith('/batch')?Response.json({batchNumber:'B'}):new Response('failed',{status:500});
  await assert.rejects(()=>postInvoices({invoiceUrl:'https://erp.example.test/invoices',invoiceMethod:'POST',batchUrl:'https://erp.example.test/batch',batchMethod:'GET',apiKey:'test'},()=>[{businessUnitCode:'BU1'}],fake),/AP invoice failed/);
});

test('partial ERP acceptance is reported invoice by invoice before posting stops', async()=>{
  const observed=[];
  const fake=async(url,init)=>url.endsWith('/batch')?Response.json({batchNumber:'B-99'}):Response.json({invoiceId:JSON.parse(init.body).businessUnitCode},{status:JSON.parse(init.body).businessUnitCode==='BU1'?201:500});
  await assert.rejects(()=>postInvoices(
    {invoiceUrl:'https://erp.example.test/invoices',invoiceMethod:'POST',batchUrl:'https://erp.example.test/batch',batchMethod:'GET',apiKey:'test'},
    batch=>['BU1','BU2'].map(businessUnitCode=>({businessUnitCode,batchNumber:batch})),
    fake,
    async result=>observed.push(result),
  ),/AP invoice failed/);
  assert.deepEqual(observed.map(item=>[item.batchNumber,item.businessUnitCode,item.status]),[['B-99','BU1',201],['B-99','BU2',500]]);
});
