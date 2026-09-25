import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createWidgetChrome} from '../../tools/creator-kit/preview/chrome.mjs';
import {createServiceSimulator} from '../../tools/creator-kit/preview/services.mjs';
import {createStorageSimulator} from '../../tools/creator-kit/preview/storage.mjs';
import {simulateFetch} from '../../tools/creator-kit/preview/network.mjs';

const source = await readFile(new URL('../../tools/creator-kit/preview/app.js', import.meta.url), 'utf8');

// The real bootstrap, chrome and simulator run together; only browser transport and layout are supplied.
function preview() {
  const window = new EventTarget(), document = new EventTarget(), nodes = new Map();
  document.defaultView = window;
  Object.assign(window, {innerWidth:1200,innerHeight:900});
  class Element extends EventTarget {
    constructor() {
      super();this.style={setProperty(key,value){this[key]=value;}};
      this.value='';this.hidden=false;this.children=[];this.attributes=new Map();this.classList={toggle(){}};
      this.rect={left:0,top:0,width:480,height:320};
    }
    setAttribute(key,value){this.attributes.set(key,String(value));}
    getAttribute(key){return this.attributes.get(key);}
    removeAttribute(key){this.attributes.delete(key);}
    contains(node){return node===this;}
    focus(){document.activeElement=this;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    getBoundingClientRect(){if(this.hidden||(this.getAttribute('data-mode')==='passive'&&this.getAttribute('data-show-in-passive')==='false'))return {left:0,top:0,right:0,bottom:0,width:0,height:0};const width=Number.parseFloat(this.style.width)||this.rect.width,height=Number.parseFloat(this.style.height)||this.rect.height;return {...this.rect,width,height,right:this.rect.left+width,bottom:this.rect.top+height};}
  }
  document.createElement=()=>new Element();
  const el=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
  document.querySelector=el;
  el('#stage-surface').rect={left:0,top:0,width:1000,height:900};
  el('#widget-toolbar').rect={left:0,top:0,width:88,height:28};
  const messages=[];
  for(const role of ['view','controller'])el('#'+role).contentWindow={postMessage:value=>messages.push({role,...value})};
  const manifest={id:'com.example.first',entrypoints:{view:'index.html'},permissions:{},presentation:{sizing:{fitToContent:'both',preferred:{width:120,height:40},min:{width:24,height:12},max:{width:800,height:600}}}};
  let next={manifest,generation:1,config:{}},stream;
  const location={href:'http://localhost:1234/token/',origin:'http://localhost:1234'};
  const context=vm.createContext({window,document,location,URL,ArrayBuffer,createWidgetChrome,createServiceSimulator,createStorageSimulator,simulateFetch,
    fetch:async()=>({ok:true,json:async()=>structuredClone(next)}),
    EventSource:class{constructor(){stream=this;}close(){}},
  });
  vm.runInContext(source.replace(/^import .*;\n/gm,''), context);
  const fire=(target,type,properties={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,properties);target.dispatchEvent(event);};
  let requestId=0;
  function send(data) { fire(window,'message',{origin:location.origin,source:el('#view').contentWindow,data:{source:'overcrow-widget-preview',bridgeId:'view-document',...data}}); }
  const request=metadata=>{send({type:'request',id:++requestId,metadata});return messages.filter(message=>message.type==='reply').at(-1)?.response;};
  const snapshot=()=>request({type:'gameSnapshot'}).metadata.value;
  async function load(id=next.manifest.id, update=()=>{}) {
    next={...next,generation:next.generation+1,manifest:{...next.manifest,id}};
    update(next.manifest);
    stream.onmessage({data:JSON.stringify({generation:next.generation})});
    await new Promise(resolve=>setImmediate(resolve));
    send({type:'ready'});
  }
  return {el,fire,messages,request,snapshot,load,dispose:()=>fire(window,'pagehide')};
}

test('standalone preview publishes user sizing and preserves it across snapshots, sessions and reloads', async t => {
  const app=preview();t.after(app.dispose);await app.load();
  const fit=app.el('#options-menu').children.flatMap(group=>group.children).flatMap(row=>row.children).find(control=>control.getAttribute('aria-label')==='Ajuster au contenu');
  fit.checked=false;app.fire(fit,'change');
  app.fire(app.el('#widget-resize'),'keydown',{key:'ArrowDown',shiftKey:true});
  const data=()=>app.snapshot().services.snapshots.presentation.data;
  assert.deepEqual(data(),{sizingMode:'manual',width:120,height:50,options:{}});
  const hostEvents=app.messages.filter(message=>message.type==='event'&&message.event.type==='gameSnapshot');
  assert.deepEqual(hostEvents.at(-1).event.payload.services.snapshots.presentation.data,data());
  app.el('#session').value='active';app.fire(app.el('#session'),'change');
  assert.equal(data().sizingMode,'manual');assert.equal(data().height,50);
  await app.load();
  assert.deepEqual(data(),{sizingMode:'manual',width:120,height:50,options:{}});
  const response=app.request({type:'serviceAction',action:'presentation.reportSize',contextId:app.snapshot().services.contextId,parameters:{width:200,height:80}});
  assert.equal(response.metadata.ok,true);await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(data().height,50);
  fit.checked=true;app.fire(fit,'change');
  assert.deepEqual(data(),{sizingMode:'intrinsic',width:200,height:80,options:{}});
  await app.load('com.example.second');
  assert.deepEqual(data(),{sizingMode:'intrinsic',width:120,height:40,options:{}});
});


test('passive hidden reloads preserve manual frame dimensions and SDK geometry', async t => {
  const app=preview();t.after(app.dispose);await app.load();
  const fit=app.el('#options-menu').children.flatMap(group=>group.children).flatMap(row=>row.children).find(control=>control.getAttribute('aria-label')==='Ajuster au contenu');
  fit.checked=false;app.fire(fit,'change');
  for(let i=0;i<12;i++)app.fire(app.el('#widget-resize'),'keydown',{key:'ArrowRight',shiftKey:true});
  for(let i=0;i<14;i++)app.fire(app.el('#widget-resize'),'keydown',{key:'ArrowDown',shiftKey:true});
  app.fire(app.el('#widget-eye'),'click');
  app.el('#overlay-mode').value='passive';app.fire(app.el('#overlay-mode'),'change');
  assert.equal(app.el('#widget-host').getBoundingClientRect().width,0);
  await app.load(undefined, manifest=>{manifest.presentation.options=[{id:'details',type:'boolean',label:{en:'Details',fr:'Détails'},default:false}];});
  assert.deepEqual(app.snapshot().services.snapshots.presentation.data,{sizingMode:'manual',width:240,height:180,options:{details:false}});
  app.el('#session').value='active';app.fire(app.el('#session'),'change');
  assert.deepEqual(app.snapshot().services.snapshots.presentation.data,{sizingMode:'manual',width:240,height:180,options:{details:false}});
  assert.equal(app.el('#widget-host').style.width,'240px');assert.equal(app.el('#widget-host').style.height,'180px');
  app.el('#overlay-mode').value='interactive';app.fire(app.el('#overlay-mode'),'change');
  assert.equal(app.el('#widget-host').getBoundingClientRect().width,240);
  assert.equal(app.el('#widget-host').getBoundingClientRect().height,180);
});
