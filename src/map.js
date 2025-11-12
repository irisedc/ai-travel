import { loadScriptOnce } from './util.js';

let mapInstance = null;
let geocoder = null;
const geoCache = new Map();
const cityCenters = {
	'北京': [116.4074, 39.9042],
	'上海': [121.4737, 31.2304],
	'广州': [113.2644, 23.1291],
	'深圳': [114.0579, 22.5431],
	'杭州': [120.1551, 30.2741],
	'成都': [104.0665, 30.5723],
	'西安': [108.9398, 34.3416],
	'重庆': [106.5516, 29.5630],
	'南京': [118.7969, 32.0603],
	'武汉': [114.3054, 30.5931],
	'天津': [117.2000, 39.0845],
	'青岛': [120.3826, 36.0671],
	'厦门': [118.0894, 24.4798],
	'三亚': [109.5121, 18.2528],
	'香港': [114.1694, 22.3193],
	'澳门': [113.5439, 22.1987],
	'台北': [121.5654, 25.0330],
	'东京': [139.6917, 35.6895],
	'大阪': [135.5022, 34.6937],
	'首尔': [126.9780, 37.5665],
	'新加坡': [103.8198, 1.3521],
	'曼谷': [100.5018, 13.7563],
	'巴黎': [2.3522, 48.8566],
	'伦敦': [-0.1276, 51.5072],
	'纽约': [-74.0060, 40.7128]
};

const webServiceCache = new Map();
let amapKeyForService = '';

export async function ensureAmapLoaded(amapKey) {
	if (!amapKey) {
		alert('未设置高德 Web Key，地图将无法显示。请先在设置中填写。');
		return;
	}
	amapKeyForService = amapKey;
	const src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapKey)}&plugin=AMap.Scale,AMap.ToolBar,AMap.Driving,AMap.Geocoder`;
	await loadScriptOnce(src);
}

export function initMap() {
	if (!window.AMap) return;
	mapInstance = new AMap.Map('map', { zoom: 11, center: [116.397, 39.909] });
	mapInstance.addControl(new AMap.Scale());
	mapInstance.addControl(new AMap.ToolBar());
	geocoder = new AMap.Geocoder({ city: '全国' });
}

export async function renderPlanOnMap(plan) {
	if (!window.AMap || !mapInstance) return;
	mapInstance.clearMap();
	const allLngLat = [];
	const dayCity = (day) => day.city || plan.destination || '';

	const poiPromises = (plan.days || []).flatMap(day =>
		(day.pois || []).map(poi => ensurePoiLocation(poi, dayCity(day)))
	);

	const resolved = await Promise.all(poiPromises);
	let idx = 0;
	(plan.days || []).forEach(day => {
		(day.pois || []).forEach(poi => {
			const loc = resolved[idx++];
			if (loc) {
				const marker = new AMap.Marker({ position: loc, title: poi.name });
				marker.setMap(mapInstance);
				allLngLat.push(loc);
			}
		});
	});

	if (allLngLat.length > 0) {
		mapInstance.setFitView();
	} else if (plan.destination) {
		const destLoc = await ensureCityCenter(plan.destination);
		if (destLoc) mapInstance.setZoomAndCenter(11, destLoc);
	}
}

async function ensurePoiLocation(poi, city) {
	const direct = normalizeDirectLocation(poi.location);
	if (direct) {
		return direct;
}
	const key = `${poi.name || ''}|${city || ''}`;
	if (geoCache.has(key)) return geoCache.get(key);

	let loc = await geocodeText(`${city || ''}${poi.name || ''}`, city);
	if (!loc) loc = await geocodeText(poi.name, city);
	if (!loc) loc = await geocodeText(poi.name);

	if (loc && city) {
		const center = await ensureCityCenter(city);
		if (center && distanceKm(center, loc) > 200) {
			loc = null;
		}
	}

	if (!loc && city) loc = await ensureCityCenter(city);
	if (!loc && poi.name) loc = await ensureCityCenter(poi.name);

	if (loc) geoCache.set(key, loc);
	return loc;
}

function normalizeDirectLocation(loc) {
	if (!Array.isArray(loc) || loc.length < 2) return null;
	let lng = Number(loc[0]);
	let lat = Number(loc[1]);
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
	// 如果第二个值超出纬度范围，而第一个值在纬度范围内，则认为是 [lat, lng] 需要交换
	if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
		[lng, lat] = [lat, lng];
	}
	// 如果第一个值超出经度范围而第二个值在纬度范围内，同样交换
	if (Math.abs(lng) > 180 && Math.abs(lat) <= 90) {
		[lng, lat] = [lat, lng];
	}
	// 若交换后仍然超出合法范围，放弃直接使用
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	return [lng, lat];
}

async function geocodeText(text, city = '') {
	if (!text) return null;
	if (geocoder) {
		const lnglat = await geocodeByJsApi(text, city);
		if (lnglat) return lnglat;
	}
	return geocodeByWebService(text, city);
}

function geocodeByJsApi(text, city = '') {
	return new Promise(resolve => {
		if (!geocoder) return resolve(null);
		if (city) geocoder.setCity(city);
		else geocoder.setCity('全国');
		geocoder.getLocation(text, (status, result) => {
			if (status === 'complete' && result.geocodes && result.geocodes.length) {
				const first = result.geocodes[0];
				const lng = parseFloat(first.location?.lng);
				const lat = parseFloat(first.location?.lat);
				if (Number.isFinite(lng) && Number.isFinite(lat)) {
					return resolve([lng, lat]);
				}
			}
			resolve(null);
		});
	});
}

async function geocodeByWebService(text, city = '') {
	if (!amapKeyForService) return null;
	const cacheKey = `ws:${city}|${text}`;
	if (webServiceCache.has(cacheKey)) return webServiceCache.get(cacheKey);
	const params = new URLSearchParams({
		key: amapKeyForService,
		address: text,
		output: 'JSON'
	});
	if (city) params.set('city', city);
	const url = `https://restapi.amap.com/v3/geocode/geo?${params.toString()}`;
	try {
		const resp = await fetch(url);
		if (!resp.ok) return null;
		const data = await resp.json();
		if (data?.status === '1' && data.geocodes?.length) {
			const first = data.geocodes[0];
			if (first.location) {
				const [lngStr, latStr] = first.location.split(',');
				const lng = parseFloat(lngStr);
				const lat = parseFloat(latStr);
				if (Number.isFinite(lng) && Number.isFinite(lat)) {
					const lnglat = [lng, lat];
					webServiceCache.set(cacheKey, lnglat);
					return lnglat;
				}
			}
		}
	} catch (e) {
		console.warn('高德 WebService 地理编码失败', e);
	}
	return null;
}

async function ensureCityCenter(cityText) {
	if (!cityText) return null;
	const matchedKey = Object.keys(cityCenters).find(k => cityText.includes(k));
	if (matchedKey) return cityCenters[matchedKey];
	const cacheKey = `__city__${cityText}`;
	if (geoCache.has(cacheKey)) return geoCache.get(cacheKey);
	const loc = await geocodeText(cityText);
	if (loc) geoCache.set(cacheKey, loc);
	return loc;
}

// 粗略球面距离（公里）
function distanceKm(a, b) {
	const toRad = d => (d * Math.PI) / 180;
	const R = 6371;
	const dLat = toRad((b[1] || 0) - (a[1] || 0));
	const dLng = toRad((b[0] || 0) - (a[0] || 0));
	const lat1 = toRad(a[1] || 0);
	const lat2 = toRad(b[1] || 0);
	const h =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}


