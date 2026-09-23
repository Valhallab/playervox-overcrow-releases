// MIT License. Copyright (c) 2026 Valhallab SASU.
// Injected by the preview server only. This file is never part of widget/.
(() => {
  const role=location.pathname.split('/')[2];
  const parameters=new URL(document.currentScript.src).searchParams;
  const prefix='overcrow-preview:'+parameters.get('id')+':';
  const denied=()=>{throw new DOMException('Storage permission is not declared.','SecurityError');};
  if(parameters.get('storage')!=='1') {
    for(const name of ['localStorage','sessionStorage','indexedDB'])Object.defineProperty(globalThis,name,{get:denied});
  } else {
    for(const name of ['localStorage','sessionStorage']) {
      const original=globalThis[name];
      const keys=()=>Array.from({length:original.length},(_,i)=>original.key(i)).filter(key=>key?.startsWith(prefix));
      const scoped={get length(){return keys().length;},key:index=>keys()[Number(index)]?.slice(prefix.length)??null,
        getItem:key=>original.getItem(prefix+key),setItem:(key,value)=>original.setItem(prefix+key,value),
        removeItem:key=>original.removeItem(prefix+key),clear:()=>keys().forEach(key=>original.removeItem(key))};
      Object.defineProperty(globalThis,name,{value:Object.freeze(scoped)});
    }
    const original=globalThis.indexedDB;
    Object.defineProperty(globalThis,'indexedDB',{value:Object.freeze({
      open:(name,version)=>version===undefined?original.open(prefix+name):original.open(prefix+name,version),
      deleteDatabase:name=>original.deleteDatabase(prefix+name),cmp:original.cmp.bind(original),
      databases:async()=> (await original.databases()).filter(item=>item.name?.startsWith(prefix)).map(item=>({...item,name:item.name.slice(prefix.length)}))
    })});
  }
  const listeners=new Set(),pending=new Map();let sequence=0;
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==location.origin||event.data?.source!=='overcrow-creator')return;
    const message=event.data;
    if(message.type==='reply') {
      const request=pending.get(message.id);if(!request)return;
      pending.delete(message.id);clearTimeout(request.timer);request.resolve(message.response);
    } else if(message.type==='event')for(const listener of [...listeners])listener(message.event);
  });
  Object.defineProperty(globalThis,'__overcrowNative',{value:Object.freeze({role,
    request(metadata,body){
      if(pending.size>=32)return Promise.resolve({metadata:{ok:false,error:{code:'busy',message:'Preview request limit reached'}},body:new ArrayBuffer(0)});
      return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Preview did not respond'));},5000);pending.set(id,{resolve,timer});parent.postMessage({source:'overcrow-widget-preview',type:'request',id,metadata,body},location.origin);});
    },
    subscribe(listener){listeners.add(listener);parent.postMessage({source:'overcrow-widget-preview',type:'ready'},location.origin);return()=>listeners.delete(listener);}
  })});
  window.addEventListener('error',event=>parent.postMessage({source:'overcrow-widget-preview',type:'error',message:event.message},location.origin));
  window.addEventListener('unhandledrejection',()=>parent.postMessage({source:'overcrow-widget-preview',type:'error',message:'Promesse rejetée sans traitement. Consultez la console du navigateur.'},location.origin));
})();
