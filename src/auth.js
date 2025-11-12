import { loadLocal } from './util.js';

let supabase = null;
let supabaseClientLoaded = false;

async function ensureSupabaseClient() {
	if (supabaseClientLoaded) return;
	if (!window.createClient) {
		await new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = 'https://esm.sh/@supabase/supabase-js@2.45.0';
			s.type = 'module';
			s.onload = resolve;
			s.onerror = () => reject(new Error('加载 Supabase SDK 失败'));
			document.head.appendChild(s);
		});
	}
	supabaseClientLoaded = true;
}

export async function initAuth(settings) {
	if (!settings?.sbUrl || !settings?.sbAnon) {
		supabase = null;
		return;
	}
	// 通过 ESM shim 方式在浏览器加载 Supabase
	if (!window.__supabaseClient) {
		// 动态模块导入
		const mod = await import('https://esm.sh/@supabase/supabase-js@2.45.0');
		window.__supabaseClient = mod.createClient(settings.sbUrl, settings.sbAnon);
	}
	supabase = window.__supabaseClient;
}

export function getCurrentUser() {
	if (!supabase) return null;
	// 无法同步获取，简单缓存最近会话
	return window.__supabaseUser || null;
}

export async function signInWithEmailLink(email) {
	if (!supabase) throw new Error('未配置 Supabase');
	const { data, error } = await supabase.auth.signInWithOtp({ email });
	if (error) throw error;
	return data;
}

export async function signOut() {
	if (!supabase) return;
	await supabase.auth.signOut();
	window.__supabaseUser = null;
}

// 启动时尝试获取会话（可选）
(async () => {
	try {
		if (window.__supabaseClient) {
			const { data } = await window.__supabaseClient.auth.getUser();
			window.__supabaseUser = data?.user || null;
		}
	} catch {}
})();





