// ST-iPhonie 的 LoRA 桥：只做一件事——把浏览器对 ComfyUI 的只读查询转发过去。
//
// 什么时候需要它：浏览器打不开 ComfyUI 的时候。ComfyUI 不加 --enable-cors-header 就不允许网页跨域读它；
// 手机/别的电脑上开酒馆时，ComfyUI 的地址也往往只有酒馆那台机器连得上。这两种情况下，由酒馆代读。
//
// 装法：把这个文件夹整个拷到酒馆的 plugins/ 下（建议就叫 st-iphonie-lora），确认 config.yaml 里
//       enableServerPlugins: true，重启酒馆。酒馆升级不会动 plugins/，不用重装。详见 安装说明.md。
//
// 安全边界：只转发白名单里的只读路径（Lora Manager 的 /api/lm/* 和 ComfyUI 的 /object_info/LoraLoader），
// 只用 GET，不透传任何请求头，也不回传 set-cookie。它不是通用代理。

const PLUGIN_ID = 'st-iphonie-lora';
const VERSION = '1.0.0';
/** 只读查询：Lora Manager 的接口，加上 ComfyUI 自己那一个 LoRA 列表（整包 object_info 有 5 MB，不转发）。 */
const ALLOWED_PREFIXES = ['/api/lm/', '/object_info/LoraLoader'];
/** 缩略图：只认 Lora Manager 的预览图接口。 */
const FILE_PREFIXES = ['/api/lm/previews', '/api/lm/example-image'];
const TIMEOUT = 15000;
const MAX_FILE = 24 * 1024 * 1024;

export const info = {
  id: PLUGIN_ID,
  name: 'ST-iPhonie LoRA bridge',
  chineseName: 'ST-iPhonie · LoRA 桥',
  version: VERSION,
  description: 'Read-only forwarder for the ComfyUI LoRA list and ComfyUI-Lora-Manager metadata.',
};

/** ComfyUI 的地址：只接受 http/https，不接受带用户名密码的，末尾斜杠去掉。 */
function comfyOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw Error('没有填 ComfyUI 地址');
  // 不写协议时补 http://（和插件里填地址的习惯一致）；写了别的协议就直接拒绝，不要改写成 http 再去连一个叫
  // "file" 的主机——那样报出来的错会把人带偏。
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) throw Error('ComfyUI 地址只能是 http 或 https');
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw); } catch { throw Error('ComfyUI 地址格式不对'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Error('ComfyUI 地址只能是 http 或 https');
  if (url.username || url.password) throw Error('ComfyUI 地址不要带用户名密码');
  if (!url.hostname) throw Error('ComfyUI 地址里没有主机名');
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

/** 要转发的路径：必须在白名单前缀下，不能有 .. 或换行（防止绕出白名单）。 */
function safePath(value, prefixes) {
  const path = String(value ?? '').trim();
  if (!path.startsWith('/')) throw Error('路径要以 / 开头');
  if (path.includes('..') || /[\r\n]/.test(path)) throw Error('路径不合法');
  if (!prefixes.some(p => path.startsWith(p))) throw Error('这个路径不在白名单里：' + path.split('?')[0]);
  return path;
}

async function fetchUpstream(target) {
  try {
    return await fetch(target, {headers: {Accept: '*/*'}, signal: AbortSignal.timeout(TIMEOUT), redirect: 'error'});
  } catch (error) {
    throw Object.assign(Error(error?.name === 'TimeoutError' ? '读 ComfyUI 超时' : '连不上 ComfyUI'), {upstream: true});
  }
}

export async function init(router) {
  // 自检用：插件装没装、什么版本。
  router.get('/ping', (_request, response) => response.json({ok: true, plugin: PLUGIN_ID, version: VERSION}));

  // 浏览器 → 酒馆 → ComfyUI 的只读查询。上游的状态码和 JSON 原样带回去，让浏览器那边能照常降级。
  router.post('/lm', async (request, response) => {
    let target;
    try {
      target = comfyOrigin(request.body?.url) + safePath(request.body?.path, ALLOWED_PREFIXES);
    } catch (error) {
      return response.status(400).json({error: error.message});
    }
    try {
      const upstream = await fetchUpstream(target);
      const text = await upstream.text();
      response.status(upstream.status).type('application/json');
      try { return response.send(JSON.parse(text)); }
      catch { return response.status(upstream.ok ? 502 : upstream.status).json({error: 'ComfyUI 返回的不是 JSON'}); }
    } catch (error) {
      console.error(`[${PLUGIN_ID}] ${target}: ${error.message}`);
      return response.status(error.upstream ? 502 : 500).json({error: error.message});
    }
  });

  // 缩略图。GET 不需要 CSRF，所以可以直接当 <img src> 用。
  router.get('/file', async (request, response) => {
    let target;
    try {
      target = comfyOrigin(request.query?.url) + safePath(request.query?.path, FILE_PREFIXES);
    } catch (error) {
      return response.status(400).send(error.message);
    }
    try {
      const upstream = await fetchUpstream(target);
      if (!upstream.ok) return response.sendStatus(upstream.status === 404 ? 404 : 502);
      const type = String(upstream.headers.get('content-type') || '');
      if (!/^image\//i.test(type)) return response.status(502).send('这个地址不是图片');
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length > MAX_FILE) return response.status(502).send('图片太大');
      response.type(type).set('Cache-Control', 'private, max-age=300');
      return response.send(body);
    } catch (error) {
      console.error(`[${PLUGIN_ID}] ${target}: ${error.message}`);
      return response.sendStatus(error.upstream ? 502 : 500);
    }
  });
}

export function exit() {}
