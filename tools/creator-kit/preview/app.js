// MIT License. Copyright (c) 2026 Valhallab SASU.
import {simulateFetch} from './network.mjs';
import {createWidgetChrome} from './chrome.mjs';
import {createServiceSimulator} from './services.mjs';
import {createStorageSimulator} from './storage.mjs';
const base=new URL('./',location.href).pathname;
const view=document.querySelector('#view'),controller=document.querySelector('#controller');
const status=document.querySelector('#status'),locale=document.querySelector('#locale');
let state,snapshot,services,generation=0,loading=0;
let storage=createStorageSimulator();
const chrome=createWidgetChrome(document,'fr',mode=>{
  snapshot=services?.snapshot({...snapshot,overlayMode:mode})??{...snapshot,overlayMode:mode};
  publish(snapshot);
},{onVisibilityChange:visible=>{for(const frame of [view,controller])send(frame,{type:'visibility',visible});},onOptionChange:(key,value)=>services?.setOption(key,value),onPresentationChange:value=>services?.setPresentation(value)});
const ready={view:false,controller:false},queued={view:[],controller:[]};
const bridges={view:null,controller:null};
const empty=()=>new ArrayBuffer(0);
const send=(frame,event)=>frame.contentWindow?.postMessage({source:'overcrow-creator',type:'event',event},location.origin);
function publish(next) {
  snapshot=next;
  chrome.setPresentation(state?.manifest.presentation,snapshot?.services?.snapshots.presentation?.data?.options??{});
  if(snapshot!==next||services?.setPresentation(chrome.presentationState))return;
  for(const frame of [view,controller])send(frame,{type:'gameSnapshot',payload:snapshot});
}
function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function sessionSnapshot(active){return {running:active,selectedActive:active,steamAppId:active?230410:null,sessionElapsedMs:active?300000:null,overlayMode:chrome.mode};}
async function load() {
  const request=++loading;
  const response=await fetch(base+'state.json');if(!response.ok)throw new Error('Aperçu indisponible.');
  const next=await response.json();if(request!==loading)return;
  const changedWidget=state?.manifest.id!==next.manifest.id;
  state=next;generation=state.generation;
  storage=createStorageSimulator();
  services?.dispose();
  services=createServiceSimulator({manifest:state.manifest,fixture:state.config.services??{},onSnapshot:publish,onSize:size=>chrome.reportSize(size)});
  ready.view=false;ready.controller=false;queued.view=[];queued.controller=[];
  bridges.view=bridges.controller=null;
  snapshot=services.snapshot({...(state.config.snapshot??sessionSnapshot(document.querySelector('#session').value==='active')),overlayMode:chrome.mode});
  chrome.setPresentation(state.manifest.presentation,snapshot.services?.snapshots.presentation?.data?.options??{},{reset:changedWidget});
  services.setPresentation(chrome.presentationState);
  const previousLocale=locale.value,locales=state.manifest.localization?.availableLocales??[];locale.replaceChildren();
  for(const value of locales.length?locales:['Non déclarée']){const option=document.createElement('option');option.value=locales.length?value:'';option.textContent=value;locale.append(option);}
  locale.value=locales.includes(previousLocale)?previousLocale:state.manifest.localization?.defaultLocale??'';locale.disabled=!locales.length;
  // Controller is loaded first; application hello/state protocols must handle startup.
  if(state.manifest.entrypoints.controller)controller.src=base+'controller/'+state.manifest.entrypoints.controller;
  else controller.removeAttribute('src');
  view.src=base+'view/'+state.manifest.entrypoints.view;
  message(`Version ${generation} prête · données SDK temporaires · ${state.manifest.id}`);
}
function failure(code,text){return {metadata:{ok:false,error:{code,message:text}},body:empty()};}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.data?.source!=='overcrow-widget-preview')return;
  const role=event.source===view.contentWindow?'view':event.source===controller.contentWindow?'controller':null;
  if(!role||!state)return;
  const data=event.data;
  if(data.type==='error'){message(data.message,true);return;}
  if(data.type==='ready'){bridges[role]=data.bridgeId;ready[role]=true;const frame=role==='view'?view:controller;for(const item of queued[role])send(frame,item);queued[role]=[];send(frame,{type:'visibility',visible:chrome.visible});return;}
  if(data.type!=='request'||!Number.isSafeInteger(data.id)||!data.metadata)return;
  if(!ready[role]||data.bridgeId!==bridges[role])return;
  const meta=data.metadata;let response;
  if(meta.type==='gameSnapshot')response={metadata:{ok:true,value:services.snapshot(snapshot)},body:empty()};
  else if(meta.type==='storage')response=storage(meta);
  else if(meta.type==='serviceAction')response=services.request(meta,{role,interactive:chrome.mode==='interactive'});
  else if(meta.type==='locale')response={metadata:{ok:true,value:locale.value||null},body:empty()};
  else if(meta.type==='invalidate')response={metadata:{ok:true},body:empty()};
  else if(meta.type==='relay') {
    const other=role==='view'?'controller':'view',target=other==='view'?view:controller;
    const relay={type:'relay',source:role,payload:meta.payload};
    if(queued[other].length>=32)response=failure('busy','Preview relay queue is full.');
    else {
      if(role==='controller'||state.manifest.entrypoints.controller){if(ready[other])send(target,relay);else queued[other].push(relay);}
      response={metadata:{ok:true},body:empty()};
    }
  } else if(meta.type==='clipboardWrite')response=failure('permission_denied','Clipboard gestures must be tested in OverCrow, not the browser simulator.');
  else if(meta.type==='fetch') {
    response=simulateFetch(state.manifest.permissions,state.config.responses??[],meta);
    if(response.metadata.error?.code==='fixture_missing')message('Réponse absente de preview.json : ajoutez une fixture pour cette méthode et cette URL.',true);
  } else response=failure('invalid_request','Unsupported preview operation.');
  event.source.postMessage({source:'overcrow-creator',type:'reply',id:data.id,response,bridgeId:data.bridgeId},location.origin);
});
document.querySelector('#session').addEventListener('change',event=>{
  storage=createStorageSimulator();
  snapshot=sessionSnapshot(event.target.value==='active');services.snapshot(snapshot);services.setContext();
});
locale.addEventListener('change',()=>{for(const frame of [view,controller])send(frame,{type:'localeChanged',locale:locale.value||null});});
document.querySelector('#reload').addEventListener('click',()=>load().catch(error=>message(error.message,true)));
const stream=new EventSource(base+'events');
stream.onmessage=event=>{const update=JSON.parse(event.data);if(update.error)message(`${update.error.message} ${update.error.action}`,true);else if(update.generation!==generation)load().catch(error=>message(error.message,true));else if(update.ok)message(`Version ${generation} prête · données SDK temporaires · ${state?.manifest.id??''}`);};
stream.onerror=()=>message('Connexion à l’aperçu interrompue. Vérifiez le terminal ; reconnexion automatique.',true);
window.addEventListener('pagehide',()=>{stream.close();services?.dispose();chrome.dispose();},{once:true});
