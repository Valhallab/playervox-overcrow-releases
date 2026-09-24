// MIT License. Copyright (c) 2026 Valhallab SASU.
import {createServer} from 'node:http';
import {watch} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collect,readRegular,diagnostic} from './bundle.mjs';
import {parseJson,fail} from './manifest.mjs';
import {CAPABILITIES,READ_CAPABILITIES} from '../preview/service-fixtures.mjs';
const assets=fileURLToPath(new URL('../preview/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.woff2':'font/woff2','.wasm':'application/wasm'};
const csp="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
async function fixtures(project) {
  let raw;
  try{raw=await readRegular(path.join(project,'preview.json'),1024*1024);}catch(error){if(error.code==='ENOENT')return {};throw error;}
  const config=parseJson(raw.toString('utf8'));
  if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!['snapshot','responses','services'].includes(key)))fail('preview.fixture','preview.json est invalide.','Utilisez les champs snapshot, services et responses.');
  if(config.snapshot!==undefined&&(!config.snapshot||typeof config.snapshot!=='object'||Array.isArray(config.snapshot)))fail('preview.fixture','snapshot doit être un objet.','Utilisez les champs natifs documentés.');
  if(config.services!==undefined) {
    const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),services=config.services;
    const invalid=()=>fail('preview.fixture','Services simulés invalides.','Utilisez des capacités connues et des enveloppes {status,data}, sans contexte ou révision manuels.');
    if(!object(services)||Object.keys(services).some(key=>!['capabilities','snapshots'].includes(key)))invalid();
    if(services.capabilities!==undefined) {
      if(!object(services.capabilities))invalid();
      for(const [name,flags] of Object.entries(services.capabilities))if(!CAPABILITIES.includes(name)||!object(flags)||Object.keys(flags).some(key=>!['supported','granted'].includes(key))||Object.values(flags).some(value=>typeof value!=='boolean'))invalid();
    }
    if(services.snapshots!==undefined) {
      if(!object(services.snapshots))invalid();
      for(const [name,envelope] of Object.entries(services.snapshots)) {
        if(!Object.hasOwn(READ_CAPABILITIES,name)||!object(envelope)||Object.keys(envelope).some(key=>!['status','data','sampleAgeMs'].includes(key))||!['ready','stale','unavailable','unsupported','permissionDenied'].includes(envelope.status))invalid();
        if(envelope.status==='ready'?!object(envelope.data):envelope.status==='stale'?envelope.data!==null&&!object(envelope.data):envelope.data!==null)invalid();
        for(const key of ['sampleAgeMs'])if(Object.hasOwn(envelope,key)&&(!Number.isSafeInteger(envelope[key])||envelope[key]<0))invalid();
      }
    }
  }
  const responses=config.responses??[];
  if(!Array.isArray(responses)||responses.length>64)fail('preview.fixture','Au maximum 64 réponses simulées.','Réduisez responses.');
  const seen=new Set();
  for(const response of responses) {
    if(!response||typeof response!=='object'||typeof response.url!=='string'||!['GET','POST','PUT','PATCH','DELETE'].includes(response.method??'GET')||!Number.isInteger(response.status)||response.status<100||response.status>599||Object.hasOwn(response,'json')===Object.hasOwn(response,'text')||(Object.hasOwn(response,'text')&&typeof response.text!=='string'))fail('preview.fixture','Réponse simulée invalide.','Chaque réponse doit avoir url, status et soit json, soit text ; method vaut GET par défaut.');
    const key=(response.method??'GET')+' '+response.url;
    if(seen.has(key))fail('preview.fixture','Réponse simulée dupliquée.','Gardez une réponse par méthode et URL.');seen.add(key);
  }
  return config;
}
export async function startPreview(project,port=4175) {
  project=path.resolve(project);
  let bundle=await collect(project),config=await fixtures(project),generation=1,closed=false,timer,building=false,dirty=false;
  const permissions=JSON.stringify(bundle.manifest.permissions);
  const base=`/${randomBytes(16).toString('hex')}/`;
  const clients=new Set(),staticFiles=new Map();
  for(const name of ['index.html','app.js','bridge.js','network.mjs','services.mjs','storage.mjs','service-fixtures.mjs','chrome.mjs','chrome-messages.mjs','styles.css','NotoSansUI-Regular.ttf'])staticFiles.set(name,await readFile(path.join(assets,name)));
  const publish=value=>{for(const client of clients){if(!client.write(`data: ${JSON.stringify(value)}\n\n`)){clients.delete(client);client.end();}}};
  const state=()=>({manifest:bundle.manifest,config,generation});
  const server=createServer((request,response)=>{
    const host=`127.0.0.1:${server.address().port}`;
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',csp);response.setHeader('Referrer-Policy','no-referrer');
    if(request.headers.host!==host||(request.headers.origin&&request.headers.origin!==`http://${host}`)||!['GET','HEAD'].includes(request.method)) {response.writeHead(403);response.end('Forbidden');return;}
    let pathname;try{pathname=decodeURIComponent(new URL(request.url,`http://${host}`).pathname);}catch{response.writeHead(400);response.end();return;}
    if(!pathname.startsWith(base)){response.writeHead(404);response.end();return;}
    const relative=pathname.slice(base.length);
    if(relative==='events'&&request.method==='GET') {
      if(clients.size>=16){response.writeHead(429);response.end();return;}
      response.writeHead(200,{'Content-Type':'text/event-stream'});response.write(`data: ${JSON.stringify({generation})}\n\n`);clients.add(response);request.on('close',()=>clients.delete(response));return;
    }
    let bytes,type;
    if(relative==='state.json'){bytes=Buffer.from(JSON.stringify(state()));type=mime['.json'];}
    else if(staticFiles.has(relative||'index.html')){bytes=staticFiles.get(relative||'index.html');type=mime[path.extname(relative||'index.html')];}
    else {
      const match=/^(view|controller)\/(.+)$/.exec(relative);
      if(match&&bundle.entries.has(match[2])&&match[2]!=='manifest.json') {
        bytes=bundle.entries.get(match[2]);type=mime[path.extname(match[2]).toLowerCase()]??'application/octet-stream';
        if(match[2]===bundle.manifest.entrypoints[match[1]]) {
          const html=bytes.toString('utf8');
          const injection=`<script src="${base}bridge.js?id=${encodeURIComponent(bundle.manifest.id)}&amp;storage=${bundle.manifest.permissions.storage===true?1:0}"></script>`;
          bytes=Buffer.from(/<head(?:\s[^>]*)?>/i.test(html)?html.replace(/<head(?:\s[^>]*)?>/i,head=>head+injection):injection+html);
        }
      }
    }
    if(!bytes){response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});response.end(request.method==='HEAD'?undefined:bytes);
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=32;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const watchers=[];
  function changed() {
    if(closed)return;
    dirty=true;clearTimeout(timer);timer=setTimeout(rebuild,180);
  }
  async function rebuild() {
    if(closed||building)return;
    building=true;dirty=false;
    try {
      const next=await collect(project),nextConfig=await fixtures(project);
      if(closed)return;
      if(JSON.stringify(next.manifest.permissions)!==permissions)fail('preview.permissions','Les permissions ont changé.','Examinez-les puis redémarrez npm run dev. Le dernier aperçu accepté est conservé.');
      if(next.digest!==bundle.digest||JSON.stringify(config)!==JSON.stringify(nextConfig)) {
        bundle=next;config=nextConfig;generation++;publish({generation});
      } else publish({generation,ok:true});
    } catch(error) {if(!closed)publish({generation,error:diagnostic(error)});}
    finally{building=false;if(dirty&&!closed){clearTimeout(timer);timer=setTimeout(rebuild,180);}}
  }
  try {
    watchers.push(watch(path.join(project,'widget'),{recursive:true},changed));
    watchers.push(watch(project,(_type,name)=>{if(!name||String(name)==='preview.json')changed();}));
    for(const watcher of watchers)watcher.on('error',()=>publish({generation,error:{message:'Surveillance indisponible.',action:'Redémarrez npm run dev après avoir vérifié le dossier.'}}));
  } catch(error){for(const watcher of watchers)watcher.close();server.close();throw error;}
  return {url:`http://127.0.0.1:${server.address().port}${base}`,async close(){if(closed)return;closed=true;clearTimeout(timer);for(const watcher of watchers)watcher.close();for(const client of clients)client.end();clients.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
