// MIT License. Copyright (c) 2026 Valhallab SASU.
import * as fs from 'node:fs/promises';
import {accessSync,constants as fsConstants,statSync,watch} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {collect,readRegular} from './bundle.mjs';
import {CreatorError,MAX_BYTES,parseJson,validId} from './manifest.mjs';
import {networkRuleKey} from '../preview/network-policy.mjs';

const MAX_HEADER_BYTES=1024*1024;
const REQUEST_TIMEOUT_MS=65_000;
const CLOSE_TIMEOUT_MS=12_000;
const WATCH_DELAY_MS=180;

function nativeError(code,message,action) {return new CreatorError(code,message,action);}
function crashedHostError() {
  return nativeError('native.crashed','Le processus OverCrow de développement s’est arrêté.','Redémarrez OverCrow et relancez dev --native.');
}
function codeError(code) {
  if(code==='capability_confirmation_required')return nativeError(code,'Les permissions nécessitent une nouvelle session native.','Examinez les permissions, puis redémarrez explicitement dev --native.');
  if(code==='package_invalid')return nativeError(code,'Le widget ne correspond plus à la session native active.','Restaurez son identifiant ou redémarrez dev --native pour ce nouveau widget.');
  return nativeError(code||'native.failed','Le runtime natif a refusé la demande.','Corrigez le widget ou redémarrez OverCrow, puis réessayez.');
}
function report(options,error) {options.onError?.(error instanceof CreatorError?error:nativeError('native.failed','Le test natif a échoué.','Vérifiez OverCrow et les fichiers du widget, puis redémarrez.'));}
function permissionsSubset(candidate,granted) {
  const networks=new Set((granted.network??[]).map(networkRuleKey));
  return (candidate.network??[]).every(permission=>networks.has(networkRuleKey(permission)))
    &&(candidate.gameEvents??[]).every(event=>(granted.gameEvents??[]).includes(event))
    &&(candidate.capabilities??[]).every(capability=>(granted.capabilities??[]).includes(capability))
    &&Boolean(candidate.storage)===Boolean(granted.storage)
    &&(!candidate.clipboardWrite||Boolean(granted.clipboardWrite));
}

function pathEntries(environment) {
  const value=environment.PATH??environment.Path??environment.path??'';
  return value.split(path.delimiter).filter(Boolean);
}
export function resolveNativeHost({platform=process.platform,env=process.env,host}={}) {
  if(host!==undefined) {
    const platformPath=platform==='win32'?path.win32:path;
    if(typeof host!=='string'||(!path.isAbsolute(host)&&!platformPath.isAbsolute(host)))throw nativeError('native.host','--host doit être un chemin absolu.','Indiquez le chemin absolu de OverCrow.exe ou overcrow-widget.');
    return path.isAbsolute(host)?path.normalize(host):platformPath.normalize(host);
  }
  if(platform==='win32') {
    const local=env.LOCALAPPDATA;
    if(!local)return null;
    return path.win32.join(local,'Programs','OverCrow','OverCrow.exe');
  }
  if(platform==='linux') {
    for(const directory of pathEntries(env)) {
      const candidate=path.resolve(directory,'overcrow-widget');
      if(isExecutable(candidate))return candidate;
    }
    return null;
  }
  return null;
}

// Synchronous discovery keeps doctor deterministic and never starts the executable.
function isExecutable(filename) {
  try {
    const stat=statSync(filename);
    accessSync(filename,fsConstants.X_OK);
    return stat.isFile();
  } catch{return false;}
}
export async function nativeAvailability(options={}) {
  const platform=options.platform??process.platform,pathValue=resolveNativeHost(options);
  if(!pathValue)return {platform,path:null,available:false};
  let available=false;
  try{const stat=await fs.stat(pathValue);if(stat.isFile()){await fs.access(pathValue,platform==='win32'?fsConstants.F_OK:fsConstants.X_OK);available=true;}}catch{}
  return {platform,path:pathValue,available};
}

async function readReplay(filename,manifest) {
  if(filename===undefined)return null;
  if(typeof filename!=='string'||!path.isAbsolute(filename))throw nativeError('native.replay','Chemin de replay invalide.','Indiquez un fichier JSON de 1 Mio maximum.');
  const raw=await readRegular(filename,MAX_HEADER_BYTES),fixture=parseJson(raw.toString('utf8'),MAX_HEADER_BYTES);
  const keys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value):[];
  if(keys(fixture).some(key=>!['schemaVersion','events'].includes(key))||fixture.schemaVersion!==1||!Array.isArray(fixture.events)||fixture.events.length>1024)throw nativeError('native.replay','Fixture de replay invalide.','Utilisez schemaVersion 1 et au maximum 1 024 événements.');
  let previous=0;
  const allowed=new Set(manifest.permissions.gameEvents??[]);
  for(const event of fixture.events) {
    if(keys(event).some(key=>!['atMs','event','payload'].includes(key))||!Number.isSafeInteger(event.atMs)||event.atMs<previous||typeof event.event!=='string'||!allowed.has(event.event)||!Object.hasOwn(event,'payload'))throw nativeError('native.replay','Fixture de replay invalide ou événement non déclaré.','Ordonnez les timestamps et déclarez chaque événement dans permissions.gameEvents.');
    previous=event.atMs;
  }
  return fixture;
}

function waitForSpawn(child) {
  return new Promise((resolve,reject)=>{
    const failed=error=>{child.off('spawn',started);reject(error);};
    const started=()=>{child.off('error',failed);resolve();};
    child.once('error',failed);child.once('spawn',started);
  });
}
function waitForExit(child,timeout=CLOSE_TIMEOUT_MS) {
  if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve();
  return new Promise(resolve=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},timeout);
    timer.unref?.();child.once('exit',()=>{clearTimeout(timer);resolve();});
  });
}
function spawnHost(command,args,platform) {
  return spawn(command,args,{shell:false,windowsHide:platform==='win32',stdio:['pipe','pipe','pipe']});
}
function consumeLines(stream,onLine) {
  const limit=4096;let buffer='';stream.setEncoding('utf8');
  stream.on('data',chunk=>{
    buffer+=chunk;
    for(let newline=buffer.indexOf('\n');newline>=0;newline=buffer.indexOf('\n')) {
      const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);if(line)onLine(line.length<=limit?line:null);
    }
    if(buffer.length>limit){buffer='';onLine(null);}
  });
  stream.on('end',()=>{if(buffer)onLine(buffer.length<=limit?buffer:null);buffer='';});
}
const LINUX_ERROR_CATEGORIES=new Set(['unsafe_path','missing_manifest','invalid_bundle','capability_confirmation_required','fixture_invalid','unavailable','invalid_service_reply','service_unavailable','package_invalid','marketplace_invalid_request','marketplace_target_unavailable','marketplace_busy','development_runtime_failed','service_failed','write_failed']);
function linuxDiagnostic(line) {
  const match=typeof line==='string'&&line.match(/^(register|reload|replay|unregister|watch)=error category=([a-z0-9_]{1,64})(?: detail=.*)?$/);
  if(!match||!LINUX_ERROR_CATEGORIES.has(match[2]))return nativeError('native.host_output','overcrow-widget a signalé une erreur non reconnue.','Vérifiez le widget et l’état du Centre de contrôle, puis relancez dev --native.');
  if(match[2]==='capability_confirmation_required'||match[2]==='package_invalid')return codeError(match[2]);
  return nativeError(match[2],`overcrow-widget a refusé l’étape ${match[1]}.`,'Corrigez le widget ou l’état du Centre de contrôle, puis réessayez.');
}
function linuxSnapshot(line) {
  if(typeof line!=='string')return null;
  const match=line.match(/^(register|reload|replay)=ok id=([^ ]{3,128}) generation=(\d{1,20}) unverified=(true|false) devtools=(true|false) replayed_events=(\d{1,10})$/);if(!match||!validId(match[2])||match[4]!=='true')return null;
  const generation=Number(match[3]),replayedEvents=Number(match[6]);if(!Number.isSafeInteger(generation)||generation<1||!Number.isSafeInteger(replayedEvents))return null;
  return {id:match[2],generation,devtools:match[5]==='true',unverified:true,replayedEvents};
}

class ProtocolClient {
  constructor(child) {
    this.child=child;this.buffer=Buffer.alloc(0);this.nextId=1;this.pending=null;this.closed=false;
    child.stdout.on('data',chunk=>this.receive(chunk));
    const crashed=()=>this.fail(crashedHostError());
    child.stdout.on('end',crashed).on('error',crashed);
    child.stdin.on('error',crashed).on('close',crashed);
    child.on('error',()=>this.fail(nativeError('native.host','Impossible de démarrer le runtime natif.','Vérifiez le chemin --host et l’installation OverCrow.')));
  }
  receive(chunk) {
    if(this.closed)return;
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=4) {
      const size=this.buffer.readUInt32BE(0);
      if(size===0||size>MAX_HEADER_BYTES){this.fail(nativeError('native.protocol','Réponse native invalide.','Redémarrez OverCrow et réessayez.'));return;}
      if(this.buffer.length<4+size)return;
      const bytes=this.buffer.subarray(4,4+size);this.buffer=this.buffer.subarray(4+size);
      let response;try{response=JSON.parse(bytes.toString('utf8'));}catch{this.fail(nativeError('native.protocol','Réponse native invalide.','Redémarrez OverCrow et réessayez.'));return;}
      const pending=this.pending;
      if(!pending||!validResponse(response,pending.id)){this.fail(nativeError('native.protocol','Réponse native non corrélée ou invalide.','Redémarrez OverCrow et réessayez.'));return;}
      this.pending=null;clearTimeout(pending.timer);
      if(response.ok)pending.resolve(response.snapshot);else pending.reject(codeError(response.code));
    }
  }
  fail(error) {
    if(this.closed)return;this.closed=true;
    if(this.pending){const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.reject(error);}
    this.child.stdin.destroy();
  }
  async request(request,archive=Buffer.alloc(0),timeout=REQUEST_TIMEOUT_MS) {
    if(this.closed)throw crashedHostError();
    if(this.pending)throw nativeError('native.busy','Une demande native est déjà en cours.','Attendez sa fin avant de réessayer.');
    if(!Buffer.isBuffer(archive)||archive.length>MAX_BYTES)throw nativeError('native.archive','Archive de développement trop volumineuse.','Réduisez widget/ à 128 Mio maximum.');
    const id=this.nextId++,message={schemaVersion:1,requestId:id,request},body=Buffer.from(JSON.stringify(message));
    if(body.length>MAX_HEADER_BYTES)throw nativeError('native.protocol','Demande native trop volumineuse.','Réduisez la fixture de replay.');
    const header=Buffer.alloc(4);header.writeUInt32BE(body.length);
    const answer=new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(nativeError('native.timeout','Le runtime natif ne répond pas.','Fermez OverCrow, puis relancez dev --native.')),timeout);timer.unref?.();this.pending={id,resolve,reject,timer};});
    // Writes can still be backpressured when a host exit rejects the response.
    // Attach rejection handling before the first write, then return the original promise.
    void answer.catch(()=>{});
    try{await writeAll(this.child.stdin,header);await writeAll(this.child.stdin,body);if(archive.length)await writeAll(this.child.stdin,archive);}catch{this.fail(crashedHostError());}
    return answer;
  }
}
function validSnapshot(snapshot) {
  if(snapshot===null)return true;
  return snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)&&typeof snapshot.id==='string'&&Number.isSafeInteger(snapshot.generation)&&snapshot.generation>0&&typeof snapshot.capabilitiesSha256==='string'&&/^[0-9a-f]{64}$/.test(snapshot.capabilitiesSha256)&&typeof snapshot.devtools==='boolean'&&snapshot.unverified===true&&Number.isSafeInteger(snapshot.replayedEvents)&&snapshot.replayedEvents>=0;
}
function validResponse(response,id) {
  return response&&typeof response==='object'&&!Array.isArray(response)&&response.schemaVersion===1&&response.requestId===id&&typeof response.ok==='boolean'&&(response.code===null||typeof response.code==='string')&&validSnapshot(response.snapshot);
}
function writeAll(stream,bytes) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(callback,value)=>{if(settled)return;settled=true;stream.off('error',failed);stream.off('close',closed);callback(value);};
    const failed=error=>finish(reject,error),closed=()=>finish(reject,new Error('transport closed'));
    stream.once('error',failed);stream.once('close',closed);
    try{stream.write(bytes,error=>error?failed(error):finish(resolve));}catch(error){failed(error);}
  });
}

function sourceWatcher(project,rebuild,onFailure) {
  let closed=false,timer,building=false,dirty=false;
  const changed=()=>{if(closed)return;dirty=true;clearTimeout(timer);timer=setTimeout(run,WATCH_DELAY_MS);};
  const run=async()=>{if(closed||building)return;building=true;dirty=false;try{await rebuild();}catch(error){if(!closed)onFailure(error);}finally{building=false;if(dirty&&!closed){clearTimeout(timer);timer=setTimeout(run,WATCH_DELAY_MS);}}};
  const watcher=watch(path.join(path.resolve(project),'widget'),{recursive:true},changed);
  watcher.on('error',onFailure);
  return {close(){if(closed)return;closed=true;clearTimeout(timer);watcher.close();}};
}

async function startWindows(project,options) {
  const host=resolveNativeHost(options);if(!host)throw nativeError('native.host','OverCrow.exe est introuvable.','Installez OverCrow ou indiquez --host avec un chemin absolu.');
  let bundle=await collect(project);
  const replay=await readReplay(options.replay,bundle.manifest);
  const child=spawnHost(host,[...(options.hostArguments??[]),'--widget-development'],'win32');
  // Drain untrusted diagnostic output without retaining data that is never displayed.
  child.stderr.resume();
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{await waitForSpawn(child);}catch{child.kill();throw nativeError('native.host','Impossible de démarrer OverCrow.exe.','Vérifiez le chemin --host et l’installation OverCrow.');}
  const client=new ProtocolClient(child);let snapshot,closing=false,watcher;
  try {
    snapshot=await client.request({command:'register',archiveBytes:bundle.archive.length,devtools:Boolean(options.devtools)},bundle.archive);
    if(replay)snapshot=await client.request({command:'replay',fixture:replay});
  } catch(error){client.fail(error);child.kill();await waitForExit(child);throw error;}
  const session={platform:'win32',host,get snapshot(){return snapshot;},done:null,async close(){if(closing)return;closing=true;watcher?.close();const deadline=Date.now()+CLOSE_TIMEOUT_MS;try{if(!client.closed)await client.request({command:'stop'},Buffer.alloc(0),CLOSE_TIMEOUT_MS);}catch{}client.closed=true;child.stdin.end();await waitForExit(child,Math.max(0,deadline-Date.now()));}};
  session.done=exited.then(result=>{if(!closing){watcher?.close();report(options,crashedHostError());}return result;});
  try{watcher=sourceWatcher(project,async()=>{
    const next=await collect(project);if(next.digest===bundle.digest)return;
    const accepted=await client.request({command:'reload',archiveBytes:next.archive.length},next.archive);
    bundle=next;snapshot=accepted;options.onSnapshot?.(snapshot);
    if(replay){snapshot=await client.request({command:'replay',fixture:replay});options.onSnapshot?.(snapshot);}
  },error=>report(options,error));}
  catch(error){await session.close();throw error;}
  return session;
}

async function atomicFile(filename,bytes) {
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const temporary=path.join(path.dirname(filename),`.${path.basename(filename)}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});
  try{await fs.rename(temporary,filename);await fs.chmod(filename,0o600);}finally{await fs.rm(temporary,{force:true});}
}
async function stageBundle(root,bundle,previous=new Set()) {
  const next=new Set(bundle.entries.keys());
  for(const name of previous)if(name!=='manifest.json'&&!next.has(name))await fs.rm(path.join(root,...name.split('/')),{force:true});
  for(const [name,bytes] of bundle.entries)if(name!=='manifest.json')await atomicFile(path.join(root,...name.split('/')),bytes);
  await atomicFile(path.join(root,'manifest.json'),bundle.entries.get('manifest.json'));
  return next;
}
async function startLinux(project,options) {
  const host=resolveNativeHost(options);if(!host)throw nativeError('native.host','overcrow-widget est introuvable.','Installez OverCrow ou indiquez --host avec un chemin absolu.');
  let bundle=await collect(project);await readReplay(options.replay,bundle.manifest);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'overcrow-native-'));await fs.chmod(root,0o700);
  let names;
  try{names=await stageBundle(root,bundle);}catch(error){await fs.rm(root,{recursive:true,force:true});throw error;}
  const args=[...(options.hostArguments??[]),'dev','--watch'];if(options.devtools)args.push('--devtools');if(options.replay)args.push('--replay',options.replay);args.push(root);
  const child=spawnHost(host,args,'linux');let snapshot=null,lastHostError=null;
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  consumeLines(child.stderr,line=>{const error=linuxDiagnostic(line);lastHostError=error;report(options,error);});
  consumeLines(child.stdout,line=>{const accepted=linuxSnapshot(line);if(!accepted)return;snapshot=accepted;lastHostError=null;options.onSnapshot?.(snapshot);});
  try{await waitForSpawn(child);}catch{await fs.rm(root,{recursive:true,force:true});throw nativeError('native.host','Impossible de démarrer overcrow-widget.','Vérifiez le chemin --host et l’installation OverCrow.');}
  let closing=false,watcher;
  const session={platform:'linux',host,get snapshot(){return snapshot;},done:null,async close(){if(closing)return;closing=true;watcher?.close();child.kill('SIGTERM');await waitForExit(child);await fs.rm(root,{recursive:true,force:true});}};
  session.done=exited.then(result=>{if(!closing){watcher?.close();void fs.rm(root,{recursive:true,force:true});if(!lastHostError)report(options,nativeError('native.crashed','overcrow-widget s’est arrêté.','Corrigez l’erreur indiquée, puis relancez dev --native.'));}return result;});
  try{watcher=sourceWatcher(project,async()=>{const next=await collect(project);if(next.digest===bundle.digest)return;if(next.manifest.id!==bundle.manifest.id)throw codeError('package_invalid');if(!permissionsSubset(next.manifest.permissions,bundle.manifest.permissions))throw codeError('capability_confirmation_required');names=await stageBundle(root,next,names);bundle=next;},error=>report(options,error));}
  catch(error){await session.close();throw error;}
  return session;
}

export async function startNativeDevelopment(project='.',options={}) {
  const platform=options.platform??process.platform;
  const replay=options.replay===undefined?undefined:(typeof options.replay==='string'?path.resolve(options.replay):options.replay);
  if(platform==='win32')return startWindows(project,{...options,platform,replay});
  if(platform==='linux')return startLinux(project,{...options,platform,replay});
  throw nativeError('native.platform','Le test natif est disponible sous Windows et Linux.','Utilisez la simulation navigateur sur cette plateforme.');
}
