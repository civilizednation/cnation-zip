import {cleanName,MAX_BYTES} from './zip-core.mjs';
const $=id=>document.getElementById(id);const icon=name=>`<svg aria-hidden="true"><use href="#${name}"/></svg>`;
let action='split',mode='size',files=[],results=[],worker=null,busy=false,urls=[],lastSize=10,lastCount=2,wake=null,sharing=false;
const fmt=n=>n<1000?`${n} B`:n<1000000?`${(n/1000).toFixed(1)} KB`:`${(n/1000000).toFixed(2)} MB`;
function message(s){$('message').textContent=s;$('message').hidden=!s;}
function renderFiles(){
 $('fileCount').textContent=files.length;$('totalSize').textContent=fmt(files.reduce((n,f)=>n+f.size,0));$('fileList').replaceChildren();
 files.forEach((f,i)=>{const li=document.createElement('li');li.className='file-row';li.innerHTML=icon('file')+'<div class="file-detail"><b></b><small></small></div><button class="remove" aria-label="파일 제외">×</button>';li.querySelector('b').textContent=f.webkitRelativePath||f.name;li.querySelector('small').textContent=fmt(f.size);li.querySelector('button').setAttribute('aria-label',f.name+' 제외');li.querySelector('button').disabled=busy;li.querySelector('button').onclick=()=>{files.splice(i,1);renderFiles();};$('fileList').append(li);});
 $('clear').disabled=busy||!files.length;$('run').disabled=busy||!files.length;
}
function addFiles(incoming){if(busy)return;message('');for(const f of incoming)files.push(f);renderFiles();if(files.reduce((n,f)=>n+f.size,0)>MAX_BYTES)message('선택한 파일이 512 MB를 넘습니다. 일부 파일을 제외한 뒤 작업해 주세요.');}
$('pickFiles').onclick=()=>$('fileInput').click();$('pickFolder').onclick=()=>$('folderInput').click();
for(const id of ['fileInput','folderInput'])$(id).onchange=e=>{addFiles([...e.target.files]);e.target.value='';};
$('clear').onclick=()=>{files=[];renderFiles();message('');};
function clearResults(){urls.forEach(URL.revokeObjectURL);urls=[];results=[];$('resultList').replaceChildren();$('resultsPanel').hidden=true;}
function setAction(next){if(busy||sharing)return;action=next;files=[];clearResults();message('');renderFiles();const isSplit=action==='split';
 $('splitTab').classList.toggle('active',isSplit);$('restoreTab').classList.toggle('active',!isSplit);$('splitTab').setAttribute('aria-pressed',isSplit);$('restoreTab').setAttribute('aria-pressed',!isSplit);
 $('splitSettings').hidden=!isSplit;$('restoreSettings').hidden=isSplit;$('pickFolder').hidden=!isSplit;$('folderHint').hidden=!isSplit;
 $('filesTitle').textContent=isSplit?'파일 선택':'분할 ZIP 선택';$('settingsTitle').textContent=isSplit?'나누는 방법':'원본 ZIP 복원';$('pickTitle').textContent=isSplit?'어떤 파일을 나눌까요?':'나눈 ZIP을 모두 골라 주세요';$('pickHelp').textContent=isSplit?'문서, 사진, 동영상, ZIP까지 파일 종류에 관계없이 선택하세요.':'같은 묶음의 .z01, .z02 … 마지막 .zip을 함께 선택하세요.';$('runLabel').textContent=isSplit?'ZIP으로 나누기':'원본 ZIP으로 합치기';
}
$('splitTab').onclick=()=>setAction('split');$('restoreTab').onclick=()=>setAction('restore');
function setMode(next){if(mode==='size')lastSize=Number($('splitValue').value)||10;else lastCount=Number($('splitValue').value)||2;mode=next;const size=mode==='size';$('sizeMode').classList.toggle('active',size);$('countMode').classList.toggle('active',!size);$('sizeMode').setAttribute('aria-pressed',size);$('countMode').setAttribute('aria-pressed',!size);$('valueLabel').textContent=size?'ZIP 한 개의 최대 용량':'만들 ZIP 개수';$('unit').textContent=size?'MB':'개';$('splitValue').value=size?lastSize:lastCount;$('splitValue').min=size?'0.07':'1';$('splitValue').max=size?'512':'200';$('splitValue').step=size?'0.01':'1';$('splitValue').inputMode=size?'decimal':'numeric';$('presets').hidden=!size;$('modeHint').textContent=size?'1 MB = 1,000,000바이트. ZIP 정보까지 포함한 최대 크기입니다.':'입력한 개수만큼 나눕니다. 압축 후 크기가 작으면 개수가 제한됩니다.';updatePreset();}
$('sizeMode').onclick=()=>setMode('size');$('countMode').onclick=()=>setMode('count');
function updatePreset(){document.querySelectorAll('[data-value]').forEach(b=>b.classList.toggle('active',Number(b.dataset.value)===Number($('splitValue').value)));}
document.querySelectorAll('[data-value]').forEach(b=>b.onclick=()=>{$('splitValue').value=b.dataset.value;updatePreset();});$('splitValue').oninput=updatePreset;
$('archiveName').oninput=()=>{const n=cleanName($('archiveName').value);$('nameExample').textContent=`${n}.z01, ${n}.z02 … 마지막은 ${n}.zip`;$('previewName').textContent=n+'.z01';$('previewName2').textContent=n+'.zip';};
function setBusy(value){busy=value;document.querySelectorAll('.workspace button,.workspace input,.tabs button').forEach(e=>e.disabled=value);$('progressPanel').hidden=!value;renderFiles();}
async function releaseWake(){if(wake){try{await wake.release();}catch{}wake=null;}}
function end(){worker?.terminate();worker=null;setBusy(false);releaseWake();}
$('cancel').onclick=()=>{end();message('작업을 취소했습니다. 선택한 원본 파일은 그대로입니다.');};
$('run').onclick=()=>{
 message('');if(busy||!files.length)return;
 const value=Number($('splitValue').value);if(action==='split'&&(!Number.isFinite(value)||value<(mode==='size'?.07:1)||value>(mode==='size'?512:200)||(mode==='count'&&!Number.isInteger(value)))){message(mode==='size'?'용량은 0.07~512 MB 사이로 입력해 주세요.':'개수는 1~200 사이의 정수로 입력해 주세요.');return;}
 clearResults();setBusy(true);$('progress').value=0;$('progressText').textContent=action==='split'?'압축 준비 중…':'조각 확인 중…';
 try{worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(data.type==='progress'){$('progress').value=data.value;$('progressText').textContent=data.text;}else if(data.type==='error'){end();message(data.message);}else if(data.type==='done'){results=data.results;end();renderResults(data.compression);}};worker.onerror=()=>{end();message('작업을 완료하지 못했습니다. Safari를 업데이트하거나 더 적은 파일로 다시 시도해 주세요.');};worker.postMessage({action,mode,value,name:$('archiveName').value,files,paths:files.map(f=>f.webkitRelativePath||f.name)});if(navigator.wakeLock)navigator.wakeLock.request('screen').then(w=>{if(busy)wake=w;else w.release();}).catch(()=>{});}catch{end();message('이 브라우저에서 작업을 시작하지 못했습니다. 최신 Safari에서 열어 주세요.');}
};
function shareSupported(fs){try{return navigator.canShare?.({files:fs})&&!!navigator.share;}catch{return false;}}
async function share(fs){if(sharing)return;sharing=true;try{await navigator.share({files:fs});message('공유 메뉴를 닫았습니다. 선택한 위치에 파일이 저장되었는지 확인해 주세요.');}catch(e){if(e.name!=='AbortError')message('공유 메뉴를 열지 못했습니다. 아래 ‘다운로드’를 눌러 저장해 주세요.');}finally{sharing=false;}}
function renderResults(compression){$('resultsPanel').hidden=false;$('resultCount').textContent=results.length+'개 · '+fmt(results.reduce((n,r)=>n+r.blob.size,0));$('resultNote').textContent=results.length>1?'표준 분할 ZIP입니다. 모든 조각을 같은 폴더에 저장한 뒤, 분할 ZIP 지원 압축 앱에서 마지막 .zip을 여세요. 이 앱의 ‘다시 합치기’도 사용할 수 있습니다.':'일반 ZIP 파일입니다. 아이폰 파일 앱에서 바로 열 수 있어요.';
 if(compression===false)$('resultNote').textContent+=' 이 브라우저에서는 용량 압축 없이 ZIP으로 묶었습니다.';
 $('resultList').replaceChildren();const shareFiles=results.map(r=>new File([r.blob],r.name,{type:r.blob.type||'application/octet-stream'}));const canShareAll=shareSupported(shareFiles);$('saveAll').hidden=!canShareAll;$('saveAll').onclick=()=>share(shareFiles);
 results.forEach((r,i)=>{const url=URL.createObjectURL(r.blob);urls.push(url);const li=document.createElement('li');li.className='result-row';li.innerHTML='<span class="tiny-zip">ZIP</span><div class="file-detail"><b></b><small></small></div><div class="result-actions"><button type="button">파일에 저장</button><a class="download-link">다운로드</a></div>';li.querySelector('b').textContent=r.name;li.querySelector('small').textContent=fmt(r.blob.size);const btn=li.querySelector('button');btn.hidden=!shareSupported([shareFiles[i]]);btn.onclick=()=>share([shareFiles[i]]);const a=li.querySelector('a');a.href=url;a.download=r.name;$('resultList').append(li);});
 $('resultsPanel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
const zone=$('dropZone');for(const type of ['dragenter','dragover'])zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add('dragging');});for(const type of ['dragleave','drop'])zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove('dragging');});zone.addEventListener('drop',e=>{if([...e.dataTransfer.items].some(x=>x.webkitGetAsEntry?.()?.isDirectory)){message('폴더는 ‘폴더 선택’ 버튼으로 가져와 주세요.');return;}addFiles([...e.dataTransfer.files]);});
window.addEventListener('beforeunload',e=>{if(busy||results.length){e.preventDefault();e.returnValue='';}});
