import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {startNativeDevelopment,resolveNativeHost,nativeAvailability} from '../../tools/creator-kit/lib/native.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(t) {
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'overcrow-native-linux-')));
  const project=path.join(temporary,'Créateur Linux avec espaces');await fs.mkdir(path.join(project,'widget'),{recursive:true});
  await fs.cp(path.join(root,'content/templates/counter'),path.join(project,'widget'),{recursive:true});
  for(const name of ['overcrow.js','overcrow.d.ts','LICENSE'])await fs.copyFile(path.join(root,'content/sdk',name),path.join(project,'widget',name));
  const manifestFile=path.join(project,'widget/manifest.json'),manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.id='com.example.native-linux';await fs.writeFile(manifestFile,JSON.stringify(manifest));
  return {temporary,project,manifestFile,cleanup:()=>fs.rm(temporary,{recursive:true,force:true})};
}
async function fakeHost(directory) {
  const script=path.join(directory,'fake-linux-host.mjs'),log=path.join(directory,'linux-host.jsonl');
  await fs.writeFile(script,`import fs from 'node:fs';import path from 'node:path';
const log=process.argv[2],args=process.argv.slice(3),root=args.at(-1);let timer,generation=1;
function snapshot(phase){process.stdout.write(phase+'=ok id=com.example.native-linux generation='+generation+' unverified=true devtools=true replayed_events=0\\n');}
function scan(type){const files={};function walk(dir,prefix=''){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+item.name,full=path.join(dir,item.name);if(item.isDirectory())walk(full,name+'/');else files[name]={text:fs.readFileSync(full,'utf8'),mode:fs.statSync(full).mode&0o777};}}walk(root);fs.appendFileSync(log,JSON.stringify({type,args,rootMode:fs.statSync(root).mode&0o777,files})+'\\n');return files;}
scan('start');snapshot('register');const watcher=fs.watch(root,{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(()=>{const files=scan('change');if(files['styles.css']?.text.includes('host-reject'))process.stderr.write('reload=error category=development_runtime_failed detail=/private/path\\n');else{generation++;snapshot('reload');}},25);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{watcher.close();process.exit(0);});process.stdin.resume();
`);
  return {script,log};
}
async function rows(filename){try{return (await fs.readFile(filename,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function waitFor(check,timeout=6000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('test timeout');}

test('Linux native mode stages private files and updates valid generations with manifest last',{skip:process.platform!=='linux'},async t=>{
  const {temporary,project,manifestFile,cleanup}=await fixture(t),host=await fakeHost(temporary),replay=path.join(temporary,'events.json'),errors=[],snapshots=[];
  const initialManifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));initialManifest.permissions.storage=true;initialManifest.permissions.gameEvents=['overcrow.game.session.v1'];await fs.writeFile(manifestFile,JSON.stringify(initialManifest));
  await fs.writeFile(replay,JSON.stringify({schemaVersion:1,events:[]}));
  const session=await startNativeDevelopment(project,{platform:'linux',host:process.execPath,hostArguments:[host.script,host.log],devtools:true,replay,onError:error=>errors.push(error),onSnapshot:snapshot=>snapshots.push(snapshot)});t.after(()=>session.close());t.after(cleanup);
  let events=await waitFor(async()=>{const value=await rows(host.log);return value.length&&value;});
  await waitFor(()=>snapshots.length>0);assert.equal(session.snapshot.generation,1);assert.equal(snapshots[0].id,'com.example.native-linux');
  assert.deepEqual(events[0].args.slice(0,-1),['dev','--watch','--devtools','--replay',replay]);
  assert.equal(events[0].rootMode,0o700);
  assert.equal(Object.values(events[0].files).every(file=>file.mode===0o600),true);
  assert.equal(JSON.parse(events[0].files['manifest.json'].text).files['styles.css'].bytes,events[0].files['styles.css'].text.length);
  const originalPrepared=events[0].files['manifest.json'].text;
  await fs.writeFile(manifestFile,'{');await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal((await rows(host.log)).at(-1).files['manifest.json'].text,originalPrepared);
  const widened={...initialManifest,permissions:{...initialManifest.permissions,clipboardWrite:true}};
  await fs.writeFile(manifestFile,JSON.stringify(widened));
  await waitFor(async()=>errors.some(error=>error.code==='capability_confirmation_required'));
  assert.equal((await rows(host.log)).at(-1).files['manifest.json'].text,originalPrepared);
  await fs.writeFile(manifestFile,JSON.stringify({...initialManifest,id:'com.example.changed-id'}));
  await waitFor(async()=>errors.some(error=>error.code==='package_invalid'));
  assert.equal((await rows(host.log)).at(-1).files['manifest.json'].text,originalPrepared);
  const priorErrors=errors.length;
  await fs.writeFile(manifestFile,JSON.stringify({...initialManifest,permissions:{...initialManifest.permissions,storage:false}}));
  await waitFor(async()=>errors.length>priorErrors);
  assert.equal(errors.at(-1).code,'capability_confirmation_required');
  assert.equal((await rows(host.log)).at(-1).files['manifest.json'].text,originalPrepared,'storage changes require a fresh browser context');
  const sourceManifest={...initialManifest,permissions:{...initialManifest.permissions,gameEvents:[]}};
  await fs.writeFile(manifestFile,JSON.stringify(sourceManifest));await fs.appendFile(path.join(project,'widget/styles.css'),'\n/* synced */\n');
  events=await waitFor(async()=>{const value=await rows(host.log);return value.find(event=>event.type==='change'&&event.files['styles.css'].text.includes('synced'))&&value;});
  assert.match(events.at(-1).files['styles.css'].text,/synced/);
  assert.notEqual(events.at(-1).files['manifest.json'].text,originalPrepared);
  assert.deepEqual(JSON.parse(events.at(-1).files['manifest.json'].text).permissions.gameEvents,[],'other permission reductions remain reloadable');
  assert.equal(JSON.parse(await fs.readFile(manifestFile,'utf8')).files,undefined,'generated ledger must stay out of creator sources');
  const styles=path.join(project,'widget/styles.css'),accepted=await fs.readFile(styles,'utf8');await fs.writeFile(styles,accepted+'\n/* host-reject */\n');
  await waitFor(async()=>errors.some(error=>error.code==='development_runtime_failed'));
  assert.equal(errors.find(error=>error.code==='development_runtime_failed').message.includes('/private/path'),false,'native details are not exposed');
  await fs.writeFile(styles,accepted+'\n/* host-recovered */\n');
  await waitFor(async()=>{const value=await rows(host.log);return value.some(event=>event.type==='change'&&event.files['styles.css'].text.includes('host-recovered'));});
  assert.equal(await Promise.race([session.done.then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(true),100))]),true,'a recoverable native rejection keeps the watcher alive');
});

test('native host resolution and doctor availability report paths without launching them',{skip:process.platform!=='linux'},async t=>{
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'overcrow-native-path-')));t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const executable=path.join(temporary,'overcrow-widget');await fs.writeFile(executable,'');await fs.chmod(executable,0o700);
  assert.equal(resolveNativeHost({platform:'linux',env:{PATH:temporary}}),executable);
  assert.deepEqual(await nativeAvailability({platform:'linux',env:{PATH:temporary}}),{platform:'linux',path:executable,available:true});
  assert.deepEqual(await nativeAvailability({platform:'linux',env:{PATH:''}}),{platform:'linux',path:null,available:false});
});

test('Linux reload consent compares every route constraint and ignores canonical ordering',{skip:process.platform!=='linux'},async t=>{
  const {temporary,project,manifestFile,cleanup}=await fixture(t),host=await fakeHost(temporary),errors=[];
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  const route={origin:'https://api.example.com',method:'GET',path:'/items/{id}/{slug}/{mode}',pathParams:{id:{type:'integer',min:1,max:100},slug:{type:'slug',maxLength:4},mode:{type:'enum',values:['small','large']}},queryParams:{q:{type:'string',maxLength:8},page:{type:'integer',min:1,max:10},tag:{type:'slug',maxLength:8},sort:{type:'enum',values:['new','top']},flag:{type:'enum',values:['yes'],required:true}}};
  manifest.permissions.network=[route,{origin:route.origin,method:'GET',path:'/versions'}];
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  const session=await startNativeDevelopment(project,{platform:'linux',host:process.execPath,hostArguments:[host.script,host.log],onError:error=>errors.push(error)});t.after(()=>session.close());t.after(cleanup);
  await waitFor(async()=>session.snapshot?.generation===1);
  const reordered=structuredClone(manifest),reorderedRoute=reordered.permissions.network[0];
  reorderedRoute.pathParams=Object.fromEntries(Object.entries(reorderedRoute.pathParams).reverse());reorderedRoute.pathParams.mode.values.reverse();
  reorderedRoute.queryParams=Object.fromEntries(Object.entries(reorderedRoute.queryParams).reverse());reorderedRoute.queryParams.sort.values.reverse();reorderedRoute.queryParams.q.required=false;
  reordered.permissions.network.reverse();
  await fs.writeFile(manifestFile,JSON.stringify(reordered));
  await waitFor(async()=>session.snapshot?.generation===2);
  assert.deepEqual(errors,[]);
  const approved=(await rows(host.log)).at(-1).files['manifest.json'].text;
  const changes=[
    value=>value.origin='https://other.example.com',value=>value.method='POST',value=>value.path='/other/{id}/{slug}/{mode}',
    value=>value.pathParams.id.min=0,value=>value.pathParams.id.max=101,value=>value.pathParams.id={type:'slug',maxLength:3},
    value=>value.pathParams.slug.maxLength=5,value=>value.pathParams.mode.values.push('medium'),
    value=>value.queryParams.q.maxLength=9,value=>value.queryParams.q.required=true,value=>value.queryParams.flag.required=false,
    value=>value.queryParams.page.min=0,value=>value.queryParams.page.max=11,value=>value.queryParams.page={type:'slug',maxLength:2},
    value=>value.queryParams.tag.maxLength=9,value=>value.queryParams.sort.values.push('old'),
    value=>value.queryParams.extra={type:'slug',maxLength:1},value=>delete value.queryParams.q,
  ];
  for(const change of changes) {
    const next=structuredClone(manifest);change(next.permissions.network[0]);const count=errors.length;
    await fs.writeFile(manifestFile,JSON.stringify(next));
    await waitFor(()=>errors.length>count);
    assert.equal(errors.at(-1).code,'capability_confirmation_required',String(change));
    assert.equal((await rows(host.log)).at(-1).files['manifest.json'].text,approved,String(change));
  }
  const capabilities=structuredClone(manifest);capabilities.permissions.capabilities=['telemetry.read'];const count=errors.length;
  await fs.writeFile(manifestFile,JSON.stringify(capabilities));await waitFor(()=>errors.length>count);
  assert.equal(errors.at(-1).code,'capability_confirmation_required');
  const reduced=structuredClone(manifest);reduced.permissions.network=[route];await fs.writeFile(manifestFile,JSON.stringify(reduced));
  await waitFor(async()=>session.snapshot?.generation===3);
  assert.equal(JSON.parse((await rows(host.log)).at(-1).files['manifest.json'].text).permissions.network.length,1);
});
