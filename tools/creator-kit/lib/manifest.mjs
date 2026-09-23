// MIT License. Copyright (c) 2026 Valhallab SASU.
// Authoring diagnostics only. OverCrow remains the installation authority.
export class CreatorError extends Error {
  constructor(code, message, action, pointer = '') {
    super(message); this.code=code; this.action=action; this.pointer=pointer;
  }
  diagnostic() { return {code:this.code,severity:'error',message:this.message,action:this.action,pointer:this.pointer,docPath:'/docs/kit-createur/'}; }
}
export const fail=(code,message,action,pointer)=>{throw new CreatorError(code,message,action,pointer);};
export const MAX_BYTES=128*1024*1024;
export const MAX_FILES=4096;
export function parseJson(source,maximum=1024*1024) {
  if(new TextEncoder().encode(source).length>maximum) fail('json.size','JSON trop volumineux.','Réduisez le fichier.');
  // JSON.parse accepts duplicate keys; reject them before interpreting permissions.
  const tokens=source.match(/"(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]|\S/g)||[];
  let i=0;
  function value(depth) {
    if(depth>64) throw new Error('depth');
    const token=tokens[i++];
    if(token==='{') {
      const keys=new Set();
      if(tokens[i]==='}') {i++;return;}
      while(true) {
        const key=JSON.parse(tokens[i++]);
        if(typeof key!=='string'||keys.has(key)||tokens[i++]!==':') throw new Error('key');
        keys.add(key);value(depth+1);
        const next=tokens[i++]; if(next==='}') return; if(next!==',') throw new Error('comma');
      }
    }
    if(token==='[') {
      if(tokens[i]===']') {i++;return;}
      while(true) {value(depth+1);const next=tokens[i++];if(next===']')return;if(next!==',')throw new Error('comma');}
    }
    JSON.parse(token);
  }
  try {value(0);if(i!==tokens.length)throw new Error('trailing');return JSON.parse(source);}
  catch {fail('json.invalid','JSON invalide, clé dupliquée ou imbrication excessive.','Corrigez la syntaxe et gardez une seule occurrence de chaque clé.');}
}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fields(value,allowed,pointer) {
  if(!object(value)) fail('manifest.object','Un objet est attendu.','Vérifiez le manifeste.',pointer);
  for(const key of Object.keys(value)) if(!allowed.includes(key)) fail('manifest.field',`Champ non reconnu : ${key}.`,'Retirez le champ ou consultez la référence du manifeste.',`${pointer}/${key}`);
}
export function validId(id) {
  return typeof id==='string'&&id.length>=3&&id.length<=128&&id.split('.').length>=2&&id.split('.').every(s=>s.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s));
}
export function validPath(file) {
  return typeof file==='string'&&file.length>0&&file.length<=192&&file.split('/').every(s=>/^[a-zA-Z0-9._-]+$/.test(s)&&s!=='.'&&s!=='..'&&!s.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
}
export function validateManifest(manifest,names) {
  fields(manifest,['schemaVersion','id','version','apiVersion','entrypoints','permissions','localization','files'],'');
  const require=(condition,pointer,message,action='Corrigez ce champ dans widget/manifest.json.')=>{if(!condition)fail('manifest.invalid',message,action,pointer);};
  require(manifest.schemaVersion===1,'/schemaVersion','schemaVersion doit être le nombre 1.');
  require(manifest.apiVersion==='1','/apiVersion','apiVersion doit être la chaîne "1".');
  require(validId(manifest.id),'/id','Identifiant attendu : domaine inversé en minuscules, par exemple com.example.counter.');
  const version=manifest.version;
  const match=typeof version==='string'&&version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  require(match&&match.slice(1,4).every(n=>BigInt(n)<=18446744073709551615n)&&(!match[4]||match[4].split('.').every(s=>!/^\d+$/.test(s)||s==='0'||!s.startsWith('0'))),'/version','Version SemVer attendue, par exemple 1.0.0.');
  fields(manifest.entrypoints,['view','controller'],'/entrypoints');
  require(typeof manifest.entrypoints.view==='string','/entrypoints/view','Déclarez le document HTML de la vue.');
  for(const [role,file] of Object.entries(manifest.entrypoints)) {
    require(validPath(file)&&file.endsWith('.html'),`/entrypoints/${role}`,'Chemin HTML local attendu.');
    require(names.has(file),`/entrypoints/${role}`,`Fichier absent : ${file}.`,'Ajoutez le fichier ou corrigez le chemin.');
  }
  fields(manifest.permissions,['network','gameEvents','storage','clipboardWrite'],'/permissions');
  for(const key of ['storage','clipboardWrite']) if(Object.hasOwn(manifest.permissions,key)) require(typeof manifest.permissions[key]==='boolean',`/permissions/${key}`,'Valeur booléenne attendue.');
  const network=manifest.permissions.network??[];
  require(Array.isArray(network),'/permissions/network','Liste attendue.');
  const seen=new Set();
  for(const [index,rule] of network.entries()) {
    const pointer=`/permissions/network/${index}`;fields(rule,['origin','method','pathPrefix'],pointer);
    let url;try{url=new URL(rule.origin);}catch{require(false,pointer+'/origin','Origine HTTPS invalide.');}
    require(url.protocol==='https:'&&url.origin===rule.origin&&url.hostname.includes('.')&&!/^\d+(?:\.\d+){3}$/.test(url.hostname)&&url.hostname.length<=253&&url.hostname.split('.').every(s=>s.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)),pointer+'/origin','Origine HTTPS canonique attendue, sans chemin ni identifiants.');
    require(['GET','POST','PUT','PATCH','DELETE'].includes(rule.method),pointer+'/method','Méthode réseau non prise en charge.');
    require(typeof rule.pathPrefix==='string'&&rule.pathPrefix.startsWith('/')&&rule.pathPrefix!=='/'&&!rule.pathPrefix.includes('//')&&rule.pathPrefix.slice(1).split('/').every(s=>s!=='.'&&s!=='..'&&/^[a-zA-Z0-9._~-]*$/.test(s)),pointer+'/pathPrefix','Préfixe explicite attendu, par exemple /v2/.');
    const identity=JSON.stringify([rule.origin,rule.method,rule.pathPrefix]);require(!seen.has(identity),pointer,'Permission réseau dupliquée.');seen.add(identity);
  }
  const events=manifest.permissions.gameEvents??[];
  require(Array.isArray(events),'/permissions/gameEvents','Liste attendue.');
  require(events.every(event=>typeof event==='string'&&/^overcrow\.game\.[a-z0-9.-]+\.v1$/.test(event)&&event.slice(14,-3).split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))&&new Set(events).size===events.length,'/permissions/gameEvents','Événements uniques overcrow.game.<nom>.v1 attendus.');
  if(manifest.localization!==undefined) {
    const loc=manifest.localization;fields(loc,['defaultLocale','availableLocales'],'/localization');
    require(Array.isArray(loc.availableLocales)&&loc.availableLocales.length>=1&&loc.availableLocales.length<=16&&loc.availableLocales.every(l=>typeof l==='string'&&/^[a-z]{2}(?:-[A-Z]{2})?$/.test(l))&&new Set(loc.availableLocales).size===loc.availableLocales.length&&loc.availableLocales.includes(loc.defaultLocale),'/localization','Déclarez 1 à 16 langues uniques, dont la langue par défaut.');
  }
  return manifest;
}
