// MIT License. Copyright (c) 2026 Valhallab SASU.
import {MAX_BYTES,MAX_FILES,fail} from './manifest.mjs';
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
export function zip(entries) {
  if(!entries.size||entries.size>MAX_FILES)fail('bundle.limit','Trop de fichiers.','Gardez au maximum 4 096 fichiers, manifeste compris.');
  const local=[],central=[];let offset=0;
  for(const [name,data] of [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    const filename=Buffer.from(name),crc=crc32(data),header=Buffer.alloc(30),record=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(0x314,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE((0o100644<<16)>>>0,38);record.writeUInt32LE(offset,42);
    local.push(header,filename,data);central.push(record,filename);offset+=header.length+filename.length+data.length;
    if(offset>MAX_BYTES)fail('bundle.limit','Paquet supérieur à 128 Mio.','Réduisez les ressources incluses.');
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  if(offset+directory.length+end.length>MAX_BYTES)fail('bundle.limit','Paquet supérieur à 128 Mio.','Réduisez les ressources incluses.');
  return Buffer.concat([...local,directory,end]);
}
