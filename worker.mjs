import {archive} from './zip-core.mjs';
import {splitArchive,restore} from './standard-zip.mjs';
self.onmessage=async ({data})=>{try{
 const progress=p=>self.postMessage({type:'progress',...p});let results,compression;
 if(data.action==='restore') results=await restore(data.files,progress);
 else {const a=await archive(data.files,progress,data.paths);compression=a.canCompress;results=await splitArchive(a.blob,data.name,data.mode,data.value,progress);}
 self.postMessage({type:'done',results,compression});
}catch(error){self.postMessage({type:'error',message:error.message||'처리하지 못했습니다. 파일을 다시 선택해 주세요.'});}};
