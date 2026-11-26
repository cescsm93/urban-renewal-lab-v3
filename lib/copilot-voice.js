function initCopilotVoice() {
  if(!window.renewalLocalTools?.voice)return;
  const btn=document.getElementById('voiceInput'), question=document.getElementById('copilotQuestion');
  const note=document.getElementById('voiceStatus'), file=document.getElementById('voiceFile');
  let recorder,timer,recordMode=0;
  const correction=document.createElement('button');
  correction.type='button';correction.className='secondary';correction.hidden=true;
  note.after(correction);
  question.addEventListener('input',()=>{correction.hidden=true});
  btn.hidden=false;
  function message(text){note.textContent=text}
  async function transcribe(blob,ticket=++recordMode){
    correction.hidden=true;
    btn.disabled=true;
    let ctx;
    try {
      if(blob.size>12*1024*1024)throw Error('请选择 30 秒以内的短录音');
      message('正在本机识别中文…');
      ctx=new AudioContext();
      const audio=await ctx.decodeAudioData(await blob.arrayBuffer());
      if(audio.duration>30.5)throw Error('录音超过 30 秒，请截短后重试');
      const count=Math.min(480000,Math.ceil(audio.duration*16000));
      const render=new OfflineAudioContext(1,count,16000), src=render.createBufferSource();
      src.buffer=audio;src.connect(render.destination);src.start();
      const pcm=(await render.startRendering()).getChannelData(0), buffer=new ArrayBuffer(44+2*count), view=new DataView(buffer);
      for(const [at,text] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));
      for(const [at,n] of [[4,buffer.byteLength-8],[16,16],[24,16000],[28,32000],[40,count*2]])view.setUint32(at,n,true);
      for(const [at,n] of [[20,1],[22,1],[32,2],[34,16]])view.setUint16(at,n,true);
      pcm.forEach((n,i)=>view.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,n))*32767),true));
      const picker=document.querySelector('.four-copilot-project select');
      const names=picker?[...new Set([picker.selectedOptions[0],...picker.options]
        .filter(opt=>opt?.value).map(opt=>opt.text.trim().slice(0,48)))].slice(0,24):[];
      const response=await fetch('/api/local-speech',{method:'POST',
        headers:{'Content-Type':'audio/wav','X-Speech-Projects':encodeURIComponent(JSON.stringify(names))},body:buffer});
      const result=await response.json();
      if(ticket!==recordMode)return;
      if(!response.ok)throw Error(result.error);
      const start=question.selectionStart;
      question.setRangeText(result.text,question.selectionStart,question.selectionEnd,'end');question.focus();message('已填入问题，可修改后查询。');
      if(result.suggestion){
        const before=question.value;
        correction.textContent='使用项目名“'+result.suggestion.name+'”';
        correction.hidden=false;
        correction.onclick=()=>{
          if(question.value===before)question.setRangeText(result.suggestion.text,start,start+result.text.length,'end');
          correction.hidden=true;question.focus();
        };
      }
    }catch(e){if(ticket===recordMode)message(e.message)}finally{if(ctx)await ctx.close();btn.disabled=false;btn.textContent='语音输入'}
  }
  file.onchange=()=>{const audio=file.files[0];file.value='';if(audio)transcribe(audio)};
  btn.onclick=async()=>{
    if(recorder?.state==='recording'){recorder.stop();return}
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){
      message('当前浏览器可导入短录音。本机直接使用麦克风请打开 127.0.0.1:4173。');file.click();return;
    }
    btn.disabled=true;
    const ticket=++recordMode;
    let stream;
    try {
      correction.hidden=true;
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(ticket!==recordMode){stream.getTracks().forEach(t=>t.stop());return}
      recorder=new MediaRecorder(stream);const chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      recorder.onstop=()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());btn.textContent='语音输入';
        if(ticket===recordMode)transcribe(new Blob(chunks,{type:recorder.mimeType}),ticket);};
      recorder.start();timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},29500);
      btn.textContent='结束录音';message('正在录音 · '+(stream.getAudioTracks()[0]?.label||'麦克风')+' · 最长 30 秒');
    }catch(e){stream?.getTracks().forEach(t=>t.stop());message('麦克风未能打开，请检查浏览器权限或导入录音。')}
    finally{btn.disabled=false}
  };
  const cancel=()=>{recordMode++;correction.hidden=true;if(recorder?.state==='recording')recorder.stop();message('')};
  document.getElementById('closeCopilot').addEventListener('click',cancel);
  window.addEventListener('pagehide',cancel);
  document.addEventListener('click',e=>{if(e.target.closest('.four-copilot-tabs'))cancel()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel()});
}
