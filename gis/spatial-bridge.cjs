const {spawn}=require('node:child_process'),path=require('node:path');
let active=0;
async function handler(req,res){
 const send=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
 if(req.method!=='POST')return send(405,{error:'仅支持 POST'});
 if(active>=1)return send(429,{error:'已有空间分析进行中，请稍后重试'});
 let body='';try{
  for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4*1024*1024)return send(413,{error:'数据超过 4 MB，请先裁剪范围'})}
  JSON.parse(body);active++;
  try{const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.env.GIS_PYTHON||'python',[path.join(__dirname,'spatial_analysis.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PROJ_NETWORK:'OFF'}});
   let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('分析超过 80 秒，请缩小数据范围'))},80000);
   child.stdout.on('data',c=>{out+=c;if(out.length>5*1024*1024){child.kill();reject(Error('结果过大，请缩小数据范围'))}});
   child.stderr.on('data',c=>err+=c.toString().slice(0,1000));child.on('error',()=>{clearTimeout(timer);reject(Error('未找到 Python GIS 环境'))});
   child.stdin.on('error',()=>{});child.on('close',code=>{clearTimeout(timer);try{const data=JSON.parse(out);if(code||data.error)reject(Error(data.error||err||'分析失败'));else resolve(data)}catch(e){reject(e)}});
   child.stdin.end(body);
  });send(200,result)}finally{active--}
 }catch(e){send(400,{error:e.message})}
}
module.exports={handler};
