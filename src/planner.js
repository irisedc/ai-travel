// 行程规划：未配置 LLM 时提供简单规则生成；可对接任意兼容的 LLM 代理

function parseUserIntent(input) {
	const text = input.replace(/\s+/g, '');
	const res = {
		destination: '',
		days: 3,
		budget: null,
		tags: [],
		withKids: /孩|小朋友|孩子/.test(text),
		people: 1
	};
	// 目的地（简单抓取“去XX/到XX/想去XX”）
	const mDest = text.match(/(去|到|想去)([^\d天预算喜欢带人群]+?)([,，。]|$)/);
	if (mDest && mDest[2]) res.destination = mDest[2].replace(/[,，。]/g, '');
	// 天数
	const mDays = text.match(/(\d+)\s*天/);
	if (mDays) res.days = Math.max(1, Math.min(10, parseInt(mDays[1], 10)));
	// 预算
	const mBudget = text.match(/预算\s*([0-9]+[\.0-9]*)/);
	if (mBudget) res.budget = Number(mBudget[1]);
	// 偏好
	if (/美食/.test(text)) res.tags.push('美食');
	if (/博物馆|历史/.test(text)) res.tags.push('文化');
	if (/动漫|二次元/.test(text)) res.tags.push('动漫');
	if (/自然|徒步|公园/.test(text)) res.tags.push('自然');
	// 同行人数
	const mPeople = text.match(/(\d+)\s*(人|位)/);
	if (mPeople) res.people = Math.max(1, parseInt(mPeople[1], 10));
	return res;
}

function makeRuleBasedPlan(parsed) {
	const city = parsed.destination || '目的地';
	const days = parsed.days || 3;
	const poisTemplates = [
		{ name: '市中心地标', location: [116.397, 39.909], note: '拍照与打卡' },
		{ name: '特色美食街', location: [116.405, 39.915], note: '本地小吃' },
		{ name: '亲子乐园', location: [116.39, 39.92], note: '带孩子适合' },
		{ name: '博物馆', location: [116.38, 39.90], note: '文化历史' },
		{ name: '公园/自然', location: [116.41, 39.92], note: '放松漫步' }
	];
	const daysArr = Array.from({ length: days }).map((_, i) => {
		const picks = [];
		if (parsed.tags.includes('美食')) picks.push(poisTemplates[1]);
		if (parsed.withKids) picks.push(poisTemplates[2]);
		if (parsed.tags.includes('文化')) picks.push(poisTemplates[3]);
		if (parsed.tags.includes('自然')) picks.push(poisTemplates[4]);
		if (picks.length < 3) picks.unshift(poisTemplates[0]);
		return { city, pois: picks.slice(0, 3) };
	});
	const budget = estimateBudget(parsed);
	return { destination: city, days: daysArr, budget, meta: parsed };
}

function estimateBudget(parsed) {
	// 非精确，仅示意：基础 500/天/人 + 住宿 200/天/人 + 门票 80/天/人
	const p = parsed.people || 1;
	const base = 500 * p * parsed.days;
	const hotel = 200 * p * parsed.days;
	const tickets = 80 * p * parsed.days;
	const food = 150 * p * parsed.days;
	const total = base + hotel + tickets + food;
	return {
		total,
		transport: base,
		hotel,
		food,
		tickets
	};
}

async function callLLMIfConfigured(parsed, settings) {
	// 预留：如 settings.llmBase 与 settings.llmKey 存在，可对接你的 LLM 代理
	// 下面返回 null 表示未启用 LLM，走规则计划
	if (!settings.llmBase || !settings.llmKey) return null;
	try {
		const model = settings.llmModel?.trim() || 'deepseek-ai/DeepSeek-V2-Chat';
		const base = normalizeBase(settings.llmBase);
		const url = `${base}/v1/chat/completions`;
		// 为避免长时间无响应，这里增加超时（15s）
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 15000);
		const resp = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${settings.llmKey}`
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: 'system', content:
						[
							'你是专业旅行规划助手，仅输出 JSON，禁止任何额外文本。',
							'JSON 结构：',
							'{',
							'  "destination": string,',
							'  "days": [',
							'    {',
							'      "city": string,',
							'      "pois": [',
							'        {',
							'          "name": string,',
							'          "location": [number, number] | null,',
							'          "note": string  // 包含时间段（上午/下午/夜间）、活动细节、适合人群、消费提示、交通建议',
							'        }',
							'      ]',
							'    }',
							'  ],',
							'  "budget": {',
							'    "total": number, "transport": number, "hotel": number, "food": number, "tickets": number',
							'  }',
							'}',
							`要求：days 必须包含 ${parsed.days} 天，每天至少 3 个活动（含餐饮/亲子/体验等），note 需写够 2~3 句描述实际安排与消费水平。`,
							'预算需尽量贴合用户预算（若用户给定预算则在 ±20% 内），并确保四项费用求和等于 total（单位：人民币元）。',
							'尽量给出餐厅或地标的真实名称；如不确定经纬度，可返回 null，系统会自动地理编码。',
							'禁止输出 Markdown、解释或额外文字，只能输出符合结构的 JSON。'
						].join('\n')
					},
					{ role: 'user', content: JSON.stringify(parsed) }
				],
				temperature: 0.5,
				top_p: 0.9,
				max_tokens: 1400
			}),
			signal: controller.signal
		});
		clearTimeout(timer);
		if (!resp.ok) {
			const errText = await resp.text().catch(() => resp.statusText);
			throw new Error(`HTTP ${resp.status} ${resp.statusText} - ${errText}`);
		}
		const data = await resp.json();
		const text = data.choices?.[0]?.message?.content || '';
		// 期望是 JSON；若不是，尝试从文本中提取
		const jsonStart = text.indexOf('{');
		const jsonEnd = text.lastIndexOf('}');
		if (jsonStart >= 0 && jsonEnd > jsonStart) {
			const json = text.slice(jsonStart, jsonEnd + 1);
			try {
				let plan = JSON.parse(json);
				return validateAndHealPlan(parsed, plan);
			} catch (parseErr) {
				// 宽松解析：修正常见错误（单引号、未加引号的键、尾逗号），或使用函数求值兜底
				try {
					const loose = tryParseJsonLoose(json);
					if (loose) {
						return validateAndHealPlan(parsed, loose);
					}
				} catch (e2) {
					console.warn('宽松 JSON 解析仍失败：', e2);
				}
				console.warn('LLM JSON 解析失败：', parseErr, json);
				alert(`大模型返回的 JSON 解析失败：${parseErr.message}\n已为你保留规则行程。可重试或更换模型。`);
				return null; // 返回 null，上层会回退规则方案
			}
		}
		// 若模型未输出 JSON，则回退规则，但提示一次
		console.warn('LLM 未输出 JSON，回退规则。原始内容：', text);
		alert('提示：已成功调用大模型，但未返回结构化 JSON，已回退为规则行程。\n可尝试更换“模型名”或稍后再试。');
		return null;
	} catch (e) {
		console.warn('LLM 调用失败，使用规则行程：', e);
		alert(`大模型调用失败：${e.message}\n请检查：\n1) LLM API Base 与 Key 是否正确（硅基流动 Base: https://api.siliconflow.cn/v1）\n2) 模型名是否存在且有权限\n3) 若是浏览器跨域（CORS），可改用本地/代理服务器转发`);
		return null;
	}
}

export async function planFromText(input, settings) {
	const parsed = parseUserIntent(input);
	const llmPlan = await callLLMIfConfigured(parsed, settings);
	if (llmPlan) return llmPlan;
	return makeRuleBasedPlan(parsed);
}

function normalizeBase(base) {
	const trimmed = (base || '').trim().replace(/\s+/g, '');
	if (!trimmed) return '';
	const noTrailSlash = trimmed.replace(/\/+$/, '');
	// 如果最后一级已是 /v1 或 /v1/，去掉它，避免重复
	if (/\/v\d+$/i.test(noTrailSlash)) {
		return noTrailSlash.replace(/\/v\d+$/i, '');
	}
	return noTrailSlash;
}

// 校验与补全：确保 days 与预算合理；若天数不足则用规则计划补满，预算缺失则估算
function validateAndHealPlan(parsed, plan) {
	try {
		if (!plan || typeof plan !== 'object') throw new Error('empty plan');
		const fixed = { ...plan };
		fixed.destination = fixed.destination || parsed.destination || '目的地';
		fixed.days = Array.isArray(fixed.days) ? fixed.days : [];
		// 补齐/裁剪到期望天数
		const rule = makeRuleBasedPlan(parsed);
		const merged = [];
		for (let i = 0; i < parsed.days; i++) {
			const cand = fixed.days[i];
			// 如果该天不存在，或 POI 少于 3，则使用规则计划对应天替换
			if (!cand || !Array.isArray(cand.pois) || cand.pois.length < 3) {
				merged[i] = rule.days[i];
			} else {
				merged[i] = cand;
			}
		}
		fixed.days = merged;
		// 预算检查与估算
		const rawBudget = normalizeBudgetFields(fixed.budget);
		const budget = rawBudget ?? estimateBudget(parsed);
		fixed.budget = alignBudgetToTarget(budget, parsed.budget, parsed);
		return fixed;
	} catch {
		return makeRuleBasedPlan(parsed);
	}
}

function normalizeBudgetFields(budget) {
	if (!budget) return null;
	const keys = ['transport', 'hotel', 'food', 'tickets'];
	const normalized = {};
	for (const k of keys) {
		const val = Number(budget[k]);
		if (!Number.isFinite(val)) return null;
		normalized[k] = val;
	}
	let total = Number(budget.total);
	if (!Number.isFinite(total)) {
		total = keys.reduce((sum, k) => sum + normalized[k], 0);
	}
	normalized.total = total;
	return normalized;
}

function alignBudgetToTarget(budget, targetTotal, parsed) {
	const keys = ['transport', 'hotel', 'food', 'tickets'];
	let currentSum = keys.reduce((sum, k) => sum + (budget[k] || 0), 0);
	if (currentSum <= 0) {
		return estimateBudget(parsed);
	}
	if (targetTotal && targetTotal > 0) {
		const ratio = targetTotal / currentSum;
		for (const k of keys) {
			budget[k] = Math.round((budget[k] || 0) * ratio / 10) * 10;
		}
		currentSum = keys.reduce((sum, k) => sum + (budget[k] || 0), 0);
	}
	budget.total = currentSum;
	return budget;
}

// 宽松 JSON 解析：修正常见格式，并在必要时使用安全受限的函数求值
function tryParseJsonLoose(src) {
	let s = String(src);
	// 去除多余逗号
	s = s.replace(/,\s*([}\]])/g, '$1');
	// 为未加引号的键补引号
	s = s.replace(/(\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
	// 将单引号字符串替换为双引号（保留转义）
	s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
	try {
		return JSON.parse(s);
	} catch (_) {
		// 兜底：尝试用函数求值再转成 JSON（注意仅在前端使用，来源受控）
		try {
			// eslint-disable-next-line no-new-func
			const obj = Function(`"use strict";return (${s})`)();
			return obj;
		} catch (e2) {
			throw e2;
		}
	}
}
