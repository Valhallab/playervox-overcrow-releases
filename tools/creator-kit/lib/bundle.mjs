// MIT License. Copyright (c) 2026 Valhallab SASU.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CreatorError,fail,parseJson,validateManifest,validPath,MAX_BYTES,MAX_FILES} from './manifest.mjs';
import {zip} from './zip.mjs';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function noLinks(filename) {
  let current=path.resolve(filename);
  while(true) {
    const info=await fs.lstat(current);
    if(info.isSymbolicLink()) fail('path.symlink','Un lien symbolique ou une jonction est présent.','Utilisez un dossier et des fichiers réels.');
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}
export async function readRegular(filename,maximum=MAX_BYTES) {
  await noLinks(filename);
  const before=await fs.lstat(filename);
  if(!before.isFile()||before.nlink>1)fail('file.unsafe','Fichier spécial ou lien physique refusé.','Copiez la ressource dans un fichier ordinaire.');
  if(before.size>maximum)fail('file.limit','Fichier trop volumineux.','Réduisez la taille de la ressource.');
  const handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const opened=await handle.stat();
    if(!opened.isFile()||opened.ino!==before.ino||opened.dev!==before.dev)fail('file.changed','Le fichier a changé pendant sa lecture.','Attendez la fin de l’écriture puis réessayez.');
    const buffer=Buffer.alloc(before.size+1);let offset=0;
    while(offset<buffer.length) {const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
    const after=await handle.stat();
    if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail('file.changed','Le fichier a changé pendant sa lecture.','Attendez la fin de l’écriture puis réessayez.');
    return buffer.subarray(0,offset);
  } finally {await handle.close();}
}
export async function collect(project) {
  const root=path.join(path.resolve(project),'widget');
  await noLinks(root);
  const entries=new Map(),names=new Set();let total=0,count=0;
  async function walk(directory,prefix='') {
    for(const item of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)) {
      if(++count>MAX_FILES)fail('bundle.limit','Trop d’entrées dans widget/.','Retirez les ressources inutiles ; ne mettez pas node_modules dans widget/.');
      const name=prefix+item.name;
      if(!validPath(name))fail('path.invalid',`Chemin non portable : ${name}.`,'Utilisez des noms ASCII avec lettres, chiffres, tirets, points et underscores.');
      if(names.has(name.toLowerCase()))fail('path.collision',`Collision de casse : ${name}.`,'Renommez les fichiers pour qu’ils soient distincts sur Windows.');
      names.add(name.toLowerCase());
      const full=path.join(directory,item.name);
      if(item.isSymbolicLink())fail('path.symlink',`Lien refusé : ${name}.`,'Copiez le fichier réel dans widget/.');
      if(item.isDirectory()) {await walk(full,name+'/');continue;}
      const bytes=await readRegular(full,name==='manifest.json'?1024*1024:MAX_BYTES);
      total+=bytes.length;if(total>MAX_BYTES)fail('bundle.limit','Ressources supérieures à 128 Mio.','Réduisez le bundle.');
      const signature=bytes.subarray(0,4).toString('hex');
      if(/\.(so|dll|dylib|exe|node)$/i.test(name)||signature==='7f454c46'||bytes.subarray(0,2).toString()==='MZ'||['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca'].includes(signature))fail('file.native',`Fichier natif refusé : ${name}.`,'Un widget contient des ressources web, pas un exécutable natif.');
      entries.set(name,bytes);
    }
  }
  await walk(root);
  if(!entries.has('manifest.json'))fail('manifest.missing','widget/manifest.json est absent.','Initialisez un projet ou ajoutez le manifeste.');
  const manifest=parseJson(entries.get('manifest.json').toString('utf8'));
  validateManifest(manifest,new Set(entries.keys()));
  entries.delete('manifest.json');
  manifest.files=Object.fromEntries([...entries].map(([name,data])=>[name,{sha256:sha256(data),bytes:data.length}]));
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  if(bytes.length>1024*1024)fail('manifest.limit','Le manifeste généré dépasse 1 Mio.','Réduisez le nombre de ressources.');
  entries.set('manifest.json',bytes);
  const archive=zip(entries);
  return {root,manifest,entries,archive,digest:sha256(archive)};
}
export async function packageProject(project) {
  const bundle=await collect(project);
  const directory=path.join(path.resolve(project),'.overcrow-output');
  await fs.mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await noLinks(directory);
  if(!(await fs.stat(directory)).isDirectory())fail('output.invalid','La sortie n’est pas un dossier.','Libérez .overcrow-output et réessayez.');
  const archive=bundle.archive;
  const destination=path.join(directory,`${bundle.manifest.id}-${bundle.manifest.version}-${bundle.digest.slice(0,16)}.ocpkg`);
  const temporary=path.join(directory,`.${randomUUID()}.tmp`);
  await fs.writeFile(temporary,archive,{flag:'wx',mode:0o600});
  try {
    try {await fs.link(temporary,destination);}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      if(!(await readRegular(destination)).equals(archive))fail('output.exists','Un paquet différent existe à cette destination.','Conservez-le puis choisissez une nouvelle version.');
    }
  } finally {await fs.unlink(temporary);}
  return {file:destination,id:bundle.manifest.id,version:bundle.manifest.version,sha256:bundle.digest,bytes:archive.length};
}
export function diagnostic(error) {
  if(error instanceof CreatorError)return error.diagnostic();
  const known={ENOENT:['file.missing','Fichier ou dossier introuvable.','Vérifiez le dossier du projet et la présence de widget/manifest.json.'],EACCES:['file.denied','Accès au fichier refusé.','Choisissez un dossier qui vous appartient.'],EPERM:['file.denied','Opération refusée par le système.','Vérifiez les droits du dossier et les applications qui verrouillent le fichier.'],EADDRINUSE:['preview.port','Le port est déjà utilisé.','Arrêtez l’autre aperçu ou utilisez --port 4176.']};
  const [code,message,action]=known[error.code]??['creator.failed','L’opération a échoué.','Vérifiez les fichiers, les droits du dossier et la version de Node.js.'];
  return {code,severity:'error',message,action,pointer:'',docPath:'/docs/kit-createur/'};
}
