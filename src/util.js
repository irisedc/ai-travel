export function el(id) {
	return document.getElementById(id);
}
export function setHTML(id, html) {
	const node = el(id);
	if (node) node.innerHTML = html;
}
export function loadScriptOnce(src) {
	return new Promise((resolve, reject) => {
		const existed = document.querySelector(`script[src="${src}"]`);
		if (existed) return existed.addEventListener('load', () => resolve());
		const s = document.createElement('script');
		s.src = src;
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('脚本加载失败：' + src));
		document.head.appendChild(s);
	});
}
export function saveLocal(k, v) {
	localStorage.setItem(k, JSON.stringify(v));
}
export function loadLocal(k, def = null) {
	try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : def; } catch { return def; }
}





