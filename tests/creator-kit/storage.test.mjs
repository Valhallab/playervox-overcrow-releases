import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageSimulator} from '../../tools/creator-kit/preview/storage.mjs';

const request = (store, operation, key, value) => store({type:'storage', operation, key, ...(operation === 'set' ? {value:JSON.stringify(value)} : {})});

test('preview storage is shared within a runtime and isolated from every new runtime', () => {
  const first = createStorageSimulator(), second = createStorageSimulator();
  assert.equal(request(first,'get','missing').metadata.value,null);
  assert.equal(request(first,'set','__proto__',{items:[false,0,null]}).metadata.ok,true);
  assert.deepEqual(JSON.parse(request(first,'get','__proto__').metadata.value),{items:[false,0,null]});
  assert.equal(request(second,'get','__proto__').metadata.value,null);
  request(first,'set','null',null);
  assert.equal(request(first,'get','null').metadata.value,'null');
  assert.equal(request(first,'remove','__proto__').metadata.ok,true);
  assert.equal(request(first,'get','__proto__').metadata.value,null);
});

test('preview storage validates direct bridge requests and preserves earlier data on failure', () => {
  const store = createStorageSimulator();
  request(store,'set','existing',{safe:true});
  const valid = {type:'storage',operation:'set',key:'existing',value:'true'};
  for (const meta of [null,{}, {...valid,type:'fetch'}, {...valid,operation:'clear'}, {...valid,key:''}, {...valid,key:'é'.repeat(65)}, {...valid,value:'{broken'}, {...valid,value:1}, {...valid,value:'1e999'}, {...valid,value:'"'+'a'.repeat(65536)+'"'}, {...valid,value:'['.repeat(66)+'0'+']'.repeat(66)}, {...valid,extra:true}]) {
    assert.equal(store(meta).metadata.ok,false);
    assert.deepEqual(JSON.parse(request(store,'get','existing').metadata.value),{safe:true});
  }
});

test('preview storage bounds keys while allowing replacement and removal at capacity', () => {
  const store = createStorageSimulator();
  for (let i=0;i<256;i++) assert.equal(request(store,'set',String(i),i).metadata.ok,true);
  assert.equal(request(store,'set','extra',true).metadata.error.code,'storage_quota_exceeded');
  assert.equal(request(store,'set','0','replaced').metadata.ok,true);
  request(store,'remove','1');
  assert.equal(request(store,'set','extra',true).metadata.ok,true);
  assert.equal(request(store,'get','0').metadata.value,'"replaced"');
});
