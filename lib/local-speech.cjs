const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const directory = path.join(__dirname, '../.local-data/speech');
const python = path.join(directory, 'runtime', process.platform==='win32'?'Scripts/python.exe':'bin/python');
const script = path.join(__dirname,'../scripts/transcribe-local.py');
const byteLimit = 44 + 30 * 16000 * 2;
let busy = false;

function available() {
  return [python,path.join(directory,'model.int8.onnx'),path.join(directory,'tokens.txt')].every(p=>fs.existsSync(p));
}

function validWave(wave) {
  return wave.length>44 && wave.toString('ascii',0,4)==='RIFF' && wave.toString('ascii',8,16)==='WAVEfmt ' &&
    wave.readUInt32LE(16)===16 && wave.readUInt16LE(20)===1 && wave.readUInt16LE(22)===1 &&
    wave.readUInt32LE(24)===16000 && wave.readUInt16LE(34)===16 && wave.toString('ascii',36,40)==='data' &&
    wave.readUInt32LE(40)===wave.length-44 && wave.length%2===0;
}

function recognize(wave,names) {
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I','-X','utf8',script],{windowsHide:true,timeout:45000});
    const output=[];
    child.stdout.on('data',chunk=>output.push(chunk));
    child.stderr.resume();
    child.on('error',reject);
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(code!==0)return reject(Error('本机听写引擎未完成识别'));
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); } catch(e){ reject(e); }
    });
    child.stdin.write(JSON.stringify(names)+'\n');
    child.stdin.end(wave);
  });
}

async function handler(req,res) {
  function reply(status,body) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(body));
  }
  if(req.method!=='POST')return reply(405,{error:'仅支持提交短录音'});
  if(req.headers['content-type']!=='audio/wav')return reply(415,{error:'需要 PCM WAV 音频'});
  if(!available())return reply(503,{error:'本机中文语音模型尚未安装'});
  if(busy)return reply(429,{error:'正在识别另一条录音，请稍后重试'});
  let names;
  try{
    names=JSON.parse(decodeURIComponent(req.headers['x-speech-projects']||'[]'));
    if(!Array.isArray(names)||names.length>24||names.some(n=>typeof n!=='string'||n.length>48))throw Error();
  }catch{return reply(400,{error:'项目名称列表格式有误'})}
  busy=true;
  try {
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>byteLimit)return reply(413,{error:'每次最多录制 30 秒'});chunks.push(chunk)}
    const wave=Buffer.concat(chunks);
    if(!validWave(wave))return reply(400,{error:'录音格式无效'});
    const result=await recognize(wave,names);
    if(!result.text)return reply(422,{error:result.reason==='quiet'?'录音太轻或没有收到声音，请检查所选麦克风，再靠近一些说话。':'没有识别到清晰的人声，请再试一次。'});
    return reply(200,{text:result.text,suggestion:result.suggestion||null,engine:'SenseVoice'});
  }catch{return reply(503,{error:'本机语音模型暂时无法完成识别，请重试'})}
  finally{busy=false}
}
module.exports={handler,available};
