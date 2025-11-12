import { el } from './util.js';
import { saveLocal, loadLocal } from './util.js';

const KEY = 'ai-travel-settings';

export function loadSettings() {
	return loadLocal(KEY, {
		amapKey: '',
		xfAppId: '',
		xfApiKey: '',
		xfApiSecret: '',
		sbUrl: '',
		sbAnon: '',
		llmBase: '',
		llmKey: '',
		llmModel: ''
	});
}
export function saveSettings(s) {
	saveLocal(KEY, s);
}
export function bindSettingsModal() {
	const modal = el('modalSettings');
	el('btnSettings').addEventListener('click', () => {
		const s = loadSettings();
		el('amapKey').value = s.amapKey || '';
		el('xfAppId').value = s.xfAppId || '';
		el('xfApiKey').value = s.xfApiKey || '';
		el('xfApiSecret').value = s.xfApiSecret || '';
		el('sbUrl').value = s.sbUrl || '';
		el('sbAnon').value = s.sbAnon || '';
		el('llmBase').value = s.llmBase || '';
		el('llmKey').value = s.llmKey || '';
		el('llmModel').value = s.llmModel || '';
		modal.hidden = false;
	});
	el('btnCloseSettings').addEventListener('click', () => modal.hidden = true);
	el('btnSaveSettings').addEventListener('click', () => {
		const s = loadSettings();
		s.amapKey = el('amapKey').value.trim();
		s.xfAppId = el('xfAppId').value.trim();
		s.xfApiKey = el('xfApiKey').value.trim();
		s.xfApiSecret = el('xfApiSecret').value.trim();
		s.sbUrl = el('sbUrl').value.trim();
		s.sbAnon = el('sbAnon').value.trim();
		s.llmBase = el('llmBase').value.trim();
		s.llmKey = el('llmKey').value.trim();
		s.llmModel = el('llmModel').value.trim();
		saveSettings(s);
		alert('已保存');
	});
}


