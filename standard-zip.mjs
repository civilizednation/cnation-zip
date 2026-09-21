import {cleanName,MAX_BYTES,MAX_PARTS,restore as restoreLegacy} from './zip-core.mjs';
const MIN_VOLUME=65536;
const SIG=new Uint8Array([0x50,0x4b,0x07,0x08]);
const fail=()=>{throw Error('ZIP 구조가 올바르지 않거나 지원하지 않는 형식입니다.');};
async function bytes(blob,start,length){if(start<0||start+length>blob.size)fail();return new Uint8Array(await blob.slice(start,start+length).arrayBuffer());}
const view=a=>new DataView(a.buffer,a.byteOffset,a.byteLength);
async function directory(blob,start,size,count){
 if(count>10000||size>12*1000000)fail();const records=[];let at=start;
 for(let i=0;i<count;i++){const h=await bytes(blob,at,46),v=view(h);if(v.getUint32(0,true)!==0x02014b50)fail();
 const length=46+v.getUint16(28,true)+v.getUint16(30,true)+v.getUint16(32,true);const data=await bytes(blob,at,length);records.push({at,data});at+=length;}
 if(at!==start+size)fail();return records;
}
function diskAt(starts,position){let lo=0,hi=starts.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(starts[m]<=position)lo=m;else hi=m-1;}return lo;}
export async function splitArchive(blob,name,mode,value,progress=()=>{}){
 name=cleanName(name);if(!Number.isFinite(value)||value<=0||!['size','count'].includes(mode))throw Error('올바른 용량 또는 개수를 입력해 주세요.');
 if(mode==='size'&&(value<0.07||value>512))throw Error('표준 ZIP의 분할 용량은 0.07~512 MB로 입력해 주세요.');
 if(mode==='count'&&(!Number.isInteger(value)||value>MAX_PARTS))throw Error('분할 개수는 1~200개여야 합니다.');
 if(blob.size>MAX_BYTES+10000000)throw Error('ZIP 크기가 처리 한도를 넘습니다.');
 const cap=Math.floor(value*1000000);
 if((mode==='size'&&blob.size<=cap)||(mode==='count'&&value===1))return [{name:name+'.zip',blob,ordinary:true}];
 const end=await bytes(blob,blob.size-22,22),ev=view(end);if(ev.getUint32(0,true)!==0x06054b50||ev.getUint16(4,true)||ev.getUint16(20,true))fail();
 const cdOffset=ev.getUint32(16,true),cdSize=ev.getUint32(12,true),count=ev.getUint16(10,true);
 if(cdOffset+cdSize!==blob.size-22)fail();const records=await directory(blob,cdOffset,cdSize,count);
 const protectedRanges=[[0,4]];
 for(const {data} of records){const v=view(data),offset=v.getUint32(42,true),local=await bytes(blob,offset,30),lv=view(local);if(lv.getUint32(0,true)!==0x04034b50)fail();protectedRanges.push([offset+4,offset+4+30+lv.getUint16(26,true)+lv.getUint16(28,true)]);}
 for(const r of records)protectedRanges.push([r.at+4,r.at+4+r.data.length]);protectedRanges.push([blob.size-22+4,blob.size+4]);protectedRanges.sort((a,b)=>a[0]-b[0]);
 const total=blob.size+4,starts=[0];
 const crossing=p=>protectedRanges.find(([a,b])=>a<p&&p<b);
 // Info-ZIP zip 3.0 rejoins a volume whose size is an exact multiple of 64 KB incorrectly, so step off that boundary.
 const aligned=(cut,previous)=>(cut-previous)%MIN_VOLUME===0;
 if(mode==='count'){
  if(total<MIN_VOLUME*(value-1)+22)throw Error('압축 후 파일이 작아 이 개수로 나눌 수 없습니다. 분할 개수를 줄여 주세요. (조각 기준 최소 64 KB)');
  for(let i=1;i<value;i++){const previous=starts.at(-1);let cut=Math.max(previous+MIN_VOLUME,previous+Math.floor((total-previous)/(value-i+1)));const range=crossing(cut);
   if(range)cut=range[0]>=previous+MIN_VOLUME?range[0]:range[1];
   if(aligned(cut,previous)&&cut+1<total-22&&!crossing(cut+1))cut++;
   if(cut>=total||total-cut<MIN_VOLUME*(value-i-1)+22||cut>=total-22)throw Error('파일 정보 경계를 유지하며 이 개수로 나눌 수 없습니다. 개수를 줄여 주세요.');starts.push(cut);}
 }else{
  let start=0;while(total-start>cap){let cut=start+cap;const range=crossing(cut);if(range)cut=range[0];if(aligned(cut,start)&&cut-1>=start+MIN_VOLUME&&!crossing(cut-1))cut--;if(cut-start<MIN_VOLUME)throw Error('파일 정보 경계를 유지하려면 분할 용량을 조금 늘려 주세요.');starts.push(cut);start=cut;if(starts.length>MAX_PARTS)throw Error('200개를 넘습니다. 분할 용량을 늘려 주세요.');}
 }
 const patched=[];for(const {data} of records){const v=view(data),absolute=v.getUint32(42,true)+4,disk=diskAt(starts,absolute);v.setUint16(34,disk,true);v.setUint32(42,absolute-starts[disk],true);patched.push(data);}
 const lastDisk=starts.length-1,cdDisk=diskAt(starts,cdOffset+4);ev.setUint16(4,lastDisk,true);ev.setUint16(6,cdDisk,true);ev.setUint16(8,records.filter(r=>diskAt(starts,r.at+4)===lastDisk).length,true);ev.setUint32(16,cdOffset+4-starts[cdDisk],true);
 const full=new Blob([SIG,blob.slice(0,cdOffset),...patched,end]);const result=[];
 for(let i=0;i<starts.length;i++){const last=i===lastDisk;result.push({name:name+(last?'.zip':'.z'+String(i+1).padStart(2,'0')),blob:full.slice(starts[i],starts[i+1]??full.size,last?'application/zip':'application/octet-stream'),ordinary:false});progress({value:70+Math.round((i+1)/starts.length*30),text:`표준 ZIP 나누는 중 · ${i+1}/${starts.length}개`});}
 return result;
}
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
async function verifyEntry(blob,r,starts,totalLimit){const v=view(r.data),disk=v.getUint16(34,true),relative=v.getUint32(42,true),method=v.getUint16(10,true),flags=v.getUint16(8,true),compressed=v.getUint32(20,true),size=v.getUint32(24,true),signature=v.getUint32(16,true);
 if(disk>=starts.length||(flags&1)||![0,8].includes(method)||size>MAX_BYTES)throw Error('암호화·ZIP64·특수 압축 방식은 이 앱에서 합칠 수 없습니다. 분할 ZIP 지원 압축 앱을 사용해 주세요.');
 const offset=starts[disk]+relative,local=await bytes(blob,offset,30),lv=view(local);if(lv.getUint32(0,true)!==0x04034b50||lv.getUint16(8,true)!==method)fail();const start=offset+30+lv.getUint16(26,true)+lv.getUint16(28,true);if(start+compressed>totalLimit)fail();
 let stream=blob.slice(start,start+compressed).stream();if(method===8){try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('이 ZIP을 확인하려면 최신 Safari 또는 분할 ZIP 지원 압축 앱을 사용해 주세요.');}}
 let crc=0xffffffff,read=0;const reader=stream.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;read+=value.length;if(read>size)throw Error('압축 내용의 크기가 일치하지 않습니다.');for(const b of value)crc=table[(crc^b)&255]^(crc>>>8);}}catch(e){await reader.cancel().catch(()=>{});throw Error('조각이 손상되었거나 서로 다른 묶음이 섞여 있습니다.');}finally{reader.releaseLock();}
 if(read!==size||((crc^0xffffffff)>>>0)!==signature)throw Error('조각이 손상되었거나 서로 다른 묶음이 섞여 있습니다.');return offset;
}
export async function restore(files,progress=()=>{}){
 // Keep the first release's custom ZIPs readable for users who saved them.
 if(files.length&&files.every(f=>/_\d+\.zip$/i.test(f.name)))return restoreLegacy(files,progress);
 if(files.length<2||files.length>MAX_PARTS)throw Error('.z01부터 마지막 .zip까지 모든 조각을 선택해 주세요.');
 if(files.reduce((n,f)=>n+f.size,0)>MAX_BYTES+10000000)throw Error('복원할 파일 크기가 처리 한도를 넘습니다.');
 const last=files.filter(f=>/\.zip$/i.test(f.name));if(last.length!==1)throw Error('마지막 .zip 파일을 하나 포함해 주세요.');const base=last[0].name.slice(0,-4);
 const ordered=files.map(f=>{if(f===last[0])return {file:f,n:files.length};const m=/^(.*)\.z(\d+)$/i.exec(f.name);if(!m||m[1]!==base)throw Error('같은 이름의 .z01, .z02, …, .zip만 선택해 주세요.');return {file:f,n:Number(m[2])};}).sort((a,b)=>a.n-b.n);
 if(ordered.some((x,i)=>x.n!==i+1))throw Error('빠지거나 중복된 조각이 있습니다.');const starts=[];let offset=0;for(const x of ordered){starts.push(offset);offset+=x.file.size;}
 const full=new Blob(ordered.map(x=>x.file));const end=await bytes(full,full.size-22,22),ev=view(end);if(ev.getUint32(0,true)!==0x06054b50||ev.getUint16(20,true)!==0)throw Error('주석이 없고 ZIP64를 사용하지 않은 분할 ZIP만 이 앱에서 합칠 수 있습니다.');
 if(ev.getUint16(4,true)!==files.length-1)throw Error('ZIP에 기록된 조각 개수와 선택한 파일 수가 다릅니다.');const cdDisk=ev.getUint16(6,true);if(cdDisk>=starts.length)fail();const cdStart=starts[cdDisk]+ev.getUint32(16,true),cdSize=ev.getUint32(12,true),count=ev.getUint16(10,true);if(cdStart+cdSize!==full.size-22)fail();
 const records=await directory(full,cdStart,cdSize,count);const first=await bytes(full,0,4);const prefix=view(first).getUint32(0,true)===0x08074b50?4:0;
 let uncompressed=0;for(const r of records){uncompressed+=view(r.data).getUint32(24,true);if(uncompressed>MAX_BYTES)throw Error('압축 해제 크기가 512 MB를 넘습니다.');}
 for(let i=0;i<records.length;i++){const localOffset=await verifyEntry(full,records[i],starts,cdStart);const v=view(records[i].data);if(localOffset<prefix)fail();v.setUint16(34,0,true);v.setUint32(42,localOffset-prefix,true);progress({value:Math.round((i+1)/records.length*100),text:`파일 무결성 확인 중 · ${i+1}/${records.length}개`});}
 ev.setUint16(4,0,true);ev.setUint16(6,0,true);ev.setUint16(8,count,true);ev.setUint32(16,cdStart-prefix,true);
 return [{name:cleanName(base)+'.zip',blob:new Blob([full.slice(prefix,cdStart),...records.map(r=>r.data),end],{type:'application/zip'}),ordinary:true}];
}
