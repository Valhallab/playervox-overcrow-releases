// MIT License. Copyright (c) 2026 Valhallab SASU.
// Shared authoring and fixture-only preview policy. Native OverCrow authorizes I/O.
const encoder=new TextEncoder();
const namePattern=/^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const segmentPattern=/^[A-Za-z0-9._~-]+$/;
const methods=['GET','POST','PUT','PATCH','DELETE'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeInteger=value=>Number.isSafeInteger(value)&&value>=0;
const fixedSegment=value=>segmentPattern.test(value)&&value!=='.'&&value!=='..';
const parameter=segment=>/^\{([A-Za-z][A-Za-z0-9_]{0,31})\}$/.exec(segment)?.[1];

export class NetworkPolicyError extends Error {
  constructor(message,pointer){super(message);this.pointer=pointer;}
}
function require(condition,pointer,message) {
  if(!condition)throw new NetworkPolicyError(message,pointer);
}
function fields(value,allowed,pointer) {
  require(object(value),pointer,'Expected an object.');
  for(const key of Object.keys(value))require(allowed.includes(key),`${pointer}/${key}`,`Unknown network field: ${key}.`);
}
function constraint(value,query,pointer) {
  require(object(value),pointer,'Expected a parameter constraint.');
  const type=value.type;
  require(['integer','slug','enum',...(query?['string']:[])].includes(type),pointer+'/type','Invalid network parameter type.');
  fields(value,['type',...(type==='integer'?['min','max']:type==='enum'?['values']:['maxLength']),...(query?['required']:[])],pointer);
  let result;
  if(type==='integer') {
    require(safeInteger(value.min)&&safeInteger(value.max)&&value.min<=value.max,pointer,'Required integer bounds must satisfy 0 <= min <= max <= 9007199254740991.');
    result={type,min:value.min,max:value.max};
  } else if(type==='enum') {
    require(Array.isArray(value.values)&&value.values.length>=1&&value.values.length<=32&&value.values.every(item=>typeof item==='string'&&item.length<=128&&fixedSegment(item))&&new Set(value.values).size===value.values.length,pointer+'/values','Declare 1 to 32 distinct ASCII unreserved values of 1 to 128 bytes, excluding . and ...');
    result={type,values:[...value.values].sort()};
  } else {
    const maximum=type==='string'?256:128;
    require(safeInteger(value.maxLength)&&value.maxLength>=1&&value.maxLength<=maximum,pointer+'/maxLength',`Required maxLength must be an integer between 1 and ${maximum}.`);
    result={type,maxLength:value.maxLength};
  }
  if(query) {
    require(!Object.hasOwn(value,'required')||typeof value.required==='boolean',pointer+'/required','Expected a boolean.');
    result.required=value.required??false;
  }
  return result;
}
function parameters(rule,key,maximum,query,pointer) {
  const values=Object.hasOwn(rule,key)?rule[key]:{};
  require(object(values),`${pointer}/${key}`,'Expected a parameter map.');
  const names=Object.keys(values).sort();
  require(names.length<=maximum,`${pointer}/${key}`,`Declare at most ${maximum} parameters.`);
  return Object.fromEntries(names.map(name=>{
    const location=`${pointer}/${key}/${name}`;
    require(namePattern.test(name),location,'Invalid ASCII parameter name.');
    return [name,constraint(values[name],query,location)];
  }));
}
function canonicalRule(rule,pointer) {
  fields(rule,['origin','method','path','pathParams','queryParams'],pointer);
  let url;try{url=new URL(rule.origin);}catch{}
  require(url?.protocol==='https:'&&url.origin===rule.origin&&url.hostname.includes('.')&&!/^\d+(?:\.\d+){3}$/.test(url.hostname)&&url.hostname.length<=253&&url.hostname.split('.').every(part=>part.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)),pointer+'/origin','Expected a canonical HTTPS origin without paths or credentials.');
  require(methods.includes(rule.method),pointer+'/method','Unsupported network method.');
  const path=rule.path;
  require(typeof path==='string'&&path.length>=2&&path.length<=1024&&path.startsWith('/')&&!path.includes('//'),pointer+'/path','Expected an exact ASCII path of at most 1024 bytes, beginning with / and different from /.');
  const segments=path.slice(1).split('/'),placeholders=[];
  for(const [index,segment] of segments.entries()) {
    const name=parameter(segment);
    require(name!==undefined||fixedSegment(segment)||(segment===''&&index===segments.length-1),pointer+'/path','Use fixed segments or whole {name} parameters, without encoding or traversal.');
    if(name!==undefined)placeholders.push(name);
  }
  const pathParams=parameters(rule,'pathParams',8,false,pointer),queryParams=parameters(rule,'queryParams',16,true,pointer);
  require(placeholders.length===new Set(placeholders).size&&placeholders.length===Object.keys(pathParams).length&&placeholders.every(name=>Object.hasOwn(pathParams,name)),pointer+'/pathParams','Every path parameter must appear exactly once and have exactly one definition, with no unused definitions.');
  return {origin:rule.origin,method:rule.method,path,pathParams,queryParams};
}

// Field, map, enum and rule order are immaterial; every constraint stays in the key.
export function networkRuleKey(rule) {
  return JSON.stringify(canonicalRule(rule,'/permissions/network'));
}
export function canonicalNetworkRules(network) {
  require(Array.isArray(network)&&network.length<=32,'/permissions/network','Declare at most 32 network routes.');
  const keys=new Set();
  const rules=network.map((rule,index)=>{
    const pointer=`/permissions/network/${index}`,canonical=canonicalRule(rule,pointer),key=JSON.stringify(canonical);
    require(!keys.has(key),pointer,'Duplicate network permission.');keys.add(key);
    return [key,canonical];
  });
  return rules.sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,rule])=>rule);
}

function matchesValue(value,constraint) {
  if(constraint.type==='integer') {
    if(!/^(?:0|[1-9][0-9]*)$/.test(value))return false;
    const number=Number(value);
    return Number.isSafeInteger(number)&&number>=constraint.min&&number<=constraint.max;
  }
  if(constraint.type==='slug')return value.length<=constraint.maxLength&&/^[A-Za-z0-9_-]+$/.test(value);
  if(constraint.type==='enum')return constraint.values.includes(value);
  return value.length>0&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)&&encoder.encode(value).length<=constraint.maxLength;
}
function requestParts(request) {
  const raw=request?.url;
  if(typeof raw!=='string'||encoder.encode(raw).length>2048||/[\\#\u0000-\u0020\u007f-\u009f]/u.test(raw))return null;
  // Inspect the literal path before URL can erase dot segments or separators.
  const match=/^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?$/i.exec(raw);
  if(!match||match[1].includes('@'))return null;
  const pathname=match[2]??'/',segments=pathname.slice(1).split('/');
  if(segments.some((segment,index)=>!fixedSegment(segment)&&!(segment===''&&index===segments.length-1)))return null;
  let url;try{encodeURIComponent(raw);url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!==pathname)return null;
  const query=new Map();
  if(match[3]!==undefined) {
    if(match[3]==='')return null;
    for(const pair of match[3].split('&')) {
      const equals=pair.indexOf('='),key=pair.slice(0,equals);
      if(equals<1||!namePattern.test(key)||query.has(key))return null;
      let value;try{value=decodeURIComponent(pair.slice(equals+1).replace(/\+/g,' '));}catch{return null;}
      if(!value)return null;
      query.set(key,value);
    }
  }
  return {origin:url.origin,method:request.method,segments,query};
}
function matchesRule(rule,request) {
  if(rule.origin!==request.origin||rule.method!==request.method)return false;
  const segments=rule.path.slice(1).split('/');
  if(segments.length!==request.segments.length)return false;
  if(!segments.every((segment,index)=>{
    const name=parameter(segment),value=request.segments[index];
    return name===undefined?segment===value:matchesValue(value,rule.pathParams[name]);
  }))return false;
  for(const [name,value] of request.query)if(!Object.hasOwn(rule.queryParams,name)||!matchesValue(value,rule.queryParams[name]))return false;
  return Object.entries(rule.queryParams).every(([name,value])=>!value.required||request.query.has(name));
}
export function networkRequestAllowed(network,request) {
  let rules;try{rules=canonicalNetworkRules(network);}catch{return false;}
  const parts=requestParts(request);
  return parts!==null&&rules.some(rule=>matchesRule(rule,parts));
}
