import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),cli=path.join(root,'tools/creator-kit/overcrow.mjs');
const run=args=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:10000});

test('native CLI options are explicit and browser simulation remains the default',()=>{
  const help=run(['--help']);assert.equal(help.status,0);assert.match(help.stdout,/dev \[projet\] \[--port 4175\]/);assert.match(help.stdout,/dev \[projet\] --native/);
  let result=run(['dev','--devtools']);assert.equal(result.status,1);assert.match(result.stderr,/--devtools.*--native/);
  result=run(['dev','--native','--port','4176']);assert.equal(result.status,1);assert.match(result.stderr,/--port.*simulation/);
  result=run(['dev','--native','--host','relative.exe']);assert.equal(result.status,1);assert.match(result.stderr,/absolu/);
});

test('doctor reports native host availability without claiming it launched',()=>{
  const result=run(['doctor','--host',process.execPath,'--json']);assert.equal(result.status,0,result.stderr+result.stdout);
  const report=JSON.parse(result.stdout);
  assert.equal(report.ok,true);assert.equal(report.nativeTest.available,true);assert.equal(report.nativeTest.path,process.execPath);
  assert.equal(Object.hasOwn(report.nativeTest,'executed'),false);
  const human=run(['doctor','--host',process.execPath]);assert.equal(human.status,0,human.stderr);assert.match(human.stdout,/nativeTest: available/);assert.match(human.stdout,new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

async function nativeCliFixture(t,mode) {
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'overcrow-native-cli-')));
  const project=path.join(temporary,'Projet CLI natif avec espaces');await fs.mkdir(path.join(project,'widget'),{recursive:true});
  await fs.cp(path.join(root,'content/templates/counter'),path.join(project,'widget'),{recursive:true});
  for(const name of ['overcrow.js','overcrow.d.ts','LICENSE'])await fs.copyFile(path.join(root,'content/sdk',name),path.join(project,'widget',name));
  const host=path.join(temporary,'faux-hôte-overcrow.mjs'),log=path.join(temporary,'hôte.jsonl'),replay=path.join(temporary,'événements.json');
  await fs.writeFile(replay,JSON.stringify({schemaVersion:1,events:[]}));
  await fs.writeFile(host,`#!/usr/bin/env node
import fs from 'node:fs';
const log=process.env.OVERCROW_FAKE_LOG;
fs.appendFileSync(log,JSON.stringify({type:'start',args:process.argv.slice(2)})+'\\n');
if(process.env.OVERCROW_FAKE_MODE==='crash')setTimeout(()=>process.exit(17),80);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{fs.appendFileSync(log,JSON.stringify({type:'stop',signal})+'\\n');process.exit(0);});
process.stdin.resume();
`);await fs.chmod(host,0o700);
  const child=spawn(process.execPath,[cli,'dev',project,'--native','--host',host,'--replay',path.basename(replay)],{cwd:temporary,env:{...process.env,OVERCROW_FAKE_LOG:log,OVERCROW_FAKE_MODE:mode},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  return {child,done,log,cleanup:()=>fs.rm(temporary,{recursive:true,force:true}),output:()=>({stdout,stderr})};
}
async function waitFor(check,timeout=5000) {const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('test timeout');}
async function within(promise,timeout=2000) {let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('process did not exit')),timeout);})]);}finally{clearTimeout(timer);}}

test('native CLI stops its child on standard-input EOF',{skip:process.platform!=='linux'},async t=>{
  const session=await nativeCliFixture(t,'normal');t.after(async()=>{if(session.child.exitCode===null)session.child.kill();await session.done;});t.after(session.cleanup);
  await waitFor(()=>session.output().stdout.includes('Test natif OverCrow'));
  await waitFor(()=>fs.readFile(session.log,'utf8').then(()=>true,()=>false));
  session.child.stdin.end();
  const result=await session.done;assert.equal(result.code,0,session.output().stderr);
  const rows=(await fs.readFile(session.log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row=>row.type),['start','stop']);
  assert.deepEqual(rows[0].args.slice(0,-1),['dev','--watch','--replay',path.join(path.dirname(session.log),'événements.json')]);
});

test('native CLI exits with a clear error when its host crashes',{skip:process.platform!=='linux'},async t=>{
  const session=await nativeCliFixture(t,'crash');t.after(async()=>{if(session.child.exitCode===null)session.child.kill();await session.done;});t.after(session.cleanup);const result=await session.done;
  assert.equal(result.code,1);assert.match(session.output().stderr,/native\.crashed.*overcrow-widget s’est arrêté/s);
});

test('native CLI exits after SIGINT even while its standard-input pipe stays open',{skip:process.platform!=='linux'},async t=>{
  const session=await nativeCliFixture(t,'normal');t.after(async()=>{if(session.child.exitCode===null)session.child.kill('SIGKILL');await session.done;});t.after(session.cleanup);
  await waitFor(()=>session.output().stdout.includes('Test natif OverCrow'));await waitFor(()=>fs.readFile(session.log,'utf8').then(()=>true,()=>false));
  session.child.kill('SIGINT');
  const result=await within(session.done);assert.equal(result.code,0,session.output().stderr);
});
