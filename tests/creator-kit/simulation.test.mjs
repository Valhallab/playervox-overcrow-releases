import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {simulateFetch} from '../../tools/creator-kit/preview/network.mjs';
const source=await readFile(new URL('../../tools/creator-kit/preview/bridge.js',import.meta.url),'utf8');
function storage() {
  const data=new Map();
  return {get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()};
}
function bridge(enabled,id='com.example.one',shared=storage()) {
  const messages=[],events=new Map(),operations=[];
  const parent={postMessage(message){messages.push(message);}};
  const context=vm.createContext({URL,DOMException,ArrayBuffer,Promise,Map,Set,Object,setTimeout,clearTimeout,
    location:{pathname:'/token/view/index.html',origin:'http://127.0.0.1:4175'},parent,
    document:{currentScript:{src:`http://127.0.0.1:4175/token/bridge.js?id=${id}&storage=${enabled?1:0}`}},
    localStorage:shared,sessionStorage:storage(),indexedDB:{open:(...args)=>operations.push(args),deleteDatabase:(...args)=>operations.push(args),cmp:(a,b)=>a<b?-1:a>b?1:0,databases:async()=>[{name:'overcrow-preview:com.example.one:test',version:1},{name:'other',version:1}]},
    addEventListener(name,handler){events.set(name,handler);}});
  context.window=context;vm.runInContext(source,context);
  return {context,messages,events,parent,operations};
}
test('simulation uses declared permissions and fixtures without external requests',()=>{
  const permissions={network:[{origin:'https://api.example.com',method:'GET',pathPrefix:'/v2/'}]};
  const fixtures=[{url:'https://api.example.com/v2/items',status:200,json:{data:[{name:'example'}]}},{url:'https://api.example.com/v2/broken',status:503,text:'Unavailable'}];
  const success=simulateFetch(permissions,fixtures,{url:fixtures[0].url,method:'GET'});
  assert.equal(success.metadata.status,200);assert.deepEqual(JSON.parse(new TextDecoder().decode(success.body)),fixtures[0].json);
  assert.equal(simulateFetch(permissions,fixtures,{url:fixtures[1].url,method:'GET'}).metadata.status,503);
  assert.equal(simulateFetch(permissions,fixtures,{url:'https://api.example.com/v2/missing',method:'GET'}).metadata.error.code,'fixture_missing');
  for(const url of ['http://api.example.com/v2/items','https://user:secret@api.example.com/v2/items','https://api.example.com/v2/%2fsecret','https://api.example.com/v3/items'])assert.equal(simulateFetch(permissions,fixtures,{url,method:'GET'}).metadata.error.code,'capability_denied');
  assert.equal(simulateFetch(permissions,fixtures,{url:fixtures[0].url,method:'POST'}).metadata.error.code,'capability_denied');
  const exact={network:[{origin:'https://api.example.com',method:'GET',pathPrefix:'/v2/items'}]};
  assert.equal(simulateFetch(exact,fixtures,{url:fixtures[0].url,method:'GET'}).metadata.status,200);
  assert.equal(simulateFetch(exact,fixtures,{url:'https://api.example.com/v2/items/other',method:'GET'}).metadata.error.code,'capability_denied');
});
test('browser storage simulation is permission gated and namespaced per widget',async()=>{
  const denied=bridge(false);assert.throws(()=>denied.context.localStorage.getItem('test'),e=>e.name==='SecurityError');
  assert.throws(()=>denied.context.indexedDB,e=>e.name==='SecurityError');
  const shared=storage(),first=bridge(true,'com.example.one',shared),second=bridge(true,'com.example.two',shared);
  first.context.localStorage.setItem('test','first');second.context.localStorage.setItem('test','second');
  assert.equal(first.context.localStorage.getItem('test'),'first');assert.equal(second.context.localStorage.getItem('test'),'second');
  first.context.localStorage.clear();assert.equal(second.context.localStorage.length,1);
  first.context.indexedDB.open('test',2);assert.deepEqual(first.operations[0],['overcrow-preview:com.example.one:test',2]);
  const databases=await first.context.indexedDB.databases();assert.equal(databases.length,1);assert.equal(databases[0].name,'test');
});
test('preview bridge accepts only its parent, correlates requests and removes subscriptions',async()=>{
  const {context,messages,events,parent}=bridge(false),native=context.__overcrowNative;
  const received=[];const off=native.subscribe(event=>received.push(event));
  assert.equal(messages[0].type,'ready');
  events.get('message')({source:{},origin:context.location.origin,data:{source:'overcrow-creator',type:'event',event:{type:'visibility',visible:false}}});
  assert.equal(received.length,0);
  const deliver=data=>events.get('message')({source:parent,origin:context.location.origin,data:{source:'overcrow-creator',...data}});
  deliver({type:'event',event:{type:'gameSnapshot',payload:{running:false}}});off();deliver({type:'event',event:{type:'visibility',visible:true}});assert.equal(received.length,1);
  const promise=native.request({type:'gameSnapshot'},new ArrayBuffer(0));const request=messages.at(-1);
  const response={metadata:{ok:true,value:{running:false}},body:new ArrayBuffer(0)};
  deliver({type:'reply',id:request.id,response});assert.equal(await promise,response);
});
