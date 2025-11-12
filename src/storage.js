import { loadLocal, saveLocal } from './util.js';

let supabase = null;
const LOCAL_KEY = 'ai-travel-plans';

export async function initStorage(settings) {
	if (window.__supabaseClient && settings?.sbUrl && settings?.sbAnon) {
		supabase = window.__supabaseClient;
		// 可选：确保表存在（需要服务端或 SQL 预建，此处略）
	} else {
		supabase = null;
	}
}

export async function savePlanForUser(user, plan) {
	if (!user) return;
	if (supabase) {
		const { error } = await supabase.from('plans').insert({
			user_id: user.id,
			plan_json: plan,
			created_at: new Date().toISOString()
		});
		if (error) console.warn('保存到 Supabase 失败，使用本地存储', error);
	}
	// 本地兜底
	const all = loadLocal(LOCAL_KEY, []);
	all.push({ userId: user?.id || 'local', plan, ts: Date.now() });
	saveLocal(LOCAL_KEY, all);
}

export async function listPlansForUser(user) {
	if (!user) return [];
	if (supabase) {
		const { data, error } = await supabase.from('plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
		if (!error && data) return data.map(r => ({ id: r.id, plan: r.plan_json, ts: new Date(r.created_at).getTime() }));
	}
	const all = loadLocal(LOCAL_KEY, []);
	return all.filter(p => p.userId === (user?.id || 'local'));
}





