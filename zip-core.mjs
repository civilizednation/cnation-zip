export const MAX_BYTES = 512 * 1000 * 1000;
export const MAX_PARTS = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const table = Uint32Array.from({length:256}, (_, n) => {for(let j=0;j<8;j++) n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crcUpdate(crc, a) {for(const b of a) crc=table[(crc^b)&255]^(crc>>>8);return crc;}
function block(n) {const a=new Uint8Array(n);return [a,new DataView(a.buffer)];}
export function cleanName(s) {return (s||'archive').normalize('NFC').replace(/\.zip$/i,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'').trim().slice(0,80)||'archive';}
function cleanPath(s) {return s.replaceAll('\\','/').split('/').filter(x=>x && x!=='.' && x!=='..').join('/')||'file';}
function stamp(ms) {const d=new Date(ms||Date.now());const y=Math.max(1980,Math.min(2107,d.getFullYear()));return [d.getHours()<<11|d.getMinutes()<<5|d.getSeconds()>>1,(y-1980)<<9|(d.getMonth()+1)<<5|d.getDate()];}
function entryHeaders(name,size,compressed,crc,method,offset,modified) {
 const n=encoder.encode(name);if(n.length>65535)throw Error('파일 경로가 너무 깁니다.');
 const [time,date]=stamp(modified);const [l,v]=block(30+n.length);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(8,method,true);v.setUint16(10,time,true);v.setUint16(12,date,true);v.setUint32(14,crc,true);v.setUint32(18,compressed,true);v.setUint32(22,size,true);v.setUint16(26,n.length,true);l.set(n,30);
 const [c,w]=block(46+n.length);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);c.set(l.subarray(6,28),8);w.setUint32(42,offset,true);c.set(n,46);
 return [l,c];
}
function finish(parts,central,offset,count) {const cd=new Blob(central);const [end,v]=block(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,count,true);v.setUint16(10,count,true);v.setUint32(12,cd.size,true);v.setUint32(16,offset,true);return new Blob([...parts,cd,end],{type:'application/zip'});}
export async function archive(files, progress=()=>{}, relativePaths=[]) {
 if(!files.length)throw Error('파일을 먼저 선택해 주세요.');
 if(files.length>10000)throw Error('한 번에 파일 10,000개까지 선택할 수 있습니다.');
 const total=files.reduce((n,f)=>n+f.size,0);if(total>MAX_BYTES)throw Error('한 번에 최대 512 MB까지 처리할 수 있습니다. 파일을 나눠 선택해 주세요.');
 const parts=[],central=[],paths=new Set();let offset=0,done=0,usedCompression=false;
 let canCompress=false;try {new CompressionStream('deflate-raw');canCompress=true;}catch{}
 for(let i=0;i<files.length;i++) {
  const f=files[i];let path=cleanPath(relativePaths[i]||f.webkitRelativePath||f.name);const original=path;let suffix=2;
  while(paths.has(path)){const slash=original.lastIndexOf('/');path=original.slice(0,slash+1)+`(${suffix++}) `+original.slice(slash+1);}paths.add(path);
  let crc=0xffffffff,read=0;const source=f.stream().pipeThrough(new TransformStream({transform(chunk,ctl){crc=crcUpdate(crc,chunk);read+=chunk.length;progress({value:Math.round((done+read)/Math.max(total,1)*70),text:`압축 중 · ${i+1}/${files.length}개`});ctl.enqueue(chunk);}}));
  const skip=/\.(zip|7z|rar|gz|jpg|jpeg|png|heic|mp4|mov|mp3|pdf)$/i.test(path);
  const method=canCompress&&!skip&&f.size>0?8:0;
  let data=await new Response(method?source.pipeThrough(new CompressionStream('deflate-raw')):source).blob();
  let selectedMethod=method;if(data.size>=f.size){data=f;selectedMethod=0;}else if(method)usedCompression=true;
  const [local,cd]=entryHeaders(path,f.size,data.size,(crc^0xffffffff)>>>0,selectedMethod,offset,f.lastModified);
  parts.push(local,data);central.push(cd);offset+=local.length+data.size;done+=f.size;
 }
 return {blob:finish(parts,central,offset,files.length),usedCompression,canCompress};
}
function storeZip(entries) {const parts=[],central=[];let offset=0;for(const [name,data] of entries){const crc=(crcUpdate(0xffffffff,data)^0xffffffff)>>>0;const [h,c]=entryHeaders(name,data.length,data.length,crc,0,offset);parts.push(h,data);central.push(c);offset+=h.length+data.length;}return finish(parts,central,offset,entries.length);}
async function digest(a) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function splitArchive(blob,name,mode,value,progress=()=>{}) {
 name=cleanName(name);if(!Number.isFinite(value)||value<=0)throw Error('올바른 용량 또는 개수를 입력해 주세요.');
 if(mode!=='size'&&mode!=='count')throw Error('분할 방식을 확인해 주세요.');
 if(mode==='size'&&(value<0.01||value>512))throw Error('용량은 0.01~512 MB 사이로 입력해 주세요.');
 const maxBytes=Math.floor(value*1000000),payload=mode==='size'?maxBytes-4096:0;
 const count=mode==='count'?value:(blob.size<=maxBytes?1:Math.ceil(blob.size/payload));
 if(blob.size>MAX_BYTES+10*1000*1000)throw Error('ZIP 크기가 처리 한도를 넘습니다. 파일을 더 적게 선택해 주세요.');
 if(!Number.isInteger(count)||count<1||count>MAX_PARTS)throw Error('분할 개수는 1~200개여야 합니다. 용량을 늘리거나 개수를 줄여 주세요.');
 if(count>blob.size)throw Error('파일 크기보다 분할 개수가 많습니다.');
 // A single output is a normal ZIP that opens directly in Files.
 if(count===1)return [{name:`${name}_01.zip`,blob,ordinary:true}];
 const setId=crypto.randomUUID();const result=[];const digits=Math.max(2,String(count).length);
 for(let i=0;i<count;i++) {
  const start=mode==='size'?i*payload:Math.floor(blob.size*i/count);const end=mode==='size'?Math.min(blob.size,start+payload):Math.floor(blob.size*(i+1)/count);
  const data=new Uint8Array(await blob.slice(start,end).arrayBuffer());
  const meta={format:'cnation-split-zip-v1',setId,index:i+1,count,name:`${name}.zip`,totalBytes:blob.size,offset:start,bytes:data.length,sha256:await digest(data)};
  const out=storeZip([['cnation.json',encoder.encode(JSON.stringify(meta))],['payload.bin',data]]);
  if(mode==='size'&&out.size>maxBytes)throw Error('분할 용량을 맞추지 못했습니다. 용량을 조금 늘려 주세요.');
  result.push({name:`${name}_${String(i+1).padStart(digits,'0')}.zip`,blob:out,ordinary:false});progress({value:70+Math.round((i+1)/count*30),text:`ZIP 나누는 중 · ${i+1}/${count}개`});
 }
 return result;
}
async function readPart(file) {
 let pos=0;const values={};for(let i=0;i<2;i++){
  const raw=await file.slice(pos,pos+30).arrayBuffer();if(raw.byteLength!==30)throw Error('분할 ZIP 파일이 아닙니다.');const v=new DataView(raw);
  if(v.getUint32(0,true)!==0x04034b50||v.getUint16(8,true)!==0||(v.getUint16(6,true)&9))throw Error('이 앱에서 만든 분할 ZIP을 선택해 주세요.');
  const size=v.getUint32(18,true),n=v.getUint16(26,true),extra=v.getUint16(28,true);const start=pos+30+n+extra;
  if(start+size>file.size||size>MAX_BYTES)throw Error('파일이 잘렸거나 너무 큽니다.');
  const name=decoder.decode(await file.slice(pos+30,pos+30+n).arrayBuffer());
  if((i===0&&name!=='cnation.json')||(i===1&&name!=='payload.bin'))throw Error('이 앱에서 만든 분할 ZIP을 선택해 주세요.');
  if(i===0&&size>4096)throw Error('분할 정보가 올바르지 않습니다.');values[name]=file.slice(start,start+size);pos=start+size;
 }
 let meta;try{meta=JSON.parse(await values['cnation.json'].text());}catch{throw Error('분할 정보를 읽을 수 없습니다.');}
 if(meta.format!=='cnation-split-zip-v1'||typeof meta.setId!=='string'||!Number.isInteger(meta.count)||meta.count<2||meta.count>MAX_PARTS||!Number.isInteger(meta.index)||meta.index<1||meta.index>meta.count||!Number.isInteger(meta.totalBytes)||meta.totalBytes<1||meta.totalBytes>MAX_BYTES+10*1000*1000||!Number.isInteger(meta.offset)||meta.offset<0||meta.bytes!==values['payload.bin'].size||typeof meta.name!=='string'||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('분할 정보가 올바르지 않습니다.');
 return {meta,data:values['payload.bin']};
}
export async function restore(files,progress=()=>{}) {
 if(files.length<2||files.length>MAX_PARTS)throw Error('이 앱에서 만든 모든 분할 ZIP을 함께 선택해 주세요.');
 if(files.reduce((n,f)=>n+f.size,0)>MAX_BYTES+12*1000*1000)throw Error('복원할 파일의 합계가 너무 큽니다.');
 const parts=[];for(let i=0;i<files.length;i++){parts.push(await readPart(files[i]));progress({value:Math.round((i+1)/files.length*20),text:'분할 정보 확인 중'});}
 parts.sort((a,b)=>a.meta.index-b.meta.index);const first=parts[0].meta;
 if(parts.length!==first.count)throw Error(`총 ${first.count}개가 필요합니다. 현재 ${parts.length}개를 선택했습니다.`);
 let offset=0;for(let i=0;i<parts.length;i++) {const {meta,data}=parts[i];
  if(meta.setId!==first.setId||meta.count!==first.count||meta.name!==first.name||meta.totalBytes!==first.totalBytes)throw Error('서로 다른 분할 묶음이 섞여 있습니다.');
  if(meta.index!==i+1)throw Error('중복되거나 빠진 조각이 있습니다.');if(meta.offset!==offset)throw Error('조각의 순서 정보가 올바르지 않습니다.');
  if(await digest(await data.arrayBuffer())!==meta.sha256)throw Error(`${meta.index}번 조각이 손상되었습니다. 다시 선택해 주세요.`);
  offset+=data.size;progress({value:20+Math.round((i+1)/parts.length*80),text:`원본 확인 중 · ${i+1}/${parts.length}개`});
 }
 if(offset!==first.totalBytes)throw Error('복원 크기가 일치하지 않습니다.');
 return [{name:cleanName(first.name)+'.zip',blob:new Blob(parts.map(x=>x.data),{type:'application/zip'}),ordinary:true}];
}
