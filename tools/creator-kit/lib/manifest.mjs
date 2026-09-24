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
export const WEB_CAPABILITIES=Object.freeze([
  'telemetry.read','fps.read','media.read','media.control',
]);
export const SENSITIVE_WEB_CAPABILITIES=Object.freeze(['media.read','media.control']);
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
  fields(manifest,['schemaVersion','id','version','apiVersion','entrypoints','permissions','localization','presentation','files'],'');
  const require=(condition,pointer,message,action='Corrigez ce champ dans widget/manifest.json.')=>{if(!condition)fail('manifest.invalid',message,action,pointer);};
  require(manifest.schemaVersion===1,'/schemaVersion','schemaVersion doit être le nombre 1.');
  require(['1','2'].includes(manifest.apiVersion),'/apiVersion','apiVersion doit être la chaîne "1" ou "2".');
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
  fields(manifest.permissions,['network','gameEvents','storage','clipboardWrite','capabilities'],'/permissions');
  require(manifest.apiVersion==='2'||(!Object.hasOwn(manifest.permissions,'capabilities')&&!Object.hasOwn(manifest,'presentation')),'/apiVersion','Les capacités et la présentation native nécessitent apiVersion "2".');
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
  if(Object.hasOwn(manifest.permissions,'capabilities')) {
    const capabilities=manifest.permissions.capabilities;
    require(Array.isArray(capabilities)&&capabilities.every(capability=>WEB_CAPABILITIES.includes(capability))&&new Set(capabilities).size===capabilities.length,'/permissions/capabilities','Liste de capacités connues et uniques attendue.');
    require(!capabilities.some(capability=>SENSITIVE_WEB_CAPABILITIES.includes(capability))||(network.length===0&&!manifest.permissions.clipboardWrite),'/permissions','Une capacité sensible ne peut pas être combinée au réseau ou au presse-papiers brut.');
  }
  if(Object.hasOwn(manifest,'presentation')) validatePresentation(manifest.presentation,require);
  if(manifest.localization!==undefined) {
    const loc=manifest.localization;fields(loc,['defaultLocale','availableLocales'],'/localization');
    require(Array.isArray(loc.availableLocales)&&loc.availableLocales.length>=1&&loc.availableLocales.length<=16&&loc.availableLocales.every(l=>typeof l==='string'&&/^[a-z]{2}(?:-[A-Z]{2})?$/.test(l))&&new Set(loc.availableLocales).size===loc.availableLocales.length&&loc.availableLocales.includes(loc.defaultLocale),'/localization','Déclarez 1 à 16 langues uniques, dont la langue par défaut.');
  }
  return manifest;
}

function validatePresentation(presentation,require) {
  const pointer='/presentation';
  fields(presentation,['sizing','options'],pointer);
  const sizing=presentation.sizing;
  fields(sizing,['mode','preferred','min','max'],pointer+'/sizing');
  require(['intrinsic','autoHeight','manual'].includes(sizing.mode),pointer+'/sizing/mode','Mode de taille natif invalide.');
  for(const key of ['preferred','min','max']) {
    const size=sizing[key];fields(size,['width','height'],`${pointer}/sizing/${key}`);
    for(const axis of ['width','height']) require(Number.isInteger(size[axis])&&size[axis]>=1&&size[axis]<=4096,`${pointer}/sizing/${key}/${axis}`,'Dimension entière entre 1 et 4096 attendue.');
  }
  for(const axis of ['width','height']) require(sizing.min[axis]<=sizing.preferred[axis]&&sizing.preferred[axis]<=sizing.max[axis],pointer+'/sizing','La taille préférée doit rester dans les bornes min/max.');
  const options=Object.hasOwn(presentation,'options')?presentation.options:[];
  require(Array.isArray(options)&&options.length<=16,pointer+'/options','Déclarez au maximum 16 options natives.');
  const ids=new Set();
  const identifier=value=>typeof value==='string'&&/^[a-z][A-Za-z0-9_-]{0,47}$/.test(value);
  const label=(value,path)=>{
    fields(value,['en','fr'],path);
    for(const locale of ['en','fr']) require(typeof value[locale]==='string'&&value[locale].length>0&&[...value[locale]].length<=80&&!/^\p{White_Space}|\p{White_Space}$/u.test(value[locale])&&!/\p{Cc}/u.test(value[locale]),`${path}/${locale}`,'Libellé EN/FR de 1 à 80 caractères, sans espaces aux extrémités ni caractères de contrôle.');
  };
  const number=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1000000;
  for(const [index,option] of options.entries()) {
    const path=`${pointer}/options/${index}`;
    require(object(option),path,'Objet option attendu.');
    const kind=option.type;
    require(['boolean','enum','number'].includes(kind),path+'/type','Type boolean, enum ou number attendu.');
    fields(option,['id','type','label','default',...(kind==='enum'?['choices']:kind==='number'?['min','max','step']:[])],path);
    require(identifier(option.id)&&!ids.has(option.id),path+'/id','Identifiant unique de 1 à 48 caractères ASCII attendu.');ids.add(option.id);
    label(option.label,path+'/label');
    if(kind==='boolean') require(typeof option.default==='boolean',path+'/default','Valeur booléenne attendue.');
    if(kind==='enum') {
      require(Array.isArray(option.choices)&&option.choices.length>=2&&option.choices.length<=16,path+'/choices','Déclarez entre 2 et 16 choix uniques.');
      const choices=new Set();
      for(const [choiceIndex,choice] of option.choices.entries()) {
        const choicePath=`${path}/choices/${choiceIndex}`;fields(choice,['value','label'],choicePath);
        require(identifier(choice.value)&&!choices.has(choice.value),choicePath+'/value','Valeur de choix unique attendue.');choices.add(choice.value);
        label(choice.label,choicePath+'/label');
      }
      require(choices.has(option.default),path+'/default','La valeur par défaut doit faire partie des choix.');
    }
    if(kind==='number') require([option.default,option.min,option.max,option.step].every(number)&&option.min<option.max&&option.default>=option.min&&option.default<=option.max&&option.step>0&&option.step<=option.max-option.min,path,'Bornes numériques finies (±1 000 000), valeur par défaut et pas positif attendus.');
  }
}
