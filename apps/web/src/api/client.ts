import { apiError } from '@renewal/contracts'

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) { super(message) }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, { method: 'GET', signal })
}

export async function uploadFile<T>(url:string,file:File):Promise<T> {
  const body=new FormData();body.append('file',file,file.name)
  let response:Response
  try {response=await fetch(url,{method:'POST',body,credentials:'same-origin',headers:{Accept:'application/json'}})}
  catch {throw new ApiRequestError(503,'本机 API 未运行，请启动 Fastify 服务。','NETWORK_UNAVAILABLE')}
  const data=await response.json().catch(()=>null)
  if(!response.ok) {
    const parsed=apiError.safeParse(data)
    throw new ApiRequestError(response.status,parsed.success?parsed.data.error.message:`上传失败（HTTP ${response.status}）。`,parsed.success?parsed.data.error.code:'UPLOAD_ERROR')
  }
  return data as T
}

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(url, { ...init, credentials: 'same-origin', headers: { Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }) }
  catch { throw new ApiRequestError(503, '本机 API 未运行，请启动 Fastify 服务。', 'NETWORK_UNAVAILABLE') }
  const type = response.headers.get('content-type') || ''
  if (!type.toLowerCase().includes('application/json'))
    throw new ApiRequestError(502, `接口返回了非 JSON 内容（HTTP ${response.status}）。`, 'INVALID_RESPONSE')
  let data: unknown
  try { data = await response.json() }
  catch { throw new ApiRequestError(502, '接口返回的 JSON 无法解析。', 'INVALID_RESPONSE') }
  if (!response.ok) {
    const parsed = apiError.safeParse(data)
    throw new ApiRequestError(response.status, parsed.success ? parsed.data.error.message : `请求失败（HTTP ${response.status}）。`,
      parsed.success ? parsed.data.error.code : 'HTTP_ERROR')
  }
  return data as T
}
