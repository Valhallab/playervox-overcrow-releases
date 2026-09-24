import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {get} from 'node:http';
import {collect,packageProject} from '../../tools/creator-kit/lib/bundle.mjs';
import {parseJson,validPath} from '../../tools/creator-kit/lib/manifest.mjs';
import {startPreview} from '../../tools/creator-kit/lib/preview.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cli=path.join(root,'tools/creator-kit/overcrow.mjs');
const run=(args,cwd=root)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',timeout:10000});
async function fixture(t,template='counter') {
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'overcrow-kit-')));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const project=path.join(temporary,'Créateur avec espaces');
  const result=run(['init',project,'--template',template,'--id','com.example.test','--json']);
  assert.equal(result.status,0,result.stderr+result.stdout);
  return {temporary,project};
}
test('a fresh project works without installation, preserves existing folders and ships only web assets',async t=>{
  const {project}=await fixture(t);
  const check=run(['check',project,'--json']);assert.equal(check.status,0,check.stdout);
  assert.equal(JSON.parse(check.stdout).ok,true);
  assert.equal(run(['init',project]).status,1);
  assert.ok(await fs.readFile(path.join(project,'widget/view.js'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(project,'widget/manifest.json'),'utf8'));
  assert.equal(manifest.files,undefined);
  const output=run(['package',project,'--json']);assert.equal(output.status,0,output.stdout);
  const first=JSON.parse(output.stdout);
  const repeated=JSON.parse(run(['package',project,'--json']).stdout);assert.equal(first.sha256,repeated.sha256);assert.equal(first.file,repeated.file);
  assert.equal((await fs.readFile(first.file)).readUInt32LE(0),0x04034b50);
  await fs.appendFile(path.join(project,'widget/styles.css'),'\n/* new version */\n');
  const next=JSON.parse(run(['package',project,'--json']).stdout);assert.notEqual(next.file,first.file);
  assert.ok(await fs.stat(first.file));
  const bundle=await collect(project);assert.ok(bundle.entries.has('overcrow.d.ts'));assert.ok(![...bundle.entries.keys()].some(name=>name.includes('tooling')||name.includes('preview')));
});
test('JSON diagnostics point to invalid entrypoints and reject unknown permissions',async t=>{
  const {project}=await fixture(t);
  const file=path.join(project,'widget/manifest.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));
  manifest.entrypoints.view='missing.html';await fs.writeFile(file,JSON.stringify(manifest));
  const result=run(['check',project,'--json']);assert.equal(result.status,1);
  const diagnosis=JSON.parse(result.stdout).diagnostics[0];assert.equal(diagnosis.pointer,'/entrypoints/view');assert.ok(diagnosis.action);
  manifest.entrypoints.view='index.html';manifest.permissions.shell=true;await fs.writeFile(file,JSON.stringify(manifest));
  assert.equal(JSON.parse(run(['check',project,'--json']).stdout).diagnostics[0].code,'manifest.field');
});
test('duplicate JSON keys, ambiguous paths, native files and symlinks are refused',async t=>{
  assert.throws(()=>parseJson('{"permissions":{},"permissions":{"storage":true}}'),error=>error.code==='json.invalid');
  assert.throws(()=>parseJson('{"p":{"s":1,"\\u0073":2}}'));
  assert.throws(()=>parseJson('['.repeat(66)+'0'+']'.repeat(66)));
  for(const name of ['../secret','a/../b','a\\b','/etc/passwd','CON.txt','a./b','a:b','é.js'])assert.equal(validPath(name),false,name);
  const {project,temporary}=await fixture(t);
  await fs.writeFile(path.join(project,'widget/hidden.bin'),Buffer.from([0x7f,0x45,0x4c,0x46]));
  await assert.rejects(collect(project),error=>error.code==='file.native');await fs.unlink(path.join(project,'widget/hidden.bin'));
  const outside=path.join(temporary,'outside');await fs.mkdir(outside);
  await fs.writeFile(path.join(outside,'secret.txt'),'must not be packaged');
  await fs.symlink(outside,path.join(project,'widget/external'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(collect(project),error=>error.code==='path.symlink');
});
test('checklist storage permission and locale/network rules survive export',async t=>{
  const {project}=await fixture(t,'checklist');
  const file=path.join(project,'widget/manifest.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));
  manifest.localization={defaultLocale:'fr',availableLocales:['fr','en']};
  manifest.permissions.network=[{origin:'https://api.example.com',method:'GET',pathPrefix:'/v2/'}];
  manifest.permissions.gameEvents=['overcrow.game.session.v1'];
  await fs.writeFile(file,JSON.stringify(manifest));
  const bundle=await collect(project);assert.equal(bundle.manifest.permissions.storage,true);assert.deepEqual(bundle.manifest.localization,manifest.localization);
  for(const origin of ['https://localhost','https://127.0.0.1','http://api.example.com','https://api.example.com/']) {
    manifest.permissions.network[0].origin=origin;await fs.writeFile(file,JSON.stringify(manifest));
    await assert.rejects(collect(project));
  }
});
test('preview serves only a frozen widget generation and rejects traversal and foreign hosts',async t=>{
  const {project}=await fixture(t);
  const preview=await startPreview(project,0);t.after(()=>preview.close());
  const response=await fetch(preview.url);assert.equal(response.status,200);
  const shell=await response.text();assert.match(shell,/Simulation navigateur/);
  assert.match(shell,/id="widget-host"/);
  assert.match(shell,/aria-label="Options du widget"/);
  assert.match(shell,/Taille du contenu/);
  assert.match(shell,/Opacité du fond/);
  const modules=['app.js'], visited=new Set();
  for (const name of modules) {
    if (visited.has(name)) continue;
    visited.add(name);
    const resource=await fetch(preview.url+name);
    assert.equal(resource.status,200,`Preview module ${name} must be served`);
    assert.ok(resource.headers.get('content-type').startsWith('text/javascript'),name);
    const source=await resource.text();
    for (const match of source.matchAll(/(?:from|import)\s*['"]\.\/([^'"]+)['"]/g)) modules.push(match[1]);
  }
  for(const [asset,type] of [['chrome.mjs','text/javascript'],['chrome-messages.mjs','text/javascript'],['NotoSansUI-Regular.ttf','font/ttf']]) {
    const resource=await fetch(preview.url+asset);assert.equal(resource.status,200,asset);
    assert.ok(resource.headers.get('content-type').startsWith(type),asset);
    assert.ok((await resource.arrayBuffer()).byteLength>0,asset);
  }
  assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
  const html=await fetch(preview.url+'view/index.html').then(r=>r.text());assert.match(html,/bridge\.js\?id=com.example.test/);
  assert.equal((await fetch(preview.url+'../package.json')).status,404);
  assert.equal((await fetch(preview.url+'view/../tooling/overcrow.mjs')).status,404);
  const foreignHost=await new Promise((resolve,reject)=>get(preview.url,{headers:{Host:'attacker.invalid'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));
  assert.equal(foreignHost,403);
  assert.equal((await fetch(preview.url,{method:'POST'})).status,403);
  assert.equal((await fetch(preview.url,{headers:{Origin:'https://attacker.invalid'}})).status,403);
});
test('watch preserves the last good generation and requires restart for permission changes',async t=>{
  const {project}=await fixture(t);
  const preview=await startPreview(project,0);t.after(()=>preview.close());
  const abort=new AbortController();t.after(()=>abort.abort());
  const response=await fetch(preview.url+'events',{signal:abort.signal});const reader=response.body.getReader();
  let buffer='';
  async function nextEvent(predicate=()=>true) {
    const timeout=AbortSignal.timeout(6000);
    while(true) {
      const end=buffer.indexOf('\n\n');
      if(end>=0){const event=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(event))return event;continue;}
      const read=reader.read();
      const result=await Promise.race([read,new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(new Error('watch timeout')),{once:true}))]);
      if(result.done)throw new Error('stream closed');buffer+=new TextDecoder().decode(result.value);
    }
  }
  assert.equal((await nextEvent()).generation,1);
  const file=path.join(project,'widget/manifest.json'),original=await fs.readFile(file,'utf8');
  await fs.writeFile(file,'{');const failure=await nextEvent(e=>Boolean(e.error));assert.equal(failure.generation,1);
  assert.equal((await fetch(preview.url+'state.json').then(r=>r.json())).generation,1);
  await fs.writeFile(file,original);await fs.appendFile(path.join(project,'widget/styles.css'),'\n/* edit */');
  assert.equal((await nextEvent(e=>e.generation===2)).generation,2);
  const changed=JSON.parse(original);changed.permissions.storage=true;await fs.writeFile(file,JSON.stringify(changed));
  assert.equal((await nextEvent(e=>Boolean(e.error))).error.code,'preview.permissions');
  assert.equal((await fetch(preview.url+'state.json').then(r=>r.json())).manifest.permissions.storage,false);
  abort.abort();
});
test('bad fixtures prevent a misleading preview and remain outside exported packages',async t=>{
  const {project}=await fixture(t);
  await fs.writeFile(path.join(project,'preview.json'),'{"responses":[{"url":"https://api.example.com/v2/","status":999,"json":{}}]}');
  await assert.rejects(startPreview(project,0),error=>error.code==='preview.fixture');
  const bundle=await collect(project);assert.equal(bundle.entries.has('preview.json'),false);
  const output=await packageProject(project);assert.ok(output.bytes>0);
});

test('blank starts with only four authored files and produces a valid widget package', async t => {
  const {project} = await fixture(t, 'blank');
  const names = (await fs.readdir(path.join(project, 'widget'))).sort();
  assert.deepEqual(names, ['LICENSE', 'index.html', 'manifest.json', 'overcrow.d.ts', 'overcrow.js', 'styles.css', 'view.js']);
  const bundle = await collect(project);
  assert.deepEqual(bundle.manifest.entrypoints, {view: 'index.html'});
  assert.equal(bundle.manifest.permissions.storage, false);
  assert.equal(run(['package', project]).status, 0);
});
