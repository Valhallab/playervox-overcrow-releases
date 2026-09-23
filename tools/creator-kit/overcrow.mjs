#!/usr/bin/env node
// MIT License. Copyright (c) 2026 Valhallab SASU.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {collect,packageProject,noLinks,diagnostic} from './lib/bundle.mjs';
import {fail,validId} from './lib/manifest.mjs';
import {startPreview} from './lib/preview.mjs';
import {nativeAvailability,startNativeDevelopment} from './lib/native.mjs';
const kit=fileURLToPath(new URL('./',import.meta.url));
const args=process.argv.slice(2),command=args.shift();
const json=args.includes('--json');
const usage=`OverCrow Creator Kit 1.0.0 — Node.js 22+ — Windows / Linux

  node overcrow.mjs init mon-widget [--template blank|counter|checklist] [--id com.example.widget]
  node overcrow.mjs check [projet] [--json]
  node overcrow.mjs dev [projet] [--port 4175]
  node overcrow.mjs dev [projet] --native [--host /chemin/absolu] [--replay chemin/events.json] [--devtools]
  node overcrow.mjs package [projet] [--json]
  node overcrow.mjs doctor [--host /chemin/absolu] [--json]

Dans un projet créé : npm run dev, npm run check, npm run package.
dev reste une simulation navigateur ; dev --native utilise le runtime OverCrow installé.
`;
function parse(allowed,booleans=['--json']) {
  const options={};let project;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg.startsWith('--')) {
      if(!allowed.includes(arg)||Object.hasOwn(options,arg))fail('cli.argument',`Option inconnue ou répétée : ${arg}.`,'Consultez --help.');
      options[arg]=booleans.includes(arg)?true:args[++i];
      if(options[arg]===undefined||String(options[arg]).startsWith('--'))fail('cli.argument',`Valeur manquante pour ${arg}.`,'Consultez --help.');
    } else if(project===undefined)project=arg;
    else fail('cli.argument','Plusieurs dossiers ont été indiqués.','Indiquez un seul projet.');
  }
  return {project,options};
}
async function init(destination,options) {
  if(!destination)fail('cli.destination','Indiquez un nouveau dossier.','Exemple : init mon-widget');
  const template=options['--template']??'counter';
  if(!['blank','counter','checklist'].includes(template))fail('template.unknown','Template inconnu.','Choisissez blank, counter ou checklist.');
  const absolute=path.resolve(destination);await noLinks(path.dirname(absolute));
  const id=options['--id']??`com.example.widget-${randomUUID().slice(0,8)}`;
  if(!validId(id))fail('manifest.id','Identifiant invalide.','Exemple : --id com.example.mon-widget');
  // mkdir is exclusive: never merge a template with an existing user project.
  try{await fs.mkdir(absolute,{mode:0o700});}
  catch(error){if(error.code==='EEXIST')fail('project.exists','Le dossier existe déjà.','Choisissez un nouveau nom ; aucun fichier existant n’a été modifié.');throw error;}
  try {
    const packaged=await fs.stat(path.join(kit,'templates')).then(()=>true,()=>false);
    const templates=packaged?path.join(kit,'templates'):path.resolve(kit,'../../content/templates');
    const sdk=packaged?path.join(kit,'sdk'):path.resolve(kit,'../../content/sdk');
    await fs.cp(path.join(templates,template),path.join(absolute,'widget'),{recursive:true});
    for(const name of ['overcrow.js','overcrow.d.ts','LICENSE'])await fs.copyFile(path.join(sdk,name),path.join(absolute,'widget',name));
    const manifestPath=path.join(absolute,'widget/manifest.json');
    const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));manifest.id=id;delete manifest.files;
    await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    const tooling=path.join(absolute,'tooling');await fs.mkdir(tooling);
    for(const name of ['overcrow.mjs','lib','preview'])await fs.cp(path.join(kit,name),path.join(tooling,name),{recursive:true});
    await fs.copyFile(path.join(sdk,'LICENSE'),path.join(tooling,'LICENSE'));
    await fs.writeFile(path.join(absolute,'package.json'),JSON.stringify({name:id,version:'1.0.0',private:true,type:'module',engines:{node:'>=22'},scripts:{dev:'node tooling/overcrow.mjs dev',check:'node tooling/overcrow.mjs check',package:'node tooling/overcrow.mjs package',doctor:'node tooling/overcrow.mjs doctor'}},null,2)+'\n');
    await fs.writeFile(path.join(absolute,'preview.json'),JSON.stringify({responses:[]},null,2)+'\n');
    await fs.writeFile(path.join(absolute,'.gitignore'),'.overcrow-output/\nnode_modules/\n');
    await fs.writeFile(path.join(absolute,'README.md'),`# Mon widget OverCrow\n\nNode.js 22+ sous Windows ou Linux. Aucune dépendance à installer.\n\n- npm run dev : aperçu navigateur avec rechargement automatique.\n- npm run dev -- --native : test dans le runtime OverCrow installé.\n- npm run check : vérification des sources.\n- npm run package : export .ocpkg dans .overcrow-output.\n\nModifiez widget/index.html, widget/view.js et widget/styles.css.\nLes empreintes sont recalculées à chaque export ; ne les éditez pas.\nLe mode natif utilise le moteur réel dans une session hors écran ; utilisez npm run dev pour l’aperçu visuel.\nRelancez le mode natif après une modification du contrôleur.\nPour remplacer une version installée, augmentez version dans widget/manifest.json.\nLes permissions restent explicites. Ne mettez aucun secret dans widget/.\nConservez les notices MIT du SDK et des exemples.\nDocumentation : https://overcrow.playervox.com/docs/\n`);
    await collect(absolute);
    return {project:absolute,id,template};
  } catch(error) {
    // This directory was created exclusively above and has not been handed off.
    await fs.rm(absolute,{recursive:true,force:true});throw error;
  }
}
try {
  if(!command||['--help','help','-h'].includes(command)) {console.log(usage);}
  else {
    if(Number(process.versions.node.split('.')[0])<22)fail('node.version','Node.js 22 ou plus récent est nécessaire.','Installez une version LTS récente de Node.js.');
    let result;
    if(command==='init') {const {project,options}=parse(['--template','--id','--json']);result=await init(project,options);}
    else if(command==='doctor') {const {project,options}=parse(['--host','--json']);if(project)fail('cli.argument','doctor ne prend pas de dossier.','Utilisez doctor --json.');result={node:process.versions.node,platform:process.platform,kitVersion:'1.0.0',preview:'browser-simulation',nativeTest:await nativeAvailability({host:options['--host']})};}
    else if(command==='check'||command==='package') {const {project}=parse(['--json']);result=command==='package'?await packageProject(project??'.'):await collect(project??'.').then(b=>({id:b.manifest.id,files:b.entries.size,sha256:b.digest}));}
    else if(command==='dev') {
      const {project,options}=parse(['--port','--native','--host','--replay','--devtools'],['--native','--devtools']);
      if(options['--native']) {
        if(options['--port']!==undefined)fail('cli.argument','--port appartient à la simulation navigateur.','Retirez --port avec --native.');
        const session=await startNativeDevelopment(project??'.',{host:options['--host'],replay:options['--replay'],devtools:Boolean(options['--devtools']),onError:error=>console.error(`${error.code}: ${error.message}\n${error.action}`),onSnapshot:snapshot=>console.log(`Génération native acceptée : ${snapshot.generation}.`)});
        console.log(`Test natif OverCrow : ${session.host}\nModifiez widget/ ; seules les générations valides et acceptées sont rechargées.\nRelancez cette commande après une modification du contrôleur.\nCtrl+C pour arrêter.`);
        let closing=false;const shutdown=async()=>{if(closing)return;closing=true;try{await session.close();}catch(error){const entry=diagnostic(error);console.error(`${entry.code}: ${entry.message}\n${entry.action}`);process.exitCode=1;}finally{process.stdin.pause();}};
        for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void shutdown();});
        process.stdin.once('end',()=>{void shutdown();});process.stdin.resume();
        void session.done.then(()=>{if(!closing){process.exitCode=1;process.stdin.pause();}});
      } else {
        if(options['--host']!==undefined||options['--replay']!==undefined||options['--devtools'])fail('cli.argument','--host, --replay et --devtools nécessitent --native.','Ajoutez --native ou retirez ces options de la simulation navigateur.');
        const port=options['--port']===undefined?4175:Number(options['--port']);
        if(!Number.isInteger(port)||port<1024||port>65535)fail('preview.port','Port invalide.','Choisissez un entier entre 1024 et 65535.');
        const preview=await startPreview(project??'.',port);
        console.log(`Simulation OverCrow : ${preview.url}\nModifiez widget/ ; les versions valides se rechargent automatiquement.\nCtrl+C pour arrêter.`);
        for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>preview.close());
      }
    } else fail('cli.command','Commande inconnue.','Consultez --help.');
    if(result)console.log(json?JSON.stringify({schemaVersion:1,ok:true,...result,diagnostics:[]}):Object.entries(result).map(([key,value])=>key==='nativeTest'?`${key}: ${value.available?'available':'unavailable'}${value.path?` (${value.path})`:''}`:`${key}: ${value}`).join('\n')+(command==='init'?'\nOuvrez ce dossier, puis lancez npm run dev.':''));
  }
} catch(error) {
  const entry=diagnostic(error);
  if(json)console.log(JSON.stringify({schemaVersion:1,ok:false,diagnostics:[entry]}));
  else console.error(`${entry.code}: ${entry.message}\n${entry.pointer?entry.pointer+'\n':''}${entry.action}`);
  process.exitCode=1;
}
