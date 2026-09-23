// MIT License. Copyright (c) 2026 Valhallab SASU.
// Deterministic fixture transport: this module never performs network I/O.
export function simulateFetch(permissions,fixtures,request) {
  const failure=(code,message)=>({metadata:{ok:false,error:{code,message}},body:new ArrayBuffer(0)});
  let url;try{url=new URL(request.url);}catch{}
  const safe=url&&!url.username&&!url.password&&!url.hash&&!/\\|\/\/|%2e|%2f|%5c|%25/i.test(url.pathname);
  const permitted=safe&&(permissions.network??[]).some(rule=>rule.origin===url.origin&&rule.method===request.method&&(url.pathname===rule.pathPrefix||(rule.pathPrefix.endsWith('/')&&url.pathname.startsWith(rule.pathPrefix))));
  if(!permitted)return failure('capability_denied','Network permission is not declared or the request path is not allowed.');
  const fixture=fixtures.find(item=>item.url===request.url&&(item.method??'GET')===request.method);
  if(!fixture)return failure('fixture_missing','Add a matching response to preview.json. No external network request was made.');
  const json=Object.hasOwn(fixture,'json');
  return {metadata:{ok:true,status:fixture.status,contentType:json?'application/json':'text/plain'},body:new TextEncoder().encode(json?JSON.stringify(fixture.json):fixture.text).buffer};
}
