import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../tools/creator-kit/lib/manifest.mjs';
import {simulateFetch} from '../../tools/creator-kit/preview/network.mjs';
import {canonicalNetworkRules,networkRuleKey} from '../../tools/creator-kit/preview/network-policy.mjs';

const origin='https://api.example.com';
const exact=(path='/v2/items')=>({origin,method:'GET',path});
const dynamic=()=>({...exact('/games/{steamAppId}/score'),pathParams:{steamAppId:{type:'integer',min:1,max:4294967295}}});
const validate=network=>validateManifest({schemaVersion:1,id:'com.example.network',version:'1.0.0',apiVersion:'1',entrypoints:{view:'index.html'},permissions:{network}},new Set(['index.html']));
function response(rule,url,method='GET') {
  return simulateFetch({network:[rule]},[{url,method,status:200,json:{fixture:true}}],{url,method}).metadata;
}
const allowed=(rule,url,method)=>assert.equal(response(rule,url,method).ok,true,url);
const denied=(rule,url,method)=>assert.equal(response(rule,url,method).error?.code,'capability_denied',url);

test('explicit routes validate without changing API version and match complete paths',()=>{
  for(const rule of [exact(),exact('/v2/items/'),dynamic()])assert.doesNotThrow(()=>validate([rule]));
  allowed(exact(),origin+'/v2/items');
  allowed(exact('/v2/items/'),origin+'/v2/items/');
  allowed(dynamic(),origin+'/games/1/score');
  allowed(dynamic(),origin+'/games/4294967295/score');
  for(const path of ['/v2','/v2/','/v2/items/','/v2/items/child','/v2/item','/v2/items-sibling'])denied(exact(),origin+path);
  denied(exact('/v2/items/'),origin+'/v2/items');
  denied(exact(),origin+'/v2/items','POST');
  denied(exact(),'https://other.example.com/v2/items');
});

test('schema closes legacy prefixes, wildcards, unknown fields and ambiguous path templates',()=>{
  for(const path of ['','/','v2/items','//v2/items','/v2//items','/v2/./items','/v2/../items','/v2/%69tems','/v2/items?x=1','/v2/items#','/v2/\\items','/v2/*','/v2/:id','/v2/{id?}','/v2/item-{id}','/v2/{id}/x/{id}','/v2/é','/'+ 'a'.repeat(1024)]) {
    assert.throws(()=>validate([exact(path)]),path);
  }
  for(const rule of [{origin,method:'GET',pathPrefix:'/v2/'},{...exact(),pathPrefix:'/v2/'},{...exact(),optional:true},{origin,method:'GET'},{...exact(),method:'HEAD'},{...exact(),origin:origin+'/'}])assert.throws(()=>validate([rule]),JSON.stringify(rule));
  assert.doesNotThrow(()=>validate([exact('/'+'a'.repeat(1023))]));
});

test('schema requires exactly one bounded constraint per named path parameter',()=>{
  const invalid=[
    {...dynamic(),pathParams:undefined},{...dynamic(),pathParams:null},{...dynamic(),pathParams:[]},
    {...dynamic(),pathParams:{}},{...exact(),pathParams:{unused:{type:'slug',maxLength:1}}},
    {...exact('/{_id}'),pathParams:{_id:{type:'slug',maxLength:1}}},
    {...exact('/{a'+'x'.repeat(32)+'}'),pathParams:{['a'+'x'.repeat(32)]:{type:'slug',maxLength:1}}},
  ];
  for(const constraint of [null,{}, {type:'integer',min:1}, {type:'integer',min:-1,max:3}, {type:'integer',min:2,max:1}, {type:'integer',min:0,max:Number.MAX_SAFE_INTEGER+1}, {type:'integer',min:0,max:1.5}, {type:'integer',min:'0',max:1}, {type:'integer',min:0,max:1,required:false}, {type:'slug'}, {type:'slug',maxLength:0}, {type:'slug',maxLength:129}, {type:'slug',maxLength:1.5}, {type:'slug',maxLength:8,pattern:'.*'}, {type:'string',maxLength:8}, {type:'enum',values:[]}, {type:'enum',values:['same','same']}, {type:'enum',values:['.']}, {type:'enum',values:['..']}, {type:'enum',values:['a/b']}, {type:'enum',values:['é']}, {type:'enum',values:['x'.repeat(129)]}, {type:'enum',values:Array.from({length:33},(_,i)=>String(i))}])invalid.push({...dynamic(),pathParams:{steamAppId:constraint}});
  for(const rule of invalid)assert.throws(()=>validate([rule]),JSON.stringify(rule));
  const names=Array.from({length:8},(_,i)=>'p'+i);
  const rule={...exact('/'+names.map(name=>'{'+name+'}').join('/')),pathParams:Object.fromEntries(names.map(name=>[name,{type:'slug',maxLength:128}]))};
  assert.doesNotThrow(()=>validate([rule]));
  rule.path+='/{ninth}';rule.pathParams.ninth={type:'slug',maxLength:128};
  assert.throws(()=>validate([rule]));
});

test('schema bounds query declarations and canonical duplicate routes',()=>{
  const queryRule={...exact(),queryParams:{search:{type:'string',maxLength:256,required:true},page:{type:'integer',min:0,max:Number.MAX_SAFE_INTEGER}}};
  assert.doesNotThrow(()=>validate([queryRule]));
  for(const queryParams of [null,[], {'bad-key':{type:'slug',maxLength:2}}, {q:{type:'string',maxLength:0}}, {q:{type:'string',maxLength:257}}, {q:{type:'string',maxLength:2,required:1}}, {q:{type:'string',maxLength:2,extra:true}}, Object.fromEntries(Array.from({length:17},(_,i)=>['q'+i,{type:'slug',maxLength:1}]))])assert.throws(()=>validate([{...exact(),queryParams}]),JSON.stringify(queryParams));
  const queryParams=Object.fromEntries(Array.from({length:16},(_,i)=>['q'+i,{type:'enum',values:['z','a']}]))
  assert.doesNotThrow(()=>validate([{...exact(),queryParams}]));
  assert.doesNotThrow(()=>validate(Array.from({length:32},(_,i)=>exact('/items/'+i))));
  assert.throws(()=>validate(Array.from({length:33},(_,i)=>exact('/items/'+i))));
  for(const rules of [null,{},[exact(),exact()],[exact(),{...exact(),pathParams:{},queryParams:{}}],[{...exact(),queryParams},{...exact(),queryParams:Object.fromEntries(Object.entries(queryParams).reverse().map(([key])=>[key,{type:'enum',values:['a','z'],required:false}]))}]])assert.throws(()=>validate(rules));
});

test('canonical network fingerprints retain every constraint and ignore map, enum and rule ordering',()=>{
  const route={...dynamic(),queryParams:{sort:{type:'enum',values:['new','all']},page:{type:'integer',min:1,max:10}}};
  const equivalent={queryParams:{page:{max:10,min:1,type:'integer',required:false},sort:{values:['all','new'],required:false,type:'enum'}},pathParams:{steamAppId:{max:4294967295,type:'integer',min:1}},path:route.path,method:'GET',origin};
  assert.equal(networkRuleKey(route),'{"origin":"https://api.example.com","method":"GET","path":"/games/{steamAppId}/score","pathParams":{"steamAppId":{"type":"integer","min":1,"max":4294967295}},"queryParams":{"page":{"type":"integer","min":1,"max":10,"required":false},"sort":{"type":"enum","values":["all","new"],"required":false}}}');
  assert.equal(networkRuleKey(route),networkRuleKey(equivalent));
  const fingerprint=rules=>createHash('sha256').update(JSON.stringify(canonicalNetworkRules(rules))).digest('hex');
  const before=fingerprint([route,exact()]);
  assert.equal(before,fingerprint([{...exact(),queryParams:{},pathParams:{}},equivalent]));
  for(const change of [value=>value.pathParams.steamAppId.max--,value=>value.queryParams.sort.required=true,value=>value.queryParams.sort.values.push('other'),value=>value.queryParams.page.max++,value=>value.queryParams.extra={type:'slug',maxLength:3}]) {
    const changed=structuredClone(route);change(changed);
    assert.notEqual(before,fingerprint([changed,exact()]),String(change));
  }
});

test('request path parameters enforce canonical decimal, slug and enum bounds',()=>{
  for(const value of ['0','4294967296','01','-1','+1',' 1','1.0','1e2','9007199254740992'])denied(dynamic(),origin+'/games/'+value+'/score');
  const integer={...exact('/{id}'),pathParams:{id:{type:'integer',min:0,max:Number.MAX_SAFE_INTEGER}}};
  for(const value of ['0','9007199254740991'])allowed(integer,origin+'/'+value);
  denied(integer,origin+'/9007199254740992');
  const slug={...exact('/orders/{slug}/top'),pathParams:{slug:{type:'slug',maxLength:3}}};
  for(const value of ['a','A_9','x-y'])allowed(slug,origin+'/orders/'+value+'/top');
  for(const value of ['','four','a.b','~','é','%61'])denied(slug,origin+'/orders/'+value+'/top');
  const enumeration={...exact('/{mode}'),pathParams:{mode:{type:'enum',values:['all','a.b~_-']}}};
  for(const value of ['all','a.b~_-'])allowed(enumeration,origin+'/'+value);
  denied(enumeration,origin+'/ALL');
});

test('query values decode once and enforce unknown, duplicate, required and typed restrictions',()=>{
  const rule={...exact(),queryParams:{q:{type:'string',maxLength:8,required:true},page:{type:'integer',min:1,max:2},mode:{type:'enum',values:['all','new']},slug:{type:'slug',maxLength:4}}};
  for(const query of ['q=caf%C3%A9','q=a+b&page=2&mode=all&slug=A_9','mode=new&q=%F0%9F%98%80','q=a%26b%3Dc','q=%2500','q=éééé'])allowed(rule,origin+'/v2/items?'+query);
  for(const query of ['', 'page=1', 'q=', 'q', 'q=ok&extra=x', 'q=ok&q=ok', 'q=ok&', '&q=ok', 'q=ok&&page=1', '%71=ok', 'q=ok&page=0', 'q=ok&page=3', 'q=ok&page=01', 'q=ok&page=1e0', 'q=ok&mode=other', 'q=ok&slug=a.b', 'q=ok&slug=longer', 'q=123456789', 'q=ééééé', 'q=a b', 'q=%', 'q=%0', 'q=%GG', 'q=%C0%AF', 'q=%FF', 'q=%ED%A0%80', 'q=%00', 'q=%1F', 'q=%7F', 'q=%C2%80', 'q=%C2%9F', 'q=\ud800'])denied(rule,origin+'/v2/items?'+query);
  denied(rule,origin+'/v2/items');
  allowed({...exact(),queryParams:{optional:{type:'slug',maxLength:3}}},origin+'/v2/items');
  for(const queryParams of [undefined,{}]) {
    const noQuery={...exact(),...(queryParams===undefined?{}:{queryParams})};
    denied(noQuery,origin+'/v2/items?');denied(noQuery,origin+'/v2/items?x=1');
  }
});

test('request checks reject raw ambiguity before URL normalization can hide it',()=>{
  for(const path of ['/v2/./items','/v2/x/../items','/v2/%2e/items','/v2/x/%2e%2e/items','/v2/%69tems','/v2/%2569tems','/v2//items','/v2/\\items','/v2/items#','/v2/items#fragment','/v2/items?','/v2/items?x=1'])denied(exact(),origin+path);
  for(const url of ['https://user:secret@api.example.com/v2/items','https://@api.example.com/v2/items','https://api.example.com\\v2/items','https://api.example.com/v2/\nitems',' '+origin+'/v2/items',origin+'/v2/items ','http://api.example.com/v2/items'])denied(exact(),url);
  const path='/'+'x'.repeat(1023),longOrigin='https://'+'a'.repeat(63)+'.'+'b'.repeat(63)+'.example.com';
  const rule={origin:longOrigin,method:'GET',path,queryParams:Object.fromEntries(Array.from({length:4},(_,i)=>['q'+i,{type:'string',maxLength:256}]))};
  const url=longOrigin+path+'?q0='+'x'.repeat(256)+'&q1='+'x'.repeat(256)+'&q2='+'x'.repeat(256)+'&q3=';
  const boundary=url+'x'.repeat(2048-url.length);
  allowed(rule,boundary);denied(rule,boundary+'x');
});

test('preview fails closed for malformed grants and never falls back to real networking',t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('external networking forbidden');});
  const result=simulateFetch({network:[exact()]},[],{url:origin+'/v2/items',method:'GET'});
  assert.equal(result.metadata.error.code,'fixture_missing');
  for(const rule of [{origin,method:'GET',pathPrefix:'/v2/'},{...exact(),unexpected:true},{...dynamic(),pathParams:{}}])denied(rule,origin+'/v2/items');
  assert.equal(globalThis.fetch.mock.calls.length,0);
});

test('ASCII templates and typed values do not accept trailing JavaScript line terminators',()=>{
  for(const ending of ['\n','\r','\u2028','\u2029']) {
    for(const rule of [exact('/items'+ending),{...exact(),queryParams:{['q'+ending]:{type:'slug',maxLength:8}}},{...exact(),queryParams:{q:{type:'enum',values:['value'+ending]}}},{...exact('/{id}'+ending),pathParams:{id:{type:'slug',maxLength:8}}}])assert.throws(()=>validate([rule]),JSON.stringify(rule));
    const encoded=encodeURIComponent(ending);
    for(const constraint of [{type:'integer',min:1,max:3},{type:'slug',maxLength:8}])denied({...exact(),queryParams:{q:constraint}},origin+'/v2/items?q=1'+encoded);
  }
});

test('source Score and Warframe permissions allow only the intended routes',async()=>{
  const score=JSON.parse(await readFile(new URL('../../content/references/score/manifest.json',import.meta.url),'utf8'));
  const market=JSON.parse(await readFile(new URL('../../widgets/warframe-market/manifest.json',import.meta.url),'utf8'));
  for(const manifest of [score,market]) {
    assert.equal(manifest.apiVersion,'1');
    assert.doesNotThrow(()=>validateManifest(manifest,new Set(Object.values(manifest.entrypoints))));
  }
  const check=(manifest,url,ok)=>assert.equal(simulateFetch(manifest.permissions,[{url,status:200,json:{}}],{url,method:'GET'}).metadata.ok,ok,url);
  check(score,'https://api.playervox.com/api/v1/overcrow/games/steam/730/score',true);
  for(const path of ['730','0/score','4294967296/score','730/reviews','730/score/extra'])check(score,'https://api.playervox.com/api/v1/overcrow/games/steam/'+path,false);
  for(const path of ['/v2/items','/v2/versions','/v2/orders/item/prime_chamber/top','/v2/orders/item/'+'x'.repeat(96)+'/top'])check(market,'https://api.warframe.market'+path,true);
  for(const path of ['/v2/','/v2/users','/v2/items?x=1','/v2/items/extra','/v2/orders/item/'+'x'.repeat(97)+'/top'])check(market,'https://api.warframe.market'+path,false);
});
