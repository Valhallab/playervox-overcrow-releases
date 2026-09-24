import test from 'node:test';
import assert from 'node:assert/strict';
import {createWidgetChrome} from '../../tools/creator-kit/preview/chrome.mjs';

// Minimal event/element surface: exercises the shipped handlers without a browser dependency.
class Element extends EventTarget {
  constructor(document) {
    super();this.ownerDocument=document;this.hidden=false;this.value='';this.style={setProperty(key,value){this[key]=value;}};
    this.attributes=new Map();this.textContent='';this.clientWidth=800;this.children=[];
    this.rect={left:100,right:580,top:300,bottom:620,width:480,height:320};
  }
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key);}
  removeAttribute(key){this.attributes.delete(key);}
  contains(node){return node===this;}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return this.rect;}
  setPointerCapture(){}
  releasePointerCapture(){}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
}
function setup(onModeChange, options, configure = () => {}) {
  const document=new EventTarget();document.defaultView=new EventTarget();
  Object.assign(document.defaultView,{innerWidth:1200,innerHeight:900});
  const nodes=new Map();
  document.createElement=()=>new Element(document);
  document.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element(document));return nodes.get(selector);};
  const el=selector=>document.querySelector(selector);
  const frameDocument=new EventTarget();el('#view').contentDocument=frameDocument;el('#view').src='view/index.html';
  el('#widget-toolbar').rect={left:492,right:580,top:266,bottom:294,width:88,height:28};
  configure(el);
  const chrome=createWidgetChrome(document,'fr',onModeChange,options);
  const fire=(target,type,properties={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,properties);target.dispatchEvent(event);return event;};
  return {document,el,chrome,fire,frameDocument};
}
test('host appearance updates live, preserves the content and survives view reloads',()=>{
  const {el,fire}=setup();const view=el('#view'),host=el('#widget-host');
  assert.equal(view.style.transform,'scale(1)');
  assert.equal(el('#widget-surface').style.backgroundColor,`rgba(17, 17, 20, ${238/255})`);
  fire(el('#widget-options'),'click');fire(el('#option-scale'),'click');
  const slider=el('#option-range');slider.value='150';fire(slider,'input');
  assert.equal(view.style.transform,'scale(1.5)');assert.equal(view.style.width,`${100/1.5}%`);
  assert.equal(view.style.height,`${100/1.5}%`);assert.equal(el('#value-scale').textContent,'150%');
  fire(el('#option-opacity'),'click');slider.value='80';fire(slider,'input');
  assert.equal(el('#widget-surface').style.backgroundColor,`rgba(17, 17, 20, ${238/255*0.8})`);
  assert.equal(view.style.opacity,undefined);assert.equal(host.style.transform,undefined);
  assert.equal(view.src,'view/index.html');
  fire(view,'load');
  assert.equal(view.style.transform,'scale(1.5)');
  assert.equal(el('#value-opacity').textContent,'80%');
});
test('percentage typing commits on Enter or blur, restores invalid values and clamps native bounds',()=>{
  const {el,fire}=setup();fire(el('#widget-options'),'click');fire(el('#option-scale'),'click');
  const input=el('#option-number');input.value='1';fire(input,'input');
  assert.equal(el('#view').style.transform,'scale(1)');
  input.value='12x-3';fire(input,'input');assert.equal(input.value,'123');
  input.value='150';fire(input,'keydown',{key:'Enter'});assert.equal(el('#value-scale').textContent,'150%');
  for(const value of ['', 'abc', 'Infinity']) {
    input.value=value;fire(input,'blur');assert.equal(input.value,'150');
  }
  input.value='999';fire(input,'blur');assert.equal(input.value,'175');
  input.value='20';fire(input,'blur');assert.equal(input.value,'50');
  fire(el('#option-opacity'),'click');input.value='105';fire(input,'blur');assert.equal(input.value,'100');
  input.value='-2';fire(input,'blur');assert.equal(input.value,'0');
});
test('options close on Escape, outside interaction and widget interaction; close stays illustrative',()=>{
  const {document,el,fire,frameDocument}=setup();
  fire(el('#widget-options'),'click');assert.equal(el('#widget-options').getAttribute('aria-expanded'),'true');
  fire(el('#option-scale'),'click');assert.equal(el('#option-editor').hidden,false);
  fire(document,'keydown',{key:'Escape'});assert.equal(el('#option-editor').hidden,true);
  assert.equal(document.activeElement,el('#option-scale'));assert.equal(el('#options-menu').hidden,false);
  fire(document,'keydown',{key:'Escape'});assert.equal(el('#options-menu').hidden,true);
  assert.equal(document.activeElement,el('#widget-options'));
  fire(el('#widget-options'),'click');fire(document,'pointerdown');assert.equal(el('#options-menu').hidden,true);
  fire(el('#view'),'load');fire(el('#widget-options'),'click');fire(frameDocument,'pointerdown');
  assert.equal(el('#options-menu').hidden,true);
  fire(el('#widget-eye'),'click');fire(el('#widget-close'),'click');assert.equal(el('#widget-host').hidden,false);
});
test('eye sets passive visibility independently of mode without reloading the widget',()=>{
  const changes=[], visibility=[];
  const {el,fire,chrome}=setup(mode=>changes.push(mode),{onVisibilityChange:visible=>visibility.push(visible)});
  fire(el('#widget-options'),'click');fire(el('#option-scale'),'click');
  chrome.setMode('interactive');assert.equal(el('#option-editor').hidden,false);
  fire(el('#widget-eye'),'click');
  assert.equal(chrome.mode,'interactive');assert.equal(el('#overlay-mode').value,'interactive');
  assert.equal(chrome.showInPassive,false);assert.equal(chrome.visible,true);
  assert.equal(el('#view').inert,false);assert.deepEqual(changes,[]);
  el('#overlay-mode').value='passive';fire(el('#overlay-mode'),'change');
  assert.equal(chrome.visible,false);assert.equal(el('#view').inert,true);
  assert.equal(el('#view').src,'view/index.html');assert.equal(el('#option-editor').hidden,true);
  assert.equal(el('#widget-move').disabled,true);assert.equal(el('#widget-resize').disabled,true);
  el('#overlay-mode').value='interactive';fire(el('#overlay-mode'),'change');
  assert.equal(chrome.visible,true);assert.equal(el('#view').inert,false);
  assert.equal(el('#widget-eye').getAttribute('aria-pressed'),'false');
  assert.deepEqual(changes,['passive','interactive']);assert.deepEqual(visibility,[false,true]);
});
test('automatic sizing prevents pointer and keyboard resizing until explicitly disabled',()=>{
  const {el,fire,chrome}=setup(undefined,{autoSize:true});
  const grip=el('#widget-resize'),host=el('#widget-host');
  assert.equal(grip.hidden,true);assert.equal(grip.disabled,true);
  el('#stage-surface').rect={left:0,right:900,top:0,bottom:1200,width:900,height:1200};
  fire(grip,'pointerdown',{button:0,pointerId:1,clientX:580,clientY:620});
  fire(grip,'pointermove',{pointerId:1,clientX:600,clientY:650});
  fire(grip,'keydown',{key:'ArrowDown'});
  assert.equal(host.style.width,undefined);assert.equal(host.style.height,undefined);
  chrome.setAutoSize(false);
  assert.equal(grip.hidden,false);assert.equal(grip.disabled,false);
  fire(grip,'keydown',{key:'ArrowDown'});assert.equal(host.style.height,'321px');
});

const presentation=mode=>({sizing:{mode,preferred:{width:120,height:40},min:{width:24,height:12},max:{width:800,height:600}},options:[{id:'showArtist',type:'boolean',label:{en:'Show artist',fr:'Afficher l’artiste'},default:true}]});
test('chrome keeps intrinsic fixed, auto height horizontal, and scales CSS reports once',async()=>{
  const {el,fire,chrome}=setup(undefined,undefined,el=>{el('#stage-surface').rect={left:0,right:1000,top:0,bottom:900,width:1000,height:900};});
  chrome.setPresentation(presentation('intrinsic'));
  assert.equal(el('#widget-host').style.width,'120px');assert.equal(el('#widget-host').style.height,'40px');
  assert.equal(el('#widget-resize').hidden,true);
  chrome.reportSize({width:160,height:60});await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(el('#widget-host').style.width,'160px');assert.equal(el('#widget-host').style.height,'60px');
  fire(el('#widget-options'),'click');fire(el('#option-scale'),'click');el('#option-range').value='150';fire(el('#option-range'),'input');
  assert.equal(el('#widget-host').style.width,'240px');assert.equal(el('#widget-host').style.height,'90px');
  chrome.reportSize({width:160,height:60});await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(el('#widget-host').style.height,'90px');
  chrome.setPresentation(presentation('autoHeight'));
  assert.equal(el('#widget-resize').hidden,false);
  const height=el('#widget-host').style.height;
  fire(el('#widget-resize'),'keydown',{key:'ArrowDown'});
  assert.equal(el('#widget-host').style.height,height);
  assert.equal(el('#widget-host').getAttribute('data-sizing-mode'),'autoHeight');
  chrome.dispose();
});

test('native preview options are localized, bounded and disabled in passive mode',()=>{
  const changes=[];
  const {el,fire,chrome}=setup(undefined,{onOptionChange:(key,value)=>changes.push([key,value])});
  chrome.setPresentation(presentation('manual'));
  const options=el('#options-menu').children.at(-1);
  const control=options.children[0].children[1];
  assert.equal(control.getAttribute('aria-label'),'Afficher l’artiste');
  control.checked=false;fire(control,'change');assert.deepEqual(changes,[['showArtist',false]]);
  chrome.setMode('passive');control.checked=true;fire(control,'change');
  assert.equal(changes.length,1);assert.equal(control.disabled,true);
  chrome.dispose();
});
test('passive mode cancels gestures and blocks programmatic move or resize events',()=>{
  const {el,fire,chrome}=setup();
  const grip=el('#widget-resize'),move=el('#widget-move'),host=el('#widget-host');
  fire(grip,'pointerdown',{button:0,pointerId:1,clientX:580,clientY:620});
  fire(move,'pointerdown',{button:0,pointerId:2,clientX:150,clientY:320});
  chrome.setMode('passive');
  fire(grip,'pointermove',{pointerId:1,clientX:600,clientY:650});
  fire(move,'pointermove',{pointerId:2,clientX:190,clientY:350});
  for(const control of [grip,move])fire(control,'keydown',{key:'ArrowRight'});
  assert.equal(host.style.left,undefined);assert.equal(host.style.width,undefined);
  chrome.setMode('interactive');
  const restored = {left:host.style.left,top:host.style.top,width:host.style.width,height:host.style.height};
  fire(grip,'pointermove',{pointerId:1,clientX:600,clientY:650});
  fire(move,'pointermove',{pointerId:2,clientX:190,clientY:350});
  assert.deepEqual({left:host.style.left,top:host.style.top,width:host.style.width,height:host.style.height},restored);
});
test('host resizing leaves content zoom unchanged and respects native size limits',()=>{
  const {el,fire}=setup();const grip=el('#widget-resize'),host=el('#widget-host');
  el('#stage-surface').rect={left:0,right:900,top:0,bottom:1200,width:900,height:1200};
  fire(grip,'pointerdown',{button:0,pointerId:1,clientX:580,clientY:620});
  fire(grip,'pointermove',{pointerId:1,clientX:1000,clientY:2000});
  assert.equal(host.style.width,'800px');assert.equal(host.style.height,'900px');
  fire(grip,'pointerup',{pointerId:1});
  fire(grip,'pointerdown',{button:0,pointerId:2,clientX:580,clientY:620});
  fire(grip,'pointermove',{pointerId:2,clientX:0,clientY:0});
  assert.equal(host.style.width,'280px');assert.equal(host.style.height,'160px');
  assert.equal(el('#view').style.transform,'scale(1)');
});
test('a stacked editor remains on scale while the pointer crosses the opacity row to reach its slider',()=>{
  const {document,el,fire}=setup();document.defaultView.innerWidth=360;
  el('#widget-options').rect={left:288,top:266,right:316,bottom:294,width:28,height:28};
  el('#options-menu').rect={left:100,top:300,right:324,bottom:360,width:224,height:60};
  el('#option-editor').rect={left:0,top:0,right:224,bottom:72,width:224,height:72};
  fire(el('#widget-options'),'click');fire(el('#option-scale'),'pointerenter');
  assert.equal(el('#option-editor').style.top,'366px');
  fire(el('#option-opacity'),'pointerenter');
  assert.equal(el('#option-editor').getAttribute('aria-label'),'Taille du contenu');
  el('#option-range').value='125';fire(el('#option-range'),'input');
  assert.equal(el('#value-scale').textContent,'125%');assert.equal(el('#value-opacity').textContent,'100%');
  fire(el('#option-opacity'),'click');assert.equal(el('#option-editor').getAttribute('aria-label'),'Opacité du fond');
});
test('widget moves by its native top strip and stays inside the preview surface',()=>{
  const {el,fire}=setup(),host=el('#widget-host'),move=el('#widget-move'),stage=el('#stage-surface');
  stage.rect={left:0,right:800,top:0,bottom:700,width:800,height:700};
  fire(move,'pointerdown',{button:0,pointerId:4,clientX:150,clientY:320});
  fire(move,'pointermove',{pointerId:4,clientX:190,clientY:350});
  assert.equal(host.style.left,'140px');assert.equal(host.style.top,'330px');
  fire(move,'pointermove',{pointerId:4,clientX:1200,clientY:1200});
  assert.equal(host.style.left,'320px');assert.equal(host.style.top,'380px');
  fire(move,'pointerup',{pointerId:4});
  fire(move,'keydown',{key:'ArrowLeft'});
  assert.equal(host.style.left,'319px');assert.equal(host.style.top,'380px');
});

for(const {name,widget,left,top,bridgeTop,bridgeHeight} of [
  {name:'prefers above when both sides fit',widget:{left:200,top:300,width:480,height:160},left:392,top:-34,bridgeTop:-34,bridgeHeight:34},
  {name:'fits exactly against the top stage boundary',widget:{left:200,top:134,width:480,height:160},left:392,top:-34,bridgeTop:-34,bridgeHeight:34},
  {name:'moves below when above is one pixel too short',widget:{left:200,top:133,width:480,height:160},left:392,top:166,bridgeTop:160,bridgeHeight:34},
  {name:'moves below a widget flush with the top edge',widget:{left:200,top:100,width:480,height:160},left:392,top:166,bridgeTop:160,bridgeHeight:34},
  {name:'stays above a widget flush with the bottom edge',widget:{left:200,top:540,width:480,height:160},left:392,top:-34,bridgeTop:-34,bridgeHeight:34},
  {name:'moves inside a widget spanning the stage height',widget:{left:200,top:100,width:480,height:600},left:392,top:6,bridgeTop:6,bridgeHeight:28},
  {name:'shifts right for a narrow widget at the left edge',widget:{left:50,top:300,width:40,height:160},left:0,top:-34,bridgeTop:-34,bridgeHeight:34},
  {name:'stays inside the right edge for a narrow widget',widget:{left:810,top:300,width:40,height:160},left:-48,top:-34,bridgeTop:-34,bridgeHeight:34},
]) {
  test(`toolbar ${name}`,()=>{
    const {el,chrome}=setup(undefined,undefined,el=>{
      el('#stage-surface').rect={left:50,right:850,top:100,bottom:700,width:800,height:600};
      el('#widget-host').rect={...widget,right:widget.left+widget.width,bottom:widget.top+widget.height};
    });
    chrome.fitToStage();
    const style=el('#widget-host').style;
    assert.equal(style['--widget-toolbar-left'],`${left}px`);
    assert.equal(style['--widget-toolbar-top'],`${top}px`);
    assert.equal(style['--widget-toolbar-bridge-top'],`${bridgeTop}px`);
    assert.equal(style['--widget-toolbar-bridge-height'],`${bridgeHeight}px`);
  });
}

test('toolbar is bounded on first render and follows a changing stage without moving open appearance controls',()=>{
  const {document,el,fire,chrome}=setup(undefined,undefined,el=>{
    el('#stage-surface').rect={left:50,right:850,top:100,bottom:700,width:800,height:600};
    el('#widget-host').rect={left:200,right:680,top:100,bottom:260,width:480,height:160};
  });
  const host=el('#widget-host');
  assert.equal(host.style['--widget-toolbar-top'],'166px');
  fire(el('#widget-options'),'click');fire(el('#option-scale'),'click');
  const controls=[el('#options-menu'),el('#option-editor')];
  const positions=controls.map(control=>({left:control.style.left,top:control.style.top}));
  el('#widget-options').rect={left:620,right:648,top:266,bottom:294,width:28,height:28};
  el('#stage-surface').rect={left:50,right:850,top:50,bottom:650,width:800,height:600};
  chrome.fitToStage();
  assert.equal(host.style['--widget-toolbar-top'],'-34px');
  assert.deepEqual(controls.map(control=>({left:control.style.left,top:control.style.top})),positions);
  assert.equal(el('#option-editor').hidden,false);
  el('#stage-surface').rect={left:50,right:850,top:100,bottom:300,width:800,height:200};
  fire(document.defaultView,'resize');
  assert.equal(host.style['--widget-toolbar-top'],'166px');
});

test('widget display controls dismiss the appearance submenu without closing their menu',()=>{
  const {el,fire}=setup();
  fire(el('#widget-options'),'click');
  fire(el('#option-scale'),'pointerenter');
  assert.equal(el('#option-editor').hidden,false);
  fire(el('#display-options'),'focusin');
  assert.equal(el('#option-editor').hidden,true);
  assert.equal(el('#options-menu').hidden,false);
});

test('scoped widget controls stay independent and remove their handlers on disposal',()=>{
  const first=setup();
  const nodes=new Map();
  const query=selector=>{
    if(!nodes.has(selector)) nodes.set(selector,new Element(first.document));
    return nodes.get(selector);
  };
  const second=createWidgetChrome(first.document,'en',undefined,{query,minimumWidth:100,minimumHeight:40});
  first.fire(query('#widget-eye'),'click');
  assert.equal(second.mode,'interactive');
  assert.equal(second.showInPassive,false);
  assert.equal(first.chrome.mode,'interactive');
  query('#stage-surface').rect={left:0,right:900,top:0,bottom:1200,width:900,height:1200};
  first.fire(query('#widget-resize'),'pointerdown',{button:0,pointerId:1,clientX:580,clientY:620});
  first.fire(query('#widget-resize'),'pointermove',{pointerId:1,clientX:0,clientY:0});
  assert.equal(query('#widget-host').style.width,'100px');
  assert.equal(query('#widget-host').style.height,'40px');
  second.dispose();
  first.fire(query('#widget-eye'),'click');
  first.fire(query('#widget-options'),'click');
  assert.equal(second.mode,'interactive');
  assert.equal(second.showInPassive,false);
  assert.equal(query('#options-menu').hidden,true);
  first.fire(first.el('#widget-eye'),'click');
  assert.equal(first.chrome.mode,'interactive');
  assert.equal(first.chrome.showInPassive,false);
});
