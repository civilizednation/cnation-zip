import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {archive} from '../zip-core.mjs';
import {splitArchive,restore} from '../standard-zip.mjs';
const dir=join(tmpdir(),'cnation-zip-standard-test');await mkdir(dir,{recursive:true});
const data=randomBytes(11000000);const original=await archive([new File([data],'original.zip'),new File(['한글 내용\n'.repeat(20000)],'문서.txt')],()=>{},['폴더/original.zip','폴더/문서.txt']);
await writeFile(dir+'/original.bin',data);
async function check(base,blob,mode,value){const outputs=await splitArchive(blob,base,mode,value);if(mode==='count')assert.equal(outputs.length,value);else assert.ok(outputs.every(r=>r.blob.size<=value*1000000));
 const files=outputs.map(r=>new File([r.blob],r.name));assert.equal(files.at(-1).name,base+'.zip');assert.equal(files[0].name,base+'.z01');
 const joined=await restore(files.toReversed());assert.deepEqual(await joined[0].blob.arrayBuffer(),await blob.arrayBuffer());
 for(const f of files)await writeFile(dir+'/'+f.name,new Uint8Array(await f.arrayBuffer()));return files;}
const files=await check('standard',original.blob,'size',10);
await check('count',original.blob,'count',3);
await assert.rejects(()=>restore([files[0]]),/모든/);
await assert.rejects(()=>restore([files[0],files[0],files[1]]),/빠지거나/);
const corrupt=new Uint8Array(await files[0].arrayBuffer());corrupt[1000]^=1;
await assert.rejects(()=>restore([new File([corrupt],files[0].name),files[1]]),/손상/);
const many=await archive(Array.from({length:1800},(_,i)=>new File([''],'긴한글파일이름'+i+'.txt')));
await check('headers',many.blob,'size',.07);
const small=(await archive([new File([randomBytes(300000)],'a.bin')])).blob;
for(const [tag,mode,value] of [['floored','count',5],['capped','size',0.131072]]){const volumes=await check(tag,small,mode,value);
 assert.ok(volumes.slice(0,-1).every(f=>f.size%65536!==0),tag+': Info-ZIP zip 3.0 rejoins volumes sized an exact multiple of 64 KB incorrectly');}
const tiny=await archive([new File(['abc'],'small.txt')]);await assert.rejects(()=>splitArchive(tiny.blob,'small','count',3),/작아/);
assert.equal((await splitArchive(tiny.blob,'single','count',1))[0].name,'single.zip');
console.log('PASS: standard naming, exact count, 10 MB cap, byte-exact restore, mixed STORE/DEFLATE, nested Korean paths, corruption/missing/duplicate rejection, central directory across volumes, small-file count limits, no 64 KB-aligned volumes.');
