// MIT License. Copyright (c) 2026 Valhallab SASU.
// One store per preview runtime. It never reads or writes browser persistence.
export function createStorageSimulator() {
  const values = new Map(), encoder = new TextEncoder();
  const failure = code => ({metadata:{ok:false,error:{code,message:'Preview storage operation failed.'}},body:new ArrayBuffer(0)});
  function validJson(value, depth = 0) {
    if (depth > 64) return false;
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'object' && Object.values(value).every(item => validJson(item, depth + 1));
  }
  return meta => {
    if (!meta || meta.type !== 'storage' || !['get','set','remove'].includes(meta.operation)
        || typeof meta.key !== 'string' || !meta.key.length || encoder.encode(meta.key).byteLength > 128
        || Object.keys(meta).some(key => !['type','operation','key',...(meta.operation === 'set' ? ['value'] : [])].includes(key))) return failure('invalid_request');
    if (meta.operation === 'set') {
      if (typeof meta.value !== 'string' || encoder.encode(meta.value).byteLength > 65536) return failure('invalid_storage_value');
      try { if (!validJson(JSON.parse(meta.value))) return failure('invalid_storage_value'); }
      catch (_) { return failure('invalid_storage_value'); }
      if (!values.has(meta.key) && values.size >= 256) return failure('storage_quota_exceeded');
      values.set(meta.key, meta.value);
    } else if (meta.operation === 'remove') values.delete(meta.key);
    return {metadata:{ok:true,value:meta.operation === 'get' ? values.get(meta.key) ?? null : null},body:new ArrayBuffer(0)};
  };
}
