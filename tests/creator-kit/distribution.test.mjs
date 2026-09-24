import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

test('the actual downloadable archive can initialize, validate and export without the repository',async t=>{
  const archive=await readFile(new URL('../../published/docs/downloads/creator-kit.zip',import.meta.url));
  const temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'creator-distribution-')));t.after(()=>rm(temporary,{recursive:true,force:true}));
  let offset=0,files=0;
  while(archive.readUInt32LE(offset)===0x04034b50) {
    assert.equal(archive.readUInt16LE(offset+8),0,'distribution must use stored entries');
    const size=archive.readUInt32LE(offset+18),nameLength=archive.readUInt16LE(offset+26),extraLength=archive.readUInt16LE(offset+28);
    const name=archive.subarray(offset+30,offset+30+nameLength).toString();
    assert.match(name,/^overcrow-creator-kit\/[a-zA-Z0-9._/-]+$/);assert.ok(!name.split('/').includes('..'));
    const start=offset+30+nameLength+extraLength,filename=path.join(temporary,name);
    await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,archive.subarray(start,start+size));
    offset=start+size;files++;
  }
  assert.ok(files>15);assert.equal(archive.readUInt32LE(offset),0x02014b50);
  const cli=path.join(temporary,'overcrow-creator-kit/overcrow.mjs'),project=path.join(temporary,'Projet autonome');
  const run=args=>spawnSync(process.execPath,[cli,...args],{cwd:temporary,encoding:'utf8',timeout:10000});
  let result=run(['init',project,'--template','checklist','--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  result=run(['check',project,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  result=run(['package',project,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const output=JSON.parse(result.stdout);assert.equal((await readFile(output.file)).length,output.bytes);
  const shippedSdk=await readFile(path.join(project,'widget/overcrow.js'));
  assert.deepEqual(shippedSdk,await readFile(new URL('../../content/sdk/overcrow.js',import.meta.url)));
  for(const name of ['chrome.mjs','chrome-messages.mjs','services.mjs','service-fixtures.mjs','NotoSansUI-Regular.ttf','NotoSans-OFL.txt']) {
    assert.deepEqual(await readFile(path.join(project,'tooling/preview',name)),await readFile(new URL(`../../tools/creator-kit/preview/${name}`,import.meta.url)));
  }
  const {startPreview}=await import(pathToFileURL(path.join(project,'tooling/lib/preview.mjs')));
  const preview=await startPreview(project,0);t.after(()=>preview.close());
  assert.match(await fetch(preview.url).then(response=>response.text()),/id="widget-host"/);
  assert.equal((await fetch(preview.url+'chrome.mjs')).status,200);
  assert.equal((await fetch(preview.url+'chrome-messages.mjs')).status,200);
  assert.equal((await fetch(preview.url+'NotoSansUI-Regular.ttf')).status,200);
  assert.equal((await fetch(preview.url+'services.mjs')).status,200);
  assert.equal((await fetch(preview.url+'service-fixtures.mjs')).status,200);
  const reference=path.join(temporary,'Isolated notes reference');
  result=run(['init',reference,'--template','notes','--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  result=run(['package',reference,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const nativeManifest=JSON.parse(await readFile(path.join(reference,'widget/manifest.json'),'utf8'));
  assert.equal(nativeManifest.apiVersion,'2');assert.deepEqual(nativeManifest.permissions.capabilities,[]);assert.equal(nativeManifest.permissions.storage,true);
});
