import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startNativeDevelopment,resolveNativeHost} from '../../tools/creator-kit/lib/native.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));

async function projectFixture(t) {
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'overcrow-native-win-')));
  const project=path.join(temporary,'Créateur Windows avec espaces');
  await fs.mkdir(path.join(project,'widget'),{recursive:true});
  await fs.cp(path.join(root,'content/templates/counter'),path.join(project,'widget'),{recursive:true});
  for(const name of ['overcrow.js','overcrow.d.ts','LICENSE'])await fs.copyFile(path.join(root,'content/sdk',name),path.join(project,'widget',name));
  const manifestFile=path.join(project,'widget/manifest.json');
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  manifest.id='com.example.native-windows';
  manifest.permissions.gameEvents=['overcrow.game.session.v1'];
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  return {temporary,project,manifestFile,cleanup:()=>fs.rm(temporary,{recursive:true,force:true})};
}

async function fakeHost(directory,mode='normal') {
  const script=path.join(directory,`fake-host-${mode}.mjs`),log=path.join(directory,`host-${mode}.jsonl`);
  await fs.writeFile(script,`import fs from 'node:fs';
const log=process.argv[2],mode=${JSON.stringify(mode)};let bytes=Buffer.alloc(0),generation=0,reloads=0;
fs.appendFileSync(log,JSON.stringify({type:'argv',args:process.argv.slice(3)})+'\\n');
function reply(value){const body=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(4);head.writeUInt32BE(body.length);const frame=Buffer.concat([head,body]);for(const byte of frame)process.stdout.write(Buffer.from([byte]));}
function consume(){while(bytes.length>=4){const size=bytes.readUInt32BE();if(bytes.length<4+size)return;const request=JSON.parse(bytes.subarray(4,4+size));const archiveSize=request.request.archiveBytes??0;if(mode==='exit-during-register'){fs.appendFileSync(log,JSON.stringify({type:'header',request,archiveSize})+'\\n');process.exit(17);}if(bytes.length<4+size+archiveSize)return;const archive=bytes.subarray(4+size,4+size+archiveSize);bytes=bytes.subarray(4+size+archiveSize);fs.appendFileSync(log,JSON.stringify({type:'request',request,archiveSize,magic:archive.subarray(0,4).toString('hex')})+'\\n');if(mode==='malformed'){process.stdout.write(Buffer.from([0,32,0,1]));continue;}let ok=true,code=null;if(request.request.command==='register')generation=1;else if(request.request.command==='reload'){reloads++;if(reloads===2){ok=false;code='capability_confirmation_required';}else generation++;}const snapshot=request.request.command==='stop'?null:{id:'com.example.native-windows',generation,capabilitiesSha256:'a'.repeat(64),devtools:Boolean(request.request.devtools),unverified:true,replayedEvents:request.request.command==='replay'?request.request.fixture.events.length:0};reply({schemaVersion:1,requestId:request.requestId,ok,code,snapshot});if(mode==='crash-after-register'&&request.request.command==='register')setTimeout(()=>process.exit(17),20);if(request.request.command==='stop')process.exit(0);}}
process.stdin.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);consume();});process.stdin.on('end',()=>process.exit(0));
`);
  return {script,log};
}

async function records(filename) {
  try{return (await fs.readFile(filename,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}
}

async function waitFor(check,timeout=6000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error('test timeout');
}

test('Windows native mode frames register, replay, reload and stop over private pipes',async t=>{
  const {temporary,project,cleanup}=await projectFixture(t),host=await fakeHost(temporary);
  const replay=path.join(temporary,'événements.json');
  await fs.writeFile(replay,JSON.stringify({schemaVersion:1,events:[{atMs:0,event:'overcrow.game.session.v1',payload:{elapsedMs:12}}]}));
  const session=await startNativeDevelopment(project,{platform:'win32',host:process.execPath,hostArguments:[host.script,host.log],replay,devtools:true});
  t.after(()=>session.close());
  t.after(cleanup);
  assert.equal(session.snapshot.generation,1);
  assert.equal(session.snapshot.replayedEvents,1);
  let seen=await records(host.log);
  assert.deepEqual(seen[0],{type:'argv',args:['--widget-development']});
  assert.deepEqual(seen.slice(1).map(row=>row.request.request.command),['register','replay']);
  assert.deepEqual(seen.slice(1).map(row=>row.request.requestId),[1,2]);
  assert.equal(seen[1].request.request.devtools,true);
  assert.equal(seen[1].archiveSize>0,true);assert.equal(seen[1].magic,'504b0304');
  await fs.appendFile(path.join(project,'widget/styles.css'),'\n/* native reload */\n');
  seen=await waitFor(async()=>{const value=await records(host.log),commands=value.filter(row=>row.type==='request').map(row=>row.request.request.command);return commands.join(',')==='register,replay,reload,replay'&&session.snapshot.generation===2&&session.snapshot.replayedEvents===1&&value;});
  assert.equal(session.snapshot.generation,2);
  assert.deepEqual(seen.filter(row=>row.type==='request').map(row=>row.request.requestId),[1,2,3,4]);
  await session.close();
  seen=await records(host.log);
  assert.equal(seen.at(-1).request.request.command,'stop');
  assert.equal(seen.at(-1).archiveSize,0);
});

test('Windows watch retains the acknowledged generation on invalid and permission-expanding reloads',async t=>{
  const {temporary,project,manifestFile,cleanup}=await projectFixture(t),host=await fakeHost(temporary),errors=[];
  const session=await startNativeDevelopment(project,{platform:'win32',host:process.execPath,hostArguments:[host.script,host.log],onError:error=>errors.push(error)});
  t.after(()=>session.close());
  t.after(cleanup);
  await fs.appendFile(path.join(project,'widget/styles.css'),'\n/* accepted */\n');
  await waitFor(async()=>session.snapshot.generation===2);
  const before=(await records(host.log)).filter(row=>row.type==='request').length;
  await fs.writeFile(manifestFile,'{');
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal((await records(host.log)).filter(row=>row.type==='request').length,before);
  const manifest={schemaVersion:1,id:'com.example.native-windows',version:'1.0.0',apiVersion:'1',entrypoints:{view:'index.html'},permissions:{network:[],gameEvents:['overcrow.game.session.v1'],storage:true,clipboardWrite:false}};
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  await waitFor(async()=>errors.some(error=>error.code==='capability_confirmation_required'));
  assert.equal(session.snapshot.generation,2);
  assert.match(errors.find(error=>error.code==='capability_confirmation_required').action,/redémarrez|restart/i);
});

test('Windows host resolution is deterministic and malformed hosts are cleaned up',async t=>{
  assert.equal(resolveNativeHost({platform:'win32',env:{LOCALAPPDATA:'C:\\Users\\Zoé\\AppData\\Local'}}),'C:\\Users\\Zoé\\AppData\\Local\\Programs\\OverCrow\\OverCrow.exe');
  const {temporary,project,cleanup}=await projectFixture(t),host=await fakeHost(temporary,'malformed');t.after(cleanup);
  await assert.rejects(startNativeDevelopment(project,{platform:'win32',host:process.execPath,hostArguments:[host.script,host.log]}),error=>error.code==='native.protocol');
  await waitFor(async()=>{const rows=await records(host.log);return rows.length>0;});
});

test('a crashed Windows host reports once and releases its source watcher',async t=>{
  const {temporary,project,cleanup}=await projectFixture(t),host=await fakeHost(temporary,'crash-after-register'),errors=[];
  const session=await startNativeDevelopment(project,{platform:'win32',host:process.execPath,hostArguments:[host.script,host.log],onError:error=>errors.push(error)});
  t.after(()=>session.close());t.after(cleanup);
  const result=await session.done;assert.equal(result.code,17);
  await waitFor(async()=>errors.length===1);
  assert.equal(errors[0].code,'native.crashed');
  await fs.appendFile(path.join(project,'widget/styles.css'),'\n/* after crash */\n');
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal(errors.length,1);
  await session.close();
});

test('Windows host exit during a large register write is caught without an unhandled rejection',async t=>{
  const {temporary,project,cleanup}=await projectFixture(t);t.after(cleanup);await fs.writeFile(path.join(project,'widget/large.dat'),Buffer.alloc(4*1024*1024,0x5a));
  const host=await fakeHost(temporary,'exit-during-register'),runner=path.join(temporary,'run-large-register.mjs');
  await fs.writeFile(runner,`import {startNativeDevelopment} from ${JSON.stringify(new URL('../../tools/creator-kit/lib/native.mjs',import.meta.url).href)};
try {await startNativeDevelopment(process.argv[2],{platform:'win32',host:process.argv[3],hostArguments:[process.argv[4],process.argv[5]]});process.exitCode=2;}
catch(error){console.log(error.code);if(error.code!=='native.crashed')process.exitCode=3;}
`);
  const result=spawnSync(process.execPath,[runner,project,process.execPath,host.script,host.log],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/native\.crashed/);
});
