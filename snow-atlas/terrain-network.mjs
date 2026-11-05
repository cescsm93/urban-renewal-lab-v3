export function terrainError(error){
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return '地形加载已超时，请点击重试。';
 if(error instanceof TypeError||/failed to fetch|fetch failed|networkerror|load failed/i.test(error?.message||''))return '网络未能连接地形服务，请检查网络后重试。';
 return error?.message||'地形数据暂时不可用，请重试。';
}
export async function terrainRequest(url,{signal,fetcher=fetch,retry=true}={}){
 for(let attempt=0;attempt<(retry?2:1);attempt++){
  signal?.throwIfAborted();
  try{const r=await fetcher(url,{signal});if(r.ok)return r;let error;try{error=(await r.json()).error}catch{}const e=new Error(error||'地形数据源暂时不可用，请稍后重试。');e.status=r.status;if(retry&&attempt===0&&[502,503,504].includes(r.status))continue;throw e}
  catch(e){if(signal?.aborted||e.name==='AbortError'||e.name==='TimeoutError')throw e;if(retry&&attempt===0&&e instanceof TypeError)continue;throw e}
 }
}
