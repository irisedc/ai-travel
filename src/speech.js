// 语音模块
// 优先：科大讯飞 IAT WebSocket（需要 AppId / APIKey / APISecret）
// 回退：Web Speech API（部分地区会被网络策略阻断，可能报 network）
export async function startSpeechToText(settings) {
	if (settings?.xfAppId && settings?.xfApiKey && settings?.xfApiSecret) {
		return await iFlytekIAT(settings);
	}
	return await webSpeechFallback();
}

async function webSpeechFallback() {
	const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
	if (!SR) throw new Error('当前浏览器不支持 Web Speech API，请在设置中配置讯飞参数。');
	return new Promise((resolve, reject) => {
		try {
			const sr = new SR();
			sr.lang = 'zh-CN';
			sr.interimResults = false;
			sr.maxAlternatives = 1;
			let finalText = '';
			sr.onresult = (e) => {
				finalText = e.results[0][0].transcript;
			};
			sr.onerror = (e) => reject(new Error(e.error || '语音识别错误（Web Speech）'));
			sr.onend = () => resolve(finalText);
			sr.start();
		} catch (e) {
			reject(e);
		}
	});
}

// ================= 讯飞 IAT WebSocket 实现（简版，仅用于原型） =================
// 文档要点：https://www.xfyun.cn/doc/asr/voicedictation/HTTP_V2.html （WebSocket 版）
// 注意：生产环境应在服务端计算鉴权，避免在前端暴露 APISecret
async function iFlytekIAT(settings) {
	const authUrl = await buildIatAuthUrl(settings);
	const stream = await createMicStream();
	const ws = new WebSocket(authUrl);

	return await new Promise((resolve, reject) => {
		let finished = false;
		// 维护分段（按 sn 排序），支持 wpgs 动态修正：apd 追加、rpl 区间替换
		const segments = [];

		ws.onopen = async () => {
			try {
				// 发送 start 帧
				ws.send(JSON.stringify({
					common: { app_id: settings.xfAppId },
					business: {
						language: 'zh_cn',
						domain: 'iat',
						accent: 'mandarin',
						vad_eos: 10000,
						dwa: 'wpgs' // 开启动态修正
					},
					data: {
						status: 0,
						format: 'audio/L16;rate=16000',
						audio: '',
						encoding: 'raw'
					}
				}));

				// 连续读取麦克风、编码为 16k 16bit PCM、base64 分片发送
				for await (const chunk of stream) {
					if (ws.readyState !== 1) break;
					ws.send(JSON.stringify({
						data: {
							status: 1,
							format: 'audio/L16;rate=16000',
							encoding: 'raw',
							audio: arrayBufferToBase64(chunk)
						}
					}));
				}

				// 结束帧
				if (ws.readyState === 1) {
					ws.send(JSON.stringify({
						data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' }
					}));
				}
			} catch (e) {
				if (!finished) {
					finished = true;
					try { ws.close(); } catch {}
					reject(e);
				}
			}
		};

		ws.onmessage = (evt) => {
			try {
				const msg = JSON.parse(evt.data);
				if (msg.code !== 0) {
					throw new Error(`讯飞识别失败：${msg.code} ${msg.message || ''}`);
				}
				const data = msg.data;
				if (data?.result) {
					updateSegmentsWithResult(segments, data.result);
				}
				if (data?.status === 2 && !finished) {
					finished = true;
					try { ws.close(); } catch {}
					resolve(segmentsToText(segments));
				}
			} catch (e) {
				if (!finished) {
					finished = true;
					try { ws.close(); } catch {}
					reject(e);
				}
			}
		};
		ws.onerror = (e) => {
			if (!finished) {
				finished = true;
				reject(new Error('讯飞 WebSocket 连接错误'));
			}
		};
		ws.onclose = () => {
			// 忽略
		};
	});
}

// 生成讯飞 IAT WebSocket 鉴权 URL（前端演示用途）
async function buildIatAuthUrl(settings) {
	const host = 'iat-api.xfyun.cn';
	const date = new Date().toUTCString();
	const algorithm = 'hmac-sha256';
	const headers = 'host date request-line';
	const signatureOrigin = `host: ${host}\n` +
		`date: ${date}\n` +
		`GET /v2/iat HTTP/1.1`;
	const signatureSha = await hmacSha256Base64(signatureOrigin, settings.xfApiSecret);
	const authorizationOrigin = `api_key="${settings.xfApiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signatureSha}"`;
	const authorization = btoa(authorizationOrigin);
	const url = `wss://${host}/v2/iat?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`;
	return url;
}

// 计算 HMAC-SHA256 并返回 Base64
async function hmacSha256Base64(text, key) {
	const encoder = new TextEncoder();
	const algo = { name: 'HMAC', hash: 'SHA-256' };
	const keyData = encoder.encode(key);
	const data = encoder.encode(text);
	const cryptoObj = window.crypto || window.msCrypto;
	if (!cryptoObj?.subtle) throw new Error('当前环境不支持加密 API，无法使用讯飞鉴权');
	const cryptoKey = await cryptoObj.subtle.importKey('raw', keyData, algo, false, ['sign']);
	const signature = await cryptoObj.subtle.sign(algo, cryptoKey, data);
	return arrayBufferToBase64(signature);
}



// ============== 音频采集与编码 ==============
async function createMicStream() {
	const ac = new (window.AudioContext || window.webkitAudioContext)();
	const media = await navigator.mediaDevices.getUserMedia({ audio: true });
	const source = ac.createMediaStreamSource(media);
	const processor = ac.createScriptProcessor(4096, 1, 1);
	source.connect(processor);
	processor.connect(ac.destination);

	let stopped = false;
	const queue = [];
	const inSampleRate = ac.sampleRate || 48000;
	let silenceMs = 0;
	processor.onaudioprocess = (e) => {
		if (stopped) return;
		const input = e.inputBuffer.getChannelData(0);
		// 简单静音检测（RMS）
		let rms = 0;
		for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
		rms = Math.sqrt(rms / input.length);
		if (rms < 0.01) silenceMs += (processor.bufferSize / inSampleRate) * 1000;
		else silenceMs = 0;

		// 重采样到 16k
		const float16k = (inSampleRate === 16000) ? input : resampleTo16k(input, inSampleRate);
		const pcm16 = floatTo16BitPCM(float16k);
		queue.push(pcm16.buffer);

		// 连续静音 3000ms 认为结束（放宽，避免第二句被截断）
		if (silenceMs > 3000) {
			try { iterator.return(); } catch {}
		}
	};

	// 返回异步可迭代：每 200ms 取一段
	const iterator = {
		[Symbol.asyncIterator]() { return this; },
		async next() {
			if (stopped) return { done: true };
			// 等待 100ms（降低延迟）
			await new Promise(r => setTimeout(r, 100));
			if (queue.length === 0) return this.next();
			const chunk = queue.shift();
			return { value: chunk, done: false };
		},
		return() {
			stopped = true;
			try { processor.disconnect(); } catch {}
			try { source.disconnect(); } catch {}
			try { media.getTracks().forEach(t => t.stop()); } catch {}
			return { done: true };
		}
	};
	return iterator;
}

// 线性重采样至 16k
function resampleTo16k(input, inRate) {
	const ratio = 16000 / inRate;
	const newLen = Math.round(input.length * ratio);
	const out = new Float32Array(newLen);
	let pos = 0;
	for (let i = 0; i < newLen; i++) {
		const idx = i / ratio;
		const i0 = Math.floor(idx);
		const i1 = Math.min(i0 + 1, input.length - 1);
		const w = idx - i0;
		out[i] = input[i0] * (1 - w) + input[i1] * w;
	}
	return out;
}

function floatTo16BitPCM(float32Array) {
	const buffer = new ArrayBuffer(float32Array.length * 2);
	const view = new DataView(buffer);
	let offset = 0;
	for (let i = 0; i < float32Array.length; i++, offset += 2) {
		let s = Math.max(-1, Math.min(1, float32Array[i]));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
	}
	return new Uint8Array(buffer);
}

function arrayBufferToBase64(ab) {
	const bytes = new Uint8Array(ab);
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk);
	}
	return btoa(binary);
}

// 解析讯飞 IAT 结果（wpgs 动态修正）
function parseIatResult(result) {
	try {
		// 兼容：未开启 wpgs（result.ws 直接在 result 下）与 开启 wpgs（result.cn.st.rt[*].ws）
		if (Array.isArray(result.ws)) {
			let text = '';
			result.ws.forEach(w => {
				(w.cw || []).forEach(c => { text += c.w || ''; });
			});
			return text;
		}
		if (result?.cn?.st?.rt && Array.isArray(result.cn.st.rt)) {
			let text = '';
			result.cn.st.rt.forEach(rt => {
				(rt.ws || []).forEach(w => {
					(w.cw || []).forEach(c => { text += c.w || ''; });
				});
			});
			return text;
		}
		return '';
	} catch {
		return '';
	}
}

// 依据讯飞文档（wpgs 动态修正），按 sn/pgs/rg 维护分段
function updateSegmentsWithResult(segments, result) {
	const sn = result.sn;
	const pgs = result.pgs ?? result.cn?.pgs; // 'apd' 追加 或 'rpl' 替换
	const rg = result.rg ?? result.cn?.rg;   // [start, end]（当 pgs 为 rpl 时存在）
	const text = parseIatResult(result);
	if (!text) return;

	if (pgs === 'rpl' && Array.isArray(rg) && rg.length === 2) {
		const [start, end] = rg;
		for (let i = segments.length - 1; i >= 0; i--) {
			if (segments[i].sn >= start && segments[i].sn <= end) {
				segments.splice(i, 1);
			}
		}
	}
	segments.push({ sn, text });
	segments.sort((a, b) => a.sn - b.sn);
}

function segmentsToText(segments) {
	let out = '';
	for (const s of segments) {
		// 避免孤立标点破坏体验：若 out 为空且当前仅标点则跳过
		if (!out && /^[\s。！？，、.!,，]+$/.test(s.text)) continue;
		out += s.text;
	}
	return out;
}

