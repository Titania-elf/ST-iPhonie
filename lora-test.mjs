// ST-iPhonie LoRA 管理器核心逻辑验证（node lora-test.mjs）
import { normalizeComfy, defaultComfy, fillWorkflow, comfyValues, injectLoras, applyLoras, loraTriggers, nodeLoras, loraPlan, writeStages, autoPlaceholders, DEFAULT_COMFY_WORKFLOW, checkWorkflow } from './core/image-engines.js';
import { loraKey, loraStem, loraFolder, spineNames, managerPath, mergeLoraRows, filterLoraRows, sortLoraRows, loraFacets, previewSrc } from './core/lora-manager.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('1) normalizeComfy：栈的清洗与去重');
{
  const raw = defaultComfy();
  raw.loras = [
    { id: 'abc', name: 'a.safetensors', on: false, model: 0.83, clip: 2, trigger: 'a1, a2' },
    { name: 'b.safetensors', trigger: 123 },
    { name: 'c.safetensors', model: 9, clip: -3 },
    { name: 'A.SAFETENSORS' },           // 与第一个重名（忽略大小写）→ 去掉
    { name: '' },                         // 空名 → 去掉
    'junk',                               // 非对象 → 变成空名 → 去掉
  ];
  const c = normalizeComfy(raw);
  eq('保留 3 个', c.loras.length, 3);
  ok('已有 id 保留', c.loras[0].id === 'abc');
  ok('新 id 生成', /^[0-9a-f-]{36}$/.test(c.loras[1].id));
  eq('开关保留', c.loras[0].on, false);
  eq('权重 0.83 → 0.85（0.05 步进）', c.loras[0].model, 0.85);
  eq('clip 2 保持 2（上限 3）', c.loras[0].clip, 2);
  eq('超上限收到 3', c.loras[2].model, 3);
  eq('负数收到 0', c.loras[2].clip, 0);
  ok('默认权重 1', c.loras[1].model === 1 && c.loras[1].clip === 1);
  eq('触发词转字符串', c.loras[1].trigger, '123');
  ok('loraPath 已经移除', !('loraPath' in normalizeComfy({ loraPath: 'D:/AI/ComfyUI' })));
  ok('空配置也是空数组', Array.isArray(normalizeComfy({}).loras) && normalizeComfy({}).loras.length === 0);
}

console.log('2) 默认工作流全链路：填占位符 → 注入 2 个 LoRA');
{
  const c = normalizeComfy({ model: 'sd_xl_base_1.0.safetensors', loras: [
    { name: 'add_detail.safetensors', model: 0.7, clip: 0.6 },
    { name: 'style_x.safetensors', model: 1.1, clip: 0 },
  ]});
  const filled = fillWorkflow(c.workflow, comfyValues(c, { prompt: '1girl', negative: 'bad', width: 832, height: 1216, seed: 42 }));
  const before = Object.keys(JSON.parse(filled)).length;
  const snapshot = JSON.stringify(c.loras);
  const injected = injectLoras(filled, c.loras);
  const g = JSON.parse(injected);
  ok('仍是有效 JSON', !!g);
  eq('新增 2 个节点', Object.keys(g).length, before + 2);
  eq('节点 10 = LoraLoader', [g[10].class_type, g[10].inputs.lora_name, g[10].inputs.strength_model, g[10].inputs.strength_clip], ['LoraLoader', 'add_detail.safetensors', 0.7, 0.6]);
  eq('节点 10 接在底模后', [g[10].inputs.model, g[10].inputs.clip], [['4', 0], ['4', 1]]);
  eq('节点 11 串在 10 后', [g[11].inputs.model, g[11].inputs.clip], [['10', 0], ['10', 1]]);
  eq('KSampler.model → 链尾', g['3'].inputs.model, ['11', 0]);
  eq('正向 CLIP → 链尾 clip', g['6'].inputs.clip, ['11', 1]);
  eq('负向 CLIP → 链尾 clip', g['7'].inputs.clip, ['11', 1]);
  eq('VAEDecode.vae 仍接底模', g['8'].inputs.vae, ['4', 2]);
  ok('loras 数组未被改动', JSON.stringify(c.loras) === snapshot);
  const dangling = Object.entries(g).flatMap(([id, n]) => Object.values(n.inputs || {}).filter(v => Array.isArray(v) && !(String(v[0]) in g)).map(() => id));
  eq('没有悬空引用', dangling, []);
}

console.log('3) GGUF / UNET 工作流：模型和 CLIP 都要吃到 LoRA');
{
  const wf = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 1, steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1}},
    4: {class_type: 'UnetLoaderGGUF', inputs: {unet_name: 'qwen_xl.safetensors'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: 832, height: 1216, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {clip: ['8', 0], text: '1girl'}},
    7: {class_type: 'CLIPTextEncode', inputs: {clip: ['8', 0], text: 'bad'}},
    8: {class_type: 'CLIPLoader', inputs: {clip_name: 't5.safetensors'}},
    9: {class_type: 'VAEDecode', inputs: {samples: ['3', 0], vae: ['10', 0]}},
    10: {class_type: 'VAELoader', inputs: {vae_name: 'x.safetensors'}},
    11: {class_type: 'SaveImage', inputs: {filename_prefix: 'x', images: ['9', 0]}},
  });
  const loras = [{name: 'l1.safetensors', model: 0.9, clip: 0.9}, {name: 'l2.safetensors', model: 1, clip: 1}];
  const g = JSON.parse(injectLoras(wf, loras));
  ok('用了带 CLIP 的 LoraLoader（不是 ModelOnly）', g[12].class_type === 'LoraLoader' && g[13].class_type === 'LoraLoader');
  eq('链：12←底模，13←12', [g[12].inputs.model, g[13].inputs.model], [['4', 0], ['12', 0]]);
  eq('链的 CLIP：12←CLIPLoader，13←12', [g[12].inputs.clip, g[13].inputs.clip], [['8', 0], ['12', 1]]);
  eq('KSampler.model → 13', g['3'].inputs.model, ['13', 0]);
  // 提示词节点改读链尾的 CLIP，这样 LoRA 才作用到文本编码；CLIPLoader 本身没被改
  eq('CLIPTextEncode → 链尾的 CLIP', [g['6'].inputs.clip, g['7'].inputs.clip], [['13', 1], ['13', 1]]);
  eq('CLIPLoader 没被改', g['8'].inputs.clip_name, 't5.safetensors');
  eq('采样器的提示词链接没被动', [g['3'].inputs.positive, g['3'].inputs.negative], [['6', 0], ['7', 0]]);
}

console.log('4) 特殊情况');
{
  // a. 工作流里已经有自己的 LoraLoader：插件栈叠在底模之后
  const wf = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {model: ['12', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 1, steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1}},
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'a.safetensors'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: 512, height: 512, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {clip: ['12', 1], text: 'p'}},
    7: {class_type: 'CLIPTextEncode', inputs: {clip: ['12', 1], text: 'n'}},
    12: {class_type: 'LoraLoader', inputs: {lora_name: 'baked.safetensors', strength_model: 0.8, strength_clip: 0.8, model: ['4', 0], clip: ['4', 1]}},
    9: {class_type: 'VAEDecode', inputs: {samples: ['3', 0], vae: ['4', 2]}},
    10: {class_type: 'SaveImage', inputs: {images: ['9', 0]}},
  });
  const g = JSON.parse(injectLoras(wf, [{name: 'stack.safetensors', model: 1, clip: 1}]));
  eq('插件 LoRA 直接插在底模后', [g[13].inputs.model, g[13].inputs.clip], [['4', 0], ['4', 1]]);
  eq('原有的 LoraLoader 保留', g[12].inputs.lora_name, 'baked.safetensors');
  eq('原有 LoraLoader 改接插件链尾', [g[12].inputs.model, g[12].inputs.clip], [['13', 0], ['13', 1]]);
  eq('KSampler 仍接原有 LoRA（形成 4→13→12 完整链）', g['3'].inputs.model, ['12', 0]);

  // b. 没有可挂的底模节点 → 报错
  let threw = '';
  try { injectLoras(JSON.stringify({9: {class_type: 'SaveImage', inputs: {images: ['3', 0]}}}), [{name: 'x.safetensors'}]); } catch (e) { threw = e.message; }
  ok('找不到底模节点时给出提示', threw.includes('底模节点'), threw);

  // c. 空栈 / 全关 → 原样返回
  const same = JSON.stringify({3: {class_type: 'KSampler', inputs: {model: ['4', 0]}}, 4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'a.safetensors'}}});
  eq('空栈原样返回', injectLoras(same, []), same);
  eq('全部关闭原样返回', injectLoras(same, [{name: 'x.safetensors', on: false}]), same);

  // d. ImageOnlyCheckpointLoader 的 CLIP 在输出口 2
  const wf2 = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: 1, steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1}},
    4: {class_type: 'ImageOnlyCheckpointLoader', inputs: {ckpt_name: 'x.safetensors'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: 512, height: 512, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {clip: ['4', 2], text: 'p'}},
    7: {class_type: 'CLIPTextEncode', inputs: {clip: ['4', 2], text: 'n'}},
  });
  const g2 = JSON.parse(injectLoras(wf2, [{name: 'x.safetensors'}]));
  eq('ImageOnly 用 LoraLoader', g2[8].class_type, 'LoraLoader');
  eq('链的 clip 输入接输出口 2', g2[8].inputs.clip, ['4', 2]);
  eq('ImageOnly 的 clip 也重接到链尾', [g2['6'].inputs.clip, g2['7'].inputs.clip], [['8', 1], ['8', 1]]);

  // e. 关闭的 LoRA 不注入、栈截断到 10 个
  const many = Array.from({length: 12}, (_, i) => ({name: `l${i}.safetensors`, on: i < 11}));
  const g3 = JSON.parse(injectLoras(same, many));
  const loraNodes = Object.values(g3).filter(n => String(n.class_type).startsWith('LoraLoader'));
  eq('最多注 10 个', loraNodes.length, 10);
  ok('后面的节点号接着排', !!g3[13] && !!g3[14]);
}

console.log('5) loraTriggers：触发词拼接与去重');
{
  const loras = [
    {on: true, trigger: 'ohwx woman,  skin detail'},
    {on: true, trigger: 'skin detail, style-xyz'},
    {on: false, trigger: 'offword'},
    {on: true, trigger: ''},
  ];
  eq('去重（已在提示词里的不重复拼）、去关闭、拼在最前', loraTriggers('1girl, ohwx woman', loras), 'skin detail, style-xyz, 1girl, ohwx woman');
  eq('无触发词原样返回', loraTriggers('1girl', [{on: true, trigger: ''}]), '1girl');
  eq('大小写去重', loraTriggers('1girl', [{on: true, trigger: '1GIRL, xxx'}]), 'xxx, 1girl');
  eq('空 prompt 也有输出', loraTriggers('', [{on: true, trigger: 't1'}]), 't1');
}

console.log('6) nodeLoras：读一个节点的 LoRA（内置节点和 Lora Manager 节点）');
{
  eq('LoraLoader 读一个', nodeLoras({class_type: 'LoraLoader', inputs: {lora_name: 'baked.safetensors', strength_model: 0.83, strength_clip: 0.4}}), [
    {name: 'baked.safetensors', model: 0.85, clip: 0.4},
  ]);
  eq('LoraLoaderModelOnly 的 clip 记 0', nodeLoras({class_type: 'LoraLoaderModelOnly', inputs: {lora_name: 'unet.safetensors', strength_model: 1.2}}), [
    {name: 'unet.safetensors', model: 1.2, clip: 0},
  ]);
  eq('占位符不算', nodeLoras({class_type: 'LoraLoader', inputs: {lora_name: '%lora%', strength_model: 1, strength_clip: 1}}), []);
  eq('不认识就空', nodeLoras({class_type: 'KSampler', inputs: {}}), []);
  eq('空壳不炸', nodeLoras(null), []);

  // Lora Manager 的节点把整摞放在 loras 这个 widget 里，真正的强度字段叫 strength / clipStrength
  const lm = {class_type: 'Lora Loader (LoraManager)', inputs: {text: '<lora:a:0.6>', loras: {__value__: [
    {name: 'Anima\detail/a', strength: 0.6, clipStrength: 0.5, active: true},
    {name: 'b', strength: 1, active: false},
    {name: '   ', strength: 1, active: true},
    'junk',
  ]}, model: ['2', 0], clip: ['3', 0]}};
  eq('Lora Manager 节点：读整摞、跳过关掉的、强度取 clipStrength', nodeLoras(lm), [
    {name: 'Anima\detail/a', model: 0.6, clip: 0.5},
  ]);
  eq('没有 clipStrength 时跟模型权重走', nodeLoras({class_type: 'Lora Loader (LoraManager)', inputs: {loras: {__value__: [{name: 'c', strength: 0.8, active: true}]}}}), [
    {name: 'c', model: 0.8, clip: 0.8},
  ]);
  eq('loras 是裸数组也认', nodeLoras({class_type: 'Lora Loader (LoraManager)', inputs: {loras: [{name: 'd', strength: 1, active: true}]}}), [
    {name: 'd', model: 1, clip: 1},
  ]);
}

console.log('7) 保存链路：normalizeComfy 的结果能原路再归一化（saveDraw 的合并分支）');
{
  const c = normalizeComfy({ loras: [{name: 'x.safetensors', model: 0.5, clip: 0.5}] });
  const again = normalizeComfy(c);
  eq('二次归一化稳定', again.loras, c.loras);
  const wfWithLora = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {model: ['12', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: '%scheduler%', denoise: 1}},
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: '%model%'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: '%width%', height: '%height%', batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {clip: ['12', 1], text: '%prompt%'}},
    7: {class_type: 'CLIPTextEncode', inputs: {clip: ['12', 1], text: '%negative_prompt%'}},
    9: {class_type: 'VAEDecode', inputs: {samples: ['3', 0], vae: ['4', 2]}},
    10: {class_type: 'SaveImage', inputs: {images: ['9', 0]}},
    12: {class_type: 'LoraLoader', inputs: {lora_name: 'x.safetensors', strength_model: 1, strength_clip: 1, model: ['4', 0], clip: ['4', 1]}},
  });
  ok('checkWorkflow 接受含 LoRA 的工作流', checkWorkflow(wfWithLora) !== '');
}

console.log('8) autoPlaceholders：自动标记');
{
  // a. 新导出的默认工作流：全部格子写死 → 全部标好
  const fresh = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {seed: 123, steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]}},
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'sd_xl.safetensors'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: 1024, height: 1024, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: 'a cat', clip: ['4', 1]}},
    7: {class_type: 'CLIPTextEncode', inputs: {text: 'bad', clip: ['4', 1]}},
    8: {class_type: 'VAEDecode', inputs: {samples: ['3', 0], vae: ['4', 2]}},
    9: {class_type: 'SaveImage', inputs: {images: ['8', 0]}},
  });
  const r = autoPlaceholders(fresh);
  const g = JSON.parse(r.workflow);
  eq('text → %prompt%', g[6].inputs.text, '%prompt%');
  eq('negative → %negative_prompt%', g[7].inputs.text, '%negative_prompt%');
  eq('seed/steps/cfg/sampler/scheduler', [g[3].inputs.seed, g[3].inputs.steps, g[3].inputs.cfg, g[3].inputs.sampler_name, g[3].inputs.scheduler], ['%seed%', '%steps%', '%scale%', '%sampler%', '%scheduler%']);
  eq('尺寸', [g[5].inputs.width, g[5].inputs.height], ['%width%', '%height%']);
  eq('底模', g[4].inputs.ckpt_name, '%model%');
  eq('底模原名带回', r.model, 'sd_xl.safetensors');
  eq('denoise 不动（保住 img2img）', g[3].inputs.denoise, 1);
  eq('VAE 引用不动', g[8].inputs.vae, ['4', 2]);
  eq('摘要 10 条', r.marked.length, 10);
  eq('没有说明', r.notes, []);
  ok('标记后过 checkWorkflow', checkWorkflow(r.workflow) !== '');
  ok('标记后 fillWorkflow 能填满', (() => { try { const c = normalizeComfy({model: r.model, workflow: r.workflow}); fillWorkflow(r.workflow, comfyValues(c, {prompt: 'p', negative: 'n', width: 832, height: 1216, seed: 1})); return true; } catch (e) { return false; } })());

  // b. 透传链 + ZeroOut 负面（Flux 常见）
  const flux = JSON.stringify({
    9: {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['10', 0], negative: ['12', 0], latent_image: ['5', 0]}},
    4: {class_type: 'UNETLoader', inputs: {unet_name: 'flux.safetensors'}},
    5: {class_type: 'EmptySD3LatentImage', inputs: {width: 1024, height: 1024, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: 'a cat', clip: ['8', 0]}},
    8: {class_type: 'CLIPLoader', inputs: {clip_name: 't5.safetensors'}},
    10: {class_type: 'ConditioningSetTimestepRange', inputs: {conditioning: ['6', 0], start: 0, end: 1}},
    12: {class_type: 'ConditioningZeroOut', inputs: {conditioning: ['10', 0]}},
  });
  const r2 = autoPlaceholders(flux);
  const g2 = JSON.parse(r2.workflow);
  eq('透传链里的提示词被标', g2[6].inputs.text, '%prompt%');
  ok('ZeroOut 有说明', r2.notes.some(x => x.includes('ConditioningZeroOut')));
  ok('负面没有单独标', !r2.marked.some(x => x.includes('负面')));
  ok('ZeroOut 节点没被动', g2[12].inputs.conditioning[0] === '10');
  eq('UNETLoader → %model%', g2[4].inputs.unet_name, '%model%');

  // c. ConditioningCombine（多路提示词）→ 不猜
  const combine = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['20', 0], negative: ['7', 0], latent_image: ['5', 0]}},
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'a.safetensors'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: 512, height: 512, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: 'a', clip: ['4', 1]}},
    7: {class_type: 'CLIPTextEncode', inputs: {text: 'bad', clip: ['4', 1]}},
    20: {class_type: 'ConditioningCombine', inputs: {conditioning_1: ['6', 0], conditioning_2: ['21', 0]}},
    21: {class_type: 'CLIPTextEncode', inputs: {text: 'b', clip: ['4', 1]}},
  });
  const r3 = autoPlaceholders(combine);
  const g3 = JSON.parse(r3.workflow);
  ok('正面没标（合并节点不猜）', g3[6].inputs.text === 'a' && g3[21].inputs.text === 'b');
  ok('负面照常标', g3[7].inputs.text === '%negative_prompt%');
  ok('合并有说明', r3.notes.some(x => x.includes('多路提示词')));
  let threw3 = ''; try { checkWorkflow(r3.workflow); } catch (e) { threw3 = e.message; }
  ok('缺 prompt 仍然报错（退回手动）', threw3.includes('没有 "%prompt%"'), threw3);

  // d. 已有部分占位符：不碰已有的，补缺的
  const partial = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {seed: '%seed%', steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]}},
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'a.safetensors'}},
    5: {class_type: 'EmptyLatentImage', inputs: {width: 512, height: 512, batch_size: 1}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: '%prompt%', clip: ['4', 1]}},
    7: {class_type: 'CLIPTextEncode', inputs: {text: 'bad', clip: ['4', 1]}},
  });
  const r4 = autoPlaceholders(partial);
  const g4 = JSON.parse(r4.workflow);
  eq('已有 %prompt% 不动', g4[6].inputs.text, '%prompt%');
  eq('补标负面', g4[7].inputs.text, '%negative_prompt%');
  eq('补标底模', g4[4].inputs.ckpt_name, '%model%');
  eq('已有 %seed% 不重复标', g4[3].inputs.seed, '%seed%');
  ok('seed 没进摘要', !r4.marked.some(x => x.includes('种子')));

  // e. 两个底模节点：都不标，有说明
  const twin = JSON.stringify({
    3: {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]}},
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'a.safetensors'}},
    14: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'b.safetensors'}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: 'x', clip: ['4', 1]}},
    7: {class_type: 'CLIPTextEncode', inputs: {text: 'y', clip: ['4', 1]}},
  });
  const r5 = autoPlaceholders(twin);
  const g5 = JSON.parse(r5.workflow);
  ok('两个底模都不标', g5[4].inputs.ckpt_name === 'a.safetensors' && g5[14].inputs.ckpt_name === 'b.safetensors');
  ok('有说明', r5.notes.some(x => x.includes('2 个底模')));

  // f. SamplerCustom + KSamplerSelect + BasicScheduler（Flux/SD3 常见）
  const custom = JSON.stringify({
    20: {class_type: 'SamplerCustom', inputs: {model: ['4', 0], add_noise: true, noise_seed: 7, cfg: 3.5, positive: ['6', 0], negative: ['7', 0], sampler: ['21', 0], sigmas: ['22', 0], latent_image: ['5', 0]}},
    4: {class_type: 'UNETLoader', inputs: {unet_name: 'flux.safetensors', weight_dtype: 'default'}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: 'a cat', clip: ['8', 0]}},
    7: {class_type: 'CLIPTextEncode', inputs: {text: '', clip: ['8', 0]}},
    21: {class_type: 'KSamplerSelect', inputs: {sampler_name: 'euler'}},
    22: {class_type: 'BasicScheduler', inputs: {scheduler: 'simple', steps: 20, denoise: 1, model: ['4', 0]}},
    5: {class_type: 'EmptySD3LatentImage', inputs: {width: 1024, height: 1024, batch_size: 1}},
    8: {class_type: 'CLIPLoader', inputs: {clip_name: 't5.safetensors'}},
  });
  const r6 = autoPlaceholders(custom);
  const g6 = JSON.parse(r6.workflow);
  eq('noise_seed → %seed%', g6[20].inputs.noise_seed, '%seed%');
  eq('cfg → %scale%', g6[20].inputs.cfg, '%scale%');
  eq('KSamplerSelect 的 sampler_name', g6[21].inputs.sampler_name, '%sampler%');
  eq('BasicScheduler 的 steps/scheduler', [g6[22].inputs.steps, g6[22].inputs.scheduler], ['%steps%', '%scheduler%']);
  eq('UNETLoader → %model%', g6[4].inputs.unet_name, '%model%');
  eq('EmptySD3 尺寸', [g6[5].inputs.width, g6[5].inputs.height], ['%width%', '%height%']);
  eq('空字符串的负面也标', g6[7].inputs.text, '%negative_prompt%');
  eq('model 原名', r6.model, 'flux.safetensors');

  // g. UI 格式抛错；引用值不碰
  let threw7 = ''; try { autoPlaceholders('{"nodes": [], "links": []}'); } catch (e) { threw7 = e.message; }
  ok('UI 格式给出导出提示', threw7.includes('导出 (API)'));
  const refd = JSON.stringify({3: {class_type: 'KSampler', inputs: {seed: ['90', 0], cfg: ['90', 1], positive: ['6', 0], negative: ['7', 0]}, 90: {class_type: 'PrimitiveNode', inputs: {value: 5}}}});
  const r7 = autoPlaceholders(refd);
  const g7 = JSON.parse(r7.workflow);
  ok('引用形式的 seed/cfg 不碰', Array.isArray(g7[3].inputs.seed) && Array.isArray(g7[3].inputs.cfg));
  ok('CLIPSetLastLayer → %clip_skip%', (() => {
    const wf = JSON.stringify({3: {class_type: 'KSampler', inputs: {seed: 1, steps: 20, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]}}, 4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'a.safetensors'}}, 5: {class_type: 'EmptyLatentImage', inputs: {width: 512, height: 512, batch_size: 1}}, 6: {class_type: 'CLIPTextEncode', inputs: {text: 'x', clip: ['13', 0]}}, 7: {class_type: 'CLIPTextEncode', inputs: {text: 'y', clip: ['13', 0]}}, 13: {class_type: 'CLIPSetLastLayer', inputs: {stop_at_clip_layer: -2, clip: ['4', 1]}}});
    const out = JSON.parse(autoPlaceholders(wf).workflow);
    return out[13].inputs.stop_at_clip_layer === '%clip_skip%';
  })());
}

console.log('8) LoRA 列表：ComfyUI 的名字 + Lora Manager 的元数据');
{
  // ComfyUI 在 Windows 上用反斜杠报 lora_name，Lora Manager 的 file_path 用正斜杠：两边必须对得上。
  const BS = String.fromCharCode(92);
  const ROOT = 'F:/LEE/ComfyUI-aki-v3.2/ComfyUI/models/loras';
  const spine = ['flat.safetensors', `K2风格2D${BS}MeIoN_Krea2.safetensors`, `Anima光影${BS}sky02v5.safetensors`, `dup${BS}same.safetensors`, `other${BS}same.safetensors`];

  eq('spineNames 从 object_info 里取名字（含 pysssss 变体，去重）',
    spineNames({LoraLoader: {input: {required: {lora_name: [['a.safetensors', 'b.safetensors']]}}},
      'LoraLoader|pysssss': {input: {required: {lora_name: [['b.safetensors', 'c.safetensors']]}}}}),
    ['a.safetensors', 'b.safetensors', 'c.safetensors']);
  eq('spineNames 遇到空壳不炸', spineNames(null), []);

  eq('loraKey 抹平分隔符和大小写', loraKey(`K2风格2D${BS}A.SafeTensors`), 'k2风格2d/a.safetensors');
  eq('loraStem 去掉目录和扩展名', loraStem(`K2风格2D${BS}MeIoN_Krea2.safetensors`), 'MeIoN_Krea2');
  eq('loraFolder 取目录', loraFolder(`K2风格2D${BS}x.safetensors`), 'K2风格2D');
  eq('loraFolder 根目录是空串', loraFolder('x.safetensors'), '');

  eq('managerPath 按 root 剥出相对路径', managerPath({file_path: `${ROOT}/K2风格2D/MeIoN_Krea2.safetensors`}, [ROOT]), 'K2风格2D/MeIoN_Krea2.safetensors');
  eq('managerPath 的 root 比较不分大小写、不分分隔符', managerPath({file_path: `${ROOT.toUpperCase()}${BS}a.safetensors`}, [ROOT + '/']), 'a.safetensors');
  eq('managerPath 对不上 root 时退回 folder + 文件名', managerPath({file_path: '/mnt/other/x.safetensors', folder: 'moved', file_name: 'x'}, [ROOT]), 'moved/x.safetensors');

  const items = [
    {file_path: `${ROOT}/K2风格2D/MeIoN_Krea2.safetensors`, file_name: 'MeIoN_Krea2', model_name: 'MeIoN artist style', folder: 'K2风格2D', base_model: 'Krea 2', preview_url: '/api/lm/previews?path=a.jpeg', favorite: true, usage_count: 3, modified: 300, tags: ['style', 'anime']},
    // root 对不上（Lora Manager 报的是另一台机器的路径），但文件主名在列表里唯一 → 还是能认出来
    {file_path: '/srv/loras/moved/sky02v5.safetensors', file_name: 'sky02v5', model_name: '光影 v5', folder: 'moved', base_model: 'Anima', usage_count: 9, modified: 100},
    // 文件主名有歧义（dup/ 和 other/ 下同名），路径又对不上 → 不能乱认，算进 unmatched
    {file_path: '/srv/loras/same.safetensors', file_name: 'same', model_name: '不知道是哪个', folder: ''},
    // ComfyUI 根本没有这个文件（删了，或者在 ComfyUI 不读的目录里）→ 跳过
    {file_path: `${ROOT}/gone/deleted.safetensors`, file_name: 'deleted', model_name: '已删除', folder: 'gone'},
  ];
  const merged = mergeLoraRows(spine, items, [ROOT]);
  eq('每个 ComfyUI 能加载的名字都有一行', merged.rows.length, spine.length);
  eq('认出 2 个', merged.decorated, 2);
  eq('2 个认不出来（歧义 + ComfyUI 没有）', merged.unmatched, 2);
  const meion = merged.rows.find(r => r.stem === 'MeIoN_Krea2');
  eq('name 用 ComfyUI 的原字符串（反斜杠保留）', meion.name, `K2风格2D${BS}MeIoN_Krea2.safetensors`);
  eq('带上模型名、底模、文件夹、收藏、次数', [meion.display, meion.baseModel, meion.folder, meion.favorite, meion.usage], ['MeIoN artist style', 'Krea 2', 'K2风格2D', true, 3]);
  eq('标签带过来', meion.tags, ['style', 'anime']);
  const sky = merged.rows.find(r => r.stem === 'sky02v5');
  ok('靠文件主名认出来的也装饰上了', sky.known && sky.display === '光影 v5');
  const dup = merged.rows.find(r => r.name === `dup${BS}same.safetensors`);
  ok('歧义的那行没被乱认', !dup.known && dup.display === 'same');
  eq('没认出来的行用路径里的文件夹', dup.folder, 'dup');
  const flat = merged.rows.find(r => r.stem === 'flat');
  ok('Lora Manager 不认识的文件照样在列表里', flat.display === 'flat' && flat.folder === '' && !flat.known);

  eq('没有元数据时也能出列表（没装 Lora Manager）', mergeLoraRows(spine).rows.length, spine.length);
  eq('空列表不炸', mergeLoraRows(null).rows, []);
}

console.log('9) 选择器的筛选与排序（都在内存里做，不走网络）');
{
  const rows = mergeLoraRows(
    ['a.safetensors', 'sub/b.safetensors', 'sub/c.safetensors'],
    [
      {file_path: '/r/a.safetensors', file_name: 'a', model_name: '阿尔法', base_model: 'Krea 2', folder: '', favorite: true, usage_count: 1, modified: 30, tags: ['style']},
      {file_path: '/r/sub/b.safetensors', file_name: 'b', model_name: '贝塔', base_model: 'Anima', folder: 'sub', usage_count: 7, modified: 10},
      {file_path: '/r/sub/c.safetensors', file_name: 'c', model_name: '伽马', base_model: 'Krea 2', folder: 'sub', usage_count: 3, modified: 20},
    ], ['/r']).rows;

  eq('搜模型名', filterLoraRows(rows, {search: '贝塔'}).map(r => r.stem), ['b']);
  eq('搜文件名', filterLoraRows(rows, {search: 'c.safe'}).map(r => r.stem), ['c']);
  eq('搜标签', filterLoraRows(rows, {search: 'style'}).map(r => r.stem), ['a']);
  eq('多个词要同时命中', filterLoraRows(rows, {search: 'sub 伽马'}).map(r => r.stem), ['c']);
  eq('按文件夹筛', filterLoraRows(rows, {folder: 'sub'}).map(r => r.stem), ['b', 'c']);
  eq('按底模筛', filterLoraRows(rows, {baseModel: 'Krea 2'}).map(r => r.stem), ['a', 'c']);
  eq('只看收藏', filterLoraRows(rows, {favoritesOnly: true}).map(r => r.stem), ['a']);
  eq('筛选条件叠加', filterLoraRows(rows, {folder: 'sub', baseModel: 'Krea 2'}).map(r => r.stem), ['c']);
  eq('什么都不填就是全部', filterLoraRows(rows, {}).length, 3);

  eq('按用得最多排', sortLoraRows(rows, 'usage').map(r => r.stem), ['b', 'c', 'a']);
  eq('按最近加的排', sortLoraRows(rows, 'recent').map(r => r.stem), ['a', 'c', 'b']);
  ok('排序不改原数组', rows[0].stem === 'a');

  const facets = loraFacets(rows);
  eq('文件夹统计', facets.folders, [{value: 'sub', count: 2}, {value: '', count: 1}]);
  eq('底模统计', facets.baseModels, [{value: 'Krea 2', count: 2}, {value: 'Anima', count: 1}]);
  eq('收藏数', facets.favorites, 1);
}

console.log('10) 缩略图地址：直连拼 ComfyUI，走酒馆时交给 LoRA 桥');
{
  eq('直连', previewSrc('direct', 'http://127.0.0.1:8188', '/api/lm/previews?path=a.jpeg'), 'http://127.0.0.1:8188/api/lm/previews?path=a.jpeg');
  ok('走酒馆时指向插件路由', previewSrc('plugin', 'http://127.0.0.1:8188', '/api/lm/previews?path=a.jpeg').startsWith('/api/plugins/st-iphonie-lora/file?url=http%3A%2F%2F127.0.0.1%3A8188&path=%2Fapi%2Flm%2Fpreviews'));
  eq('白名单外的路径不给地址', previewSrc('direct', 'http://127.0.0.1:8188', '/etc/passwd'), '');
  eq('没有预览图就是空', previewSrc('direct', 'http://127.0.0.1:8188', ''), '');
  eq('旧补丁没有缩略图', previewSrc('legacy', 'http://127.0.0.1:8188', '/api/lm/previews?path=a.jpeg'), '');
}

console.log('11) 双采工作流：两个 Lora Manager 节点，每遍用不同的 LoRA');
{
  // 真实形状：UNET 只有 MODEL，CLIP 由单独的 CLIPLoader 给；两个 Lora Manager 节点各喂一个采样器，
  // 第二个串在第一个后面（所以第二遍还叠着第一遍的），这正是 双采 + 细节 LoRA 的画法。
  const LM = 'Lora Loader (LoraManager)';
  const twoPass = {
    2: {class_type: 'UNETLoader', inputs: {unet_name: '%model%', weight_dtype: 'default'}},
    3: {class_type: 'CLIPLoader', inputs: {clip_name: 'qwen.safetensors', type: 'stable_diffusion'}},
    4: {class_type: 'VAELoader', inputs: {vae_name: 'v.safetensors'}},
    5: {class_type: LM, inputs: {text: '', loras: {__value__: []}, model: ['2', 0], clip: ['3', 0]}},
    6: {class_type: LM, inputs: {text: '<lora:detail:0.6>', loras: {__value__: [{name: 'detail', strength: 0.6, clipStrength: 0.6, active: true}]}, model: ['5', 0], clip: ['5', 1]}},
    7: {class_type: 'CLIPTextEncode', inputs: {text: '%prompt%', clip: ['5', 1]}},
    8: {class_type: 'CLIPTextEncode', inputs: {text: '%negative_prompt%', clip: ['5', 1]}},
    9: {class_type: 'EmptyLatentImage', inputs: {width: '%width%', height: '%height%', batch_size: 1}},
    10: {class_type: 'KSampler', inputs: {denoise: 1, model: ['5', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['9', 0], seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: '%scheduler%'}},
    11: {class_type: 'LatentUpscale', inputs: {upscale_method: 'bislerp', width: 1248, height: 1824, crop: 'disabled', samples: ['10', 0]}},
    12: {class_type: 'KSampler', inputs: {denoise: 0.4, model: ['6', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['11', 0], seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: '%scheduler%'}},
    13: {class_type: 'VAEDecode', inputs: {samples: ['12', 0], vae: ['4', 0]}},
    14: {class_type: 'SaveImage', inputs: {filename_prefix: 'p', images: ['13', 0]}},
  };
  const text = JSON.stringify(twoPass);
  const plan = loraPlan(text);

  eq('认出两遍，顺序按采样链排', plan.passes.map(p => p.id), ['10', '12']);
  eq('第二遍的降噪读出来了', plan.passes[1].denoise, 0.4);
  eq('两个阶段，都锚在工作流的节点上', plan.stages.map(s => [s.key, s.kind]), [['node:5', 'node'], ['node:6', 'node']]);
  eq('节点 5 喂两遍（它在上游）', plan.stages[0].feeds, [0, 1]);
  eq('节点 6 只喂第二遍', plan.stages[1].feeds, [1]);
  eq('节点 6 叠在节点 5 上', plan.stages[1].upstream, ['node:5']);
  eq('节点 6 的 LoRA 从工作流读出来了', plan.stages[1].stack, [{name: 'detail', model: 0.6, clip: 0.6}]);
  eq('没有管不到的遍数', plan.uncovered, []);

  // 写回：只有那两个节点该变，其余一个字节不动，也不该多出节点
  const stacks = {
    'node:5': [{name: 'Anima风格2D\\style.safetensors', model: 1, clip: 0.9, on: true, trigger: 'Anima风格2D/style'}],
    'node:6': [{name: 'detail', model: 0.6, clip: 0.6, on: true, trigger: 'detail tag'}, {name: 'off.safetensors', model: 1, clip: 1, on: false}],
  };
  const out = JSON.parse(applyLoras(text, plan, stacks));
  eq('节点数没变（没有插节点）', Object.keys(out).length, Object.keys(twoPass).length);
  const touched = Object.keys(twoPass).filter(id => JSON.stringify(twoPass[id]) !== JSON.stringify(out[id]));
  eq('只有两个 LoRA 节点被改', touched, ['5', '6']);
  eq('写进去的名字：正斜杠、不带扩展名', out['5'].inputs.loras.__value__, [{name: 'Anima风格2D/style', strength: 1, active: true, expanded: false, clipStrength: 0.9, selected: false, locked: false}]);
  eq('text 镜像只列启用的，模型权重和文本权重一样时不写第三个字段', out['5'].inputs.text, '<lora:Anima风格2D/style:1:0.9>');
  eq('关掉的行留在 widget 里但 active=false', out['6'].inputs.loras.__value__.map(e => [e.name, e.active]), [['detail', true], ['off', false]]);
  eq('关掉的行不进 text 镜像', out['6'].inputs.text, '<lora:detail:0.6>');
  eq('节点 5 的 clip 还是接在 CLIPLoader 上', out['5'].inputs.clip, ['3', 0]);
  eq('提示词节点没被动', out['7'].inputs.clip, ['5', 1]);

  // 两个采样器实际拿到的 LoRA：第二遍 = 第一遍的 + 自己的
  const stackOf = id => {
    const seen = [], names = new Set();
    let cur = out[id].inputs.model;
    while (Array.isArray(cur) && !names.has(cur[0])) {
      names.add(cur[0]);
      const n = out[cur[0]];
      const list = (n.inputs?.loras?.__value__ || []).filter(e => e.active).map(e => e.name);
      if (list.length) seen.push(...list);
      cur = Array.isArray(n.inputs?.model) ? n.inputs.model : null;
    }
    return seen;
  };
  eq('第一遍只吃到节点 5 的', stackOf('10'), ['Anima风格2D/style']);
  eq('第二遍吃到节点 6 的 + 节点 5 的', stackOf('12'), ['detail', 'Anima风格2D/style']);

  // 触发词取并集：提示词节点是两个采样器共用的，只能有一条提示词
  eq('触发词取两遍的并集', loraTriggers('1girl', [...stacks['node:5'], ...stacks['node:6']]), 'Anima风格2D/style, detail tag, 1girl');
  eq('触发词并集去掉重复', loraTriggers('1girl', [{trigger: 'a, b', on: true}, {trigger: 'b, c', on: true}]), 'a, b, c, 1girl');
  eq('关掉的阶段的触发词不拼', loraTriggers('1girl', [{trigger: 'a', on: false}]), '1girl');

  // 空的一份：节点该被清空，不是保持原样
  const cleared = JSON.parse(writeStages(text, plan, {'node:5': [], 'node:6': []}));
  eq('清空节点 5', cleared['5'].inputs.loras.__value__, []);
  eq('清空节点 5 的镜像', cleared['5'].inputs.text, '');
}

console.log('12) 阶段识别怎么退让：没有 Lora Manager 节点、节点孤立、图不认识');
{
  const ckpt = {
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: '%model%'}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: '%prompt%', clip: ['4', 1]}},
    9: {class_type: 'EmptyLatentImage', inputs: {width: '%width%', height: '%height%', batch_size: 1}},
    10: {class_type: 'KSampler', inputs: {denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['9', 0]}},
  };
  const planCkpt = loraPlan(JSON.stringify(ckpt));
  eq('普通工作流：一个 inject 阶段', planCkpt.stages.map(s => [s.key, s.kind]), [['inject', 'inject']]);
  eq('它喂所有遍', planCkpt.stages[0].feeds, [0]);
  eq('inject 阶段的 stack 是空的（栈在设置里，不在工作流里）', planCkpt.stages[0].stack, []);

  // 双采但没有 Lora Manager 节点 → 仍然只有一个 inject，插在底模后（会和以前一模一样）
  const plainTwo = JSON.parse(JSON.stringify(ckpt));
  plainTwo['11'] = {class_type: 'LatentUpscale', inputs: {upscale_method: 'nearest', width: 8, height: 8, crop: 'disabled', samples: ['10', 0]}};
  plainTwo['12'] = {class_type: 'KSampler', inputs: {denoise: 0.4, model: ['4', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['11', 0]}};
  const planPlain = loraPlan(JSON.stringify(plainTwo));
  eq('两遍共用一个 inject 阶段', planPlain.stages.length, 1);
  eq('两遍都算在它头上', planPlain.stages[0].feeds, [0, 1]);

  // 工作流里只有孤立（没接到采样器）的 Lora Manager 节点 → 还是退回 inject，不能装作管得到
  const orphan = JSON.parse(JSON.stringify(ckpt));
  orphan['20'] = {class_type: 'Lora Loader (LoraManager)', inputs: {loras: {__value__: [{name: 'x', strength: 1, active: true}]}, model: ['4', 0], clip: ['4', 1]}};
  eq('孤立的节点不产生阶段', loraPlan(JSON.stringify(orphan)).stages.map(s => s.kind), ['inject']);

  // 一个阶段管得到、另一个管不到 → 管得到的照常写，管不到的报出来，不乱插
  const half = JSON.parse(JSON.stringify(twoPassSafe()));
  function twoPassSafe() { return {2: {class_type: 'UNETLoader', inputs: {unet_name: 'm'}}, 3: {class_type: 'CLIPLoader', inputs: {clip_name: 'c'}}, 5: {class_type: 'Lora Loader (LoraManager)', inputs: {loras: {__value__: []}, model: ['2', 0], clip: ['3', 0]}}, 9: {class_type: 'EmptyLatentImage', inputs: {width: 8, height: 8, batch_size: 1}}, 10: {class_type: 'KSampler', inputs: {denoise: 1, model: ['5', 0], latent_image: ['9', 0]}}, 11: {class_type: 'LatentUpscale', inputs: {samples: ['10', 0], width: 8, height: 8}}, 12: {class_type: 'KSampler', inputs: {denoise: 0.4, model: ['3', 0], latent_image: ['11', 0]}}}; }
  const planHalf = loraPlan(JSON.stringify(half));
  eq('一个阶段', planHalf.stages.map(s => s.kind), ['node']);
  eq('第二遍没走到 LoRA 节点，被报出来', planHalf.uncovered, [1]);

  // 读不出来的工作流也要给一个 inject 阶段：LoRA 退回老行为，而不是悄悄不生效
  const blind = {key: 'inject', kind: 'inject', nodeId: '', classType: '', stack: [], feeds: [], upstream: []};
  eq('坏 JSON：退回一个 inject 阶段，不抛', loraPlan('not json'), {passes: [], stages: [blind], uncovered: []});
  eq('空字符串：同样是 inject', loraPlan('').stages.map(s => s.key), ['inject']);
  eq('数组不是工作流：同样是 inject', loraPlan('[1,2]').stages.map(s => s.key), ['inject']);
  eq('没采样器的工作流仍然给一个 inject 阶段', loraPlan('{"4":{"class_type":"CheckpointLoaderSimple","inputs":{}}}').stages.map(s => s.kind), ['inject']);
  eq('写回空计划：原样返回', writeStages('{"a":1}', {stages: []}, {}), '{"a":1}');
}

console.log('13) unet-only 底模也要吃到 CLIP');
{
  const loras = [{name: 'style.safetensors', model: 1, clip: 0.8, on: true}];
  // UNET + 独立 CLIPLoader，提示词节点从 #3 取 CLIP → 注入的链要带上 CLIP，并改到提示词节点上
  const unet = {
    2: {class_type: 'UNETLoader', inputs: {unet_name: '%model%'}},
    3: {class_type: 'CLIPLoader', inputs: {clip_name: 'qwen.safetensors', type: 'stable_diffusion'}},
    5: {class_type: 'CLIPTextEncode', inputs: {text: '%prompt%', clip: ['3', 0]}},
    9: {class_type: 'EmptyLatentImage', inputs: {width: '%width%', height: '%height%', batch_size: 1}},
    10: {class_type: 'KSampler', inputs: {denoise: 1, model: ['2', 0], positive: ['5', 0], negative: ['5', 0], latent_image: ['9', 0]}},
  };
  const a = JSON.parse(injectLoras(JSON.stringify(unet), loras));
  eq('用带 CLIP 的 LoraLoader', a['11'].class_type, 'LoraLoader');
  eq('CLIP 来源是那个 CLIPLoader', a['11'].inputs.clip, ['3', 0]);
  eq('文本权重带过去了', a['11'].inputs.strength_clip, 0.8);
  eq('提示词节点改读链尾的 CLIP', a['5'].inputs.clip, ['11', 1]);
  eq('采样器改读链尾的模型', a['10'].inputs.model, ['11', 0]);

  // 两个消费者各从一个 CLIP 来源取 → 说不准，退回只改模型（老行为），不能乱接
  const split = JSON.parse(JSON.stringify(unet));
  split['6'] = {class_type: 'CLIPTextEncode', inputs: {text: '%negative_prompt%', clip: ['7', 0]}};
  split['7'] = {class_type: 'CLIPLoader', inputs: {clip_name: 'other.safetensors', type: 'stable_diffusion'}};
  split['10'].inputs.negative = ['6', 0];
  const b = JSON.parse(injectLoras(JSON.stringify(split), loras));
  eq('说不准就只改模型', b['11'].class_type, 'LoraLoaderModelOnly');
  eq('原来的 CLIP 链接一个都没动', [b['5'].inputs.clip, b['6'].inputs.clip], [['3', 0], ['7', 0]]);

  // 自带 CLIP 的 checkpoint：老行为不变
  const ckpt = {
    4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: '%model%'}},
    6: {class_type: 'CLIPTextEncode', inputs: {text: '%prompt%', clip: ['4', 1]}},
    9: {class_type: 'EmptyLatentImage', inputs: {width: '%width%', height: '%height%', batch_size: 1}},
    10: {class_type: 'KSampler', inputs: {denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['9', 0]}},
  };
  const c = JSON.parse(injectLoras(JSON.stringify(ckpt), loras));
  eq('checkpoint 照旧用 LoraLoader', c['11'].class_type, 'LoraLoader');
  eq('CLIP 接底模的 CLIP 输出', c['11'].inputs.clip, ['4', 1]);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
