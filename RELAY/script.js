// ==================== GLOBALS ====================
let mqttClient = null, qrScanner = null;
let schedules = JSON.parse(localStorage.getItem('dm_schedules') || '[]');
let schedulerInterval = null, lastTriggered = {};
let ghSyncEnabled = false, ghConfig = {}, ghSyncTimeout = null;
let notifConfig = JSON.parse(localStorage.getItem('dm_notif_config') || '{}');
let tgEnabled = notifConfig.tg?.enabled||false, tgConnected = notifConfig.tg?.connected||false;
let relayCount = parseInt(localStorage.getItem('dm_relay_count') || '5');
let maxRelayFromDevice = 16;
let currentHardware = "";
let currentRelayState = [];
let DEVICE_ID = "";
let mqttBroker = "", mqttPort = "", mqttUser = "", mqttPass = "";
let relayLabels = [];
let currentDeviceAlias = "";

let lastGpioSyncTime = 0;
const GPIO_SYNC_THROTTLE_MS = 10000;
let ignoreDeviceUpdatesUntil = 0;
const IGNORE_DURATION_MS = 15000;
let periodicWhitelistCheckInterval = null;
let deferredPrompt = null;

let devices = [];
let currentDeviceId = null;

const $ = id => document.getElementById(id);
const safeVal = (id, val) => { const el = $(id); if(el) el.value = val; };
const safeTxt = (id, txt) => { const el = $(id); if(el) el.textContent = txt; };
const safeCls = (el, cls, add) => { if(el) el.classList.toggle(cls, add); };
const log = msg => { const t = $('terminal'); if(t) t.innerHTML = '['+new Date().toLocaleTimeString()+'] '+msg+'\n'+t.innerHTML; };
function vibrate() { if (window.navigator && window.navigator.vibrate) window.navigator.vibrate(20); }

function getRelayLabel(relayNum) {
  if (relayLabels && relayLabels.length >= relayNum && relayLabels[relayNum-1] && relayLabels[relayNum-1].trim()) {
    return relayLabels[relayNum-1];
  }
  return `Relay ${relayNum}`;
}

function updateAliasDisplay() {
  const aliasSpan = document.getElementById('deviceAliasDisplay');
  if (aliasSpan) {
    const displayName = currentDeviceAlias && currentDeviceAlias.trim() !== "" ? currentDeviceAlias : DEVICE_ID;
    aliasSpan.textContent = displayName;
  }
}

// ========== HMAC, NONCE, TIMESTAMP ==========
function generateNonce() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

async function hmacSha256(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pubSecure(topic, payloadObj) {
  const device = devices.find(d => d.deviceId === DEVICE_ID);
  if (!device || !device.secret) {
    log('No secret for this device');
    return false;
  }
  const nonce = generateNonce();
  const timestamp = getTimestamp();
  console.log(`[DEBUG] Sending timestamp: ${timestamp} (${new Date(timestamp*1000).toISOString()})`);
  const fullPayloadObj = { ...payloadObj, nonce, timestamp };
  const payloadStr = JSON.stringify(fullPayloadObj);
  const sig = await hmacSha256(payloadStr, device.secret);
  const finalPayload = JSON.stringify({ ...fullPayloadObj, sig });
  return new Promise((resolve) => {
    mqttClient.publish(topic, finalPayload, { qos: 1 }, (err) => {
      if (err) log(`Publish error: ${err}`);
      else log(`Secure command sent to ${topic}`);
      resolve(!err);
    });
  });
}

// ==================== DEVICE MANAGER ====================
function loadDevicesFromStorage() {
  const stored = localStorage.getItem('dm_devices');
  if (stored) {
    try {
      devices = JSON.parse(stored);
    } catch(e) { devices = []; }
  }
  currentDeviceId = localStorage.getItem('dm_current_device_id');
  if (!currentDeviceId && devices.length > 0) currentDeviceId = devices[0].deviceId;
  renderDeviceList();
}

function saveDevicesToStorage() {
  localStorage.setItem('dm_devices', JSON.stringify(devices));
  if (currentDeviceId) localStorage.setItem('dm_current_device_id', currentDeviceId);
}

async function updateDeviceAliasInGitHub(deviceId, newAlias) {
  const device = devices.find(d => d.deviceId === deviceId);
  if (!device) return false;
  const path = `${device.ghBasePath || 'RELAY/data'}/${deviceId}/device.json`;
  const url = `https://api.github.com/repos/${device.ghOwner}/${device.ghRepo}/contents/${path}`;
  try {
    const getRes = await fetch(url, { headers: { 'Authorization': `token ${device.ghToken}` } });
    if (!getRes.ok) throw new Error('Failed to fetch device.json');
    const data = await getRes.json();
    const content = JSON.parse(atob(data.content));
    content.alias = newAlias;
    content.updatedAt = new Date().toISOString();
    const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': `token ${device.ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Update alias to ${newAlias}`, content: newContent, sha: data.sha, branch: 'main' })
    });
    if (putRes.ok) {
      log(`Alias updated in GitHub for ${deviceId} → ${newAlias}`);
      device.alias = newAlias;
      saveDevicesToStorage();
      renderDeviceList();
      if (deviceId === currentDeviceId) {
        currentDeviceAlias = newAlias;
        updateAliasDisplay();
      }
      return true;
    } else {
      throw new Error('PUT failed');
    }
  } catch(err) {
    log(`Failed to update alias in GitHub: ${err.message}`);
    alert('Failed to save alias to GitHub. Check token and network.');
    return false;
  }
}

function renderDeviceList() {
  const container = document.getElementById('deviceListContainer');
  if (!container) return;
  if (!devices.length) {
    container.innerHTML = '<p style="color:#64748b;">No devices added. Click "Add Device" to start.</p>';
    document.getElementById('activeDeviceName').innerText = '-';
    return;
  }
  let html = '';
  devices.forEach(dev => {
    const isActive = (dev.deviceId === currentDeviceId);
    html += `
      <div class="device-item">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="flex:1;">
            <input type="text" class="device-alias-input" data-id="${dev.deviceId}" value="${escapeHtml(dev.alias || dev.deviceId)}" style="font-weight:bold; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:4px 8px; color:var(--accent); width:auto; min-width:140px;">
            <div style="font-size:0.7rem; color:#94a3b8; margin-top:4px;">ID: ${dev.deviceId}</div>
          </div>
          <div style="display:flex; gap:6px;">
            ${!isActive ? `<button class="btn-sm btn-primary switch-device-btn" data-id="${dev.deviceId}">Switch</button>` : '<span class="sync-status sync-on">Active</span>'}
            <button class="btn-sm btn-danger delete-device-btn" data-id="${dev.deviceId}" ${devices.length === 1 ? 'disabled' : ''}>🗑️</button>
            ${isActive ? `<button class="btn-sm btn-warning reset-secret-btn" data-id="${dev.deviceId}">🔑 Reset Secret</button>` : ''}
          </div>
        </div>
        <div style="font-size:0.7rem; margin-top:8px; color:#64748b;">
          MQTT: ${dev.mqttBroker}:${dev.mqttPort} | GitHub: ${dev.ghOwner}/${dev.ghRepo}
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  document.getElementById('activeDeviceName').innerText = devices.find(d => d.deviceId === currentDeviceId)?.alias || currentDeviceId;
  
  document.querySelectorAll('.device-alias-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const deviceId = input.getAttribute('data-id');
      const newAlias = input.value.trim();
      if (newAlias && newAlias !== devices.find(d => d.deviceId === deviceId)?.alias) {
        await updateDeviceAliasInGitHub(deviceId, newAlias);
      } else if (!newAlias) {
        input.value = devices.find(d => d.deviceId === deviceId)?.alias || deviceId;
      }
    });
  });
  document.querySelectorAll('.switch-device-btn').forEach(btn => {
    btn.addEventListener('click', () => switchDevice(btn.getAttribute('data-id')));
  });
  document.querySelectorAll('.delete-device-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (devices.length === 1) return alert('Cannot delete the only device. Add another first.');
      if (confirm(`Delete device "${id}"? This will NOT delete GitHub data, only local reference.`)) {
        deleteDevice(id);
      }
    });
  });
  document.querySelectorAll('.reset-secret-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (id === currentDeviceId && confirm('Reset secret will regenerate device key. You must re-pair (scan new QR). Continue?')) {
        await pubSecure(`${DEVICE_ID}/resetSecret`, { cmd: 1 });
        alert('Secret reset command sent. Device will restart and generate new secret. Please re-pair using QR from SoftAP.');
      }
    });
  });
}

function deleteDevice(deviceId) {
  if (deviceId === currentDeviceId) {
    const other = devices.find(d => d.deviceId !== deviceId);
    if (other) switchDevice(other.deviceId);
    else return;
  }
  devices = devices.filter(d => d.deviceId !== deviceId);
  saveDevicesToStorage();
  renderDeviceList();
  log(`Device ${deviceId} removed from local list`);
}

async function addDeviceFromQR(data) {
  try {
    let jsonData;
    try { jsonData = JSON.parse(data); } catch(e) { 
      let fixed = data.replace(/"device":\s*([^",\n\}]+)/, '"device":"$1"');
      jsonData = JSON.parse(fixed);
    }
    if (!jsonData.broker || !jsonData.port || !jsonData.user || !jsonData.pass || !jsonData.device) throw new Error('Missing MQTT fields');
    if (!jsonData.ghOwner || !jsonData.ghRepo || !jsonData.ghToken) throw new Error('Missing GitHub fields');
    if (!jsonData.secret) throw new Error('Missing secret');
    
    let deviceRaw = jsonData.device;
    if (!deviceRaw.startsWith('DmarchFF_')) deviceRaw = 'DmarchFF_' + deviceRaw;
    const deviceId = deviceRaw;
    
    const allowed = await isDeviceWhitelisted(deviceId);
    if (!allowed) {
      alert(`Device ID ${deviceId} not whitelisted. Contact support.`);
      return;
    }
    
    const existing = devices.find(d => d.deviceId === deviceId);
    if (existing) {
      if (confirm(`Device ${deviceId} already exists. Switch to it?`)) {
        switchDevice(deviceId);
      }
      return;
    }
    
    const newDevice = {
      deviceId: deviceId,
      alias: deviceId,
      mqttBroker: jsonData.broker,
      mqttPort: jsonData.port,
      mqttUser: jsonData.user,
      mqttPass: jsonData.pass,
      ghOwner: jsonData.ghOwner,
      ghRepo: jsonData.ghRepo,
      ghBasePath: jsonData.ghBasePath || 'RELAY/data',
      ghToken: jsonData.ghToken,
      secret: jsonData.secret
    };
    devices.push(newDevice);
    saveDevicesToStorage();
    renderDeviceList();
    if (confirm(`Device ${deviceId} added. Switch to it now?`)) {
      switchDevice(deviceId);
    } else {
      log(`Device ${deviceId} added but not activated.`);
    }
  } catch(e) {
    alert('Invalid QR data: ' + e.message);
  }
}

async function switchDevice(deviceId) {
  const device = devices.find(d => d.deviceId === deviceId);
  if (!device) return;
  
  // Unsubscribe dari topik device lama jika ada
  if (mqttClient && mqttClient.connected && DEVICE_ID) {
    mqttClient.unsubscribe(`${DEVICE_ID}/relay/+/state`);
    mqttClient.unsubscribe(`${DEVICE_ID}/status`);
    mqttClient.unsubscribe(`${DEVICE_ID}/terminal`);
    mqttClient.unsubscribe(`${DEVICE_ID}/wifi/scan_result`);
  }
  
  if (mqttClient && mqttClient.connected) mqttClient.end(true);
  
  DEVICE_ID = device.deviceId;
  mqttBroker = device.mqttBroker;
  mqttPort = device.mqttPort;
  mqttUser = device.mqttUser;
  mqttPass = device.mqttPass;
  ghConfig = {
    owner: device.ghOwner,
    repo: device.ghRepo,
    basePath: device.ghBasePath,
    token: device.ghToken,
    branch: 'main'
  };
  ghSyncEnabled = true;
  setSyncStatus(true);
  currentDeviceId = deviceId;
  currentDeviceAlias = device.alias || deviceId;
  
  localStorage.setItem('dm_full_config', JSON.stringify({
    broker: mqttBroker, port: mqttPort, user: mqttUser, pass: mqttPass,
    device: DEVICE_ID, ghOwner: ghConfig.owner, ghRepo: ghConfig.repo,
    ghBasePath: ghConfig.basePath, ghToken: ghConfig.token
  }));
  localStorage.setItem('dm_gh_config', JSON.stringify(ghConfig));
  localStorage.setItem('dm_device_id', DEVICE_ID);
  saveDevicesToStorage();
  
  document.getElementById('deviceIdDisplay').textContent = DEVICE_ID;
  updateAliasDisplay();
  renderDeviceList();
  
  await loadDeviceConfigFromGitHub();
  connectMQTT();
  log(`Switched to device ${DEVICE_ID} (${currentDeviceAlias})`);
}

// ==================== WHITELIST ====================
async function isDeviceWhitelisted(deviceId) {
  const cacheKey = 'dm_whitelist_cache';
  const cacheExpiry = 60000;
  let whitelist = null;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (Date.now() - data.timestamp < cacheExpiry) whitelist = data.list;
      else localStorage.removeItem(cacheKey);
    } catch(e) { localStorage.removeItem(cacheKey); }
  }
  if (!whitelist) {
    const url = 'https://raw.githubusercontent.com/dreborn2k/dmarchFF/main/RELAY/config/whitelist.json';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('Whitelist file is empty');
      whitelist = JSON.parse(text);
      if (!Array.isArray(whitelist)) throw new Error('Not array');
      if (whitelist.length > 0) localStorage.setItem(cacheKey, JSON.stringify({ list: whitelist, timestamp: Date.now() }));
      else localStorage.removeItem(cacheKey);
    } catch (e) { console.error(e); return false; }
  }
  return Array.isArray(whitelist) && whitelist.includes(deviceId);
}

async function refreshWhitelist() {
  localStorage.removeItem('dm_whitelist_cache');
  const statusEl = $('whitelistStatus');
  if (statusEl) statusEl.textContent = '🔄 Refreshing...';
  await isDeviceWhitelisted('');
  if (statusEl) statusEl.textContent = '✅ Whitelist refreshed';
  setTimeout(() => { if(statusEl) statusEl.textContent = ''; }, 2000);
  if (DEVICE_ID) {
    const allowed = await isDeviceWhitelisted(DEVICE_ID);
    if (!allowed) logoutAndReset('❌ Device not in whitelist.');
  }
}

function logoutAndReset(message) {
  if (periodicWhitelistCheckInterval) clearInterval(periodicWhitelistCheckInterval);
  localStorage.removeItem('dm_full_config'); localStorage.removeItem('dm_gh_config'); localStorage.removeItem('dm_relay_count');
  localStorage.removeItem('dm_gpio'); localStorage.removeItem('dm_schedules'); localStorage.removeItem('dm_device_suffix');
  localStorage.removeItem('dm_device_id');
  ghSyncEnabled = false; DEVICE_ID = ""; mqttBroker = ""; mqttPort = ""; mqttUser = ""; mqttPass = "";
  relayCount = 5;
  if (mqttClient && mqttClient.connected) mqttClient.end(true);
  $('connCard').classList.remove('hidden');
  document.querySelectorAll('.app-card').forEach(c => c.classList.add('hidden'));
  safeTxt('connStatus', 'Status: Not configured');
  alert(message);
}

function startPeriodicWhitelistCheck() {
  if (periodicWhitelistCheckInterval) clearInterval(periodicWhitelistCheckInterval);
  periodicWhitelistCheckInterval = setInterval(async () => {
    if (!DEVICE_ID) return;
    const allowed = await isDeviceWhitelisted(DEVICE_ID);
    if (!allowed) logoutAndReset('❌ Device removed from whitelist.');
  }, 30000);
}

// ==================== LOCATION & TIME ====================
let timeInterval = null, geoCache = null;
const GEO_CACHE_EXPIRY = 3600000;

function updateLocationInfoDisplay() {
  const locTextSpan = document.getElementById('locText');
  if (!locTextSpan) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString();
  const tzStr = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let latStr = '--', lonStr = '--', addressStr = '';
  if (geoCache) {
    latStr = geoCache.lat?.toFixed(6) || '--';
    lonStr = geoCache.lon?.toFixed(6) || '--';
    addressStr = geoCache.address || '';
  }
  locTextSpan.innerHTML = `🕐 ${timeStr} &nbsp; 🌐 ${tzStr} &nbsp; 📍 ${latStr} ${lonStr}<br>🏠 ${addressStr}`;
}

async function getGeolocation(forceRefresh = false) {
  if (!forceRefresh && geoCache && (Date.now() - geoCache.timestamp) < GEO_CACHE_EXPIRY) { updateLocationInfoDisplay(); return; }
  if (!navigator.geolocation) { updateLocationInfoDisplay(); return; }
  const locTextSpan = document.getElementById('locText');
  if (locTextSpan) locTextSpan.innerHTML = '🔄 Fetching location...';
  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude, lon = position.coords.longitude;
    geoCache = { lat, lon, timestamp: Date.now() };
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
      const data = await response.json();
      let address = '';
      if (data && data.address) {
        const road = data.address.road || data.address.pedestrian || '';
        const city = data.address.city || data.address.town || data.address.village || '';
        const country = data.address.country || '';
        address = [road, city, country].filter(s => s).join(', ');
      }
      if (!address) address = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      geoCache.address = address;
      localStorage.setItem('dm_geo_cache', JSON.stringify(geoCache));
    } catch (e) { geoCache.address = 'Unable to fetch address'; }
    updateLocationInfoDisplay();
  }, () => { 
    geoCache = { lat: '--', lon: '--', address: 'Location error', timestamp: Date.now() };
    updateLocationInfoDisplay();
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function initLocationInfo() {
  const cached = localStorage.getItem('dm_geo_cache');
  if (cached) { try { geoCache = JSON.parse(cached); if (geoCache && (Date.now() - geoCache.timestamp) < GEO_CACHE_EXPIRY) { updateLocationInfoDisplay(); } else getGeolocation(); } catch(e) { getGeolocation(); } } else { getGeolocation(); }
  if (timeInterval) clearInterval(timeInterval);
  timeInterval = setInterval(() => { updateLocationInfoDisplay(); }, 1000);
  updateLocationInfoDisplay();
  const refreshBtn = document.getElementById('refreshLocationBtn');
  if (refreshBtn) refreshBtn.onclick = () => getGeolocation(true);
}

// ==================== UI HELPERS ====================
function updateCurrentGpioText() {
  const container = $('currentGpioText');
  if (!container) return;
  const gpioRaw = $('gpioInput').value.trim();
  if (!gpioRaw) { container.textContent = 'Current: --'; return; }
  const pins = gpioRaw.split(',').map(p => p.trim()).filter(p => p);
  container.textContent = `Current: ${pins.join(',')}`;
}

function validateGpioAndRelayCount(gpioRaw, relayCnt) {
  const pins = gpioRaw.split(',').map(p => p.trim()).filter(p => p);
  if (pins.length !== relayCnt) { alert(`❌ GPIO count (${pins.length}) != relays (${relayCnt})`); return false; }
  const uniquePins = new Set(pins);
  if (uniquePins.size !== pins.length) { alert(`❌ Duplicate GPIO pins: ${pins.join(',')}`); return false; }
  for (let p of pins) if (isNaN(parseInt(p))) { alert(`❌ Invalid GPIO: ${p}`); return false; }
  return true;
}

function updateRelayUIByCount() { 
  safeVal('relayCountInput', relayCount); 
  initRelayButtons(); 
  updateSchedulerRelaySelect(); 
  renderRelayLabelsInputs();
  log(`UI updated to ${relayCount} relays`); 
}

function saveAllConfig() { localStorage.setItem('dm_full_config', JSON.stringify({ broker: mqttBroker, port: mqttPort, user: mqttUser, pass: mqttPass, device: DEVICE_ID, ghOwner: ghConfig.owner, ghRepo: ghConfig.repo, ghBasePath: ghConfig.basePath, ghToken: ghConfig.token })); }

function loadFullConfig() {
  const saved = localStorage.getItem('dm_full_config');
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      mqttBroker = cfg.broker; mqttPort = cfg.port; mqttUser = cfg.user; mqttPass = cfg.pass;
      DEVICE_ID = cfg.device;
      if (cfg.ghOwner && cfg.ghToken) { ghConfig = { owner: cfg.ghOwner, repo: cfg.ghRepo, basePath: cfg.ghBasePath || 'RELAY/data', token: cfg.ghToken, branch: 'main' }; ghSyncEnabled = true; localStorage.setItem('dm_gh_config', JSON.stringify(ghConfig)); }
      const deviceIdDisplay = $('deviceIdDisplay'); if (deviceIdDisplay) deviceIdDisplay.textContent = DEVICE_ID;
      const savedRelayCount = localStorage.getItem('dm_relay_count');
      if (savedRelayCount) { relayCount = parseInt(savedRelayCount); safeVal('relayCountInput', relayCount); }
      return true;
    } catch(e) { console.warn(e); }
  }
  return false;
}

function getDeviceDataPath() { if (!DEVICE_ID) return null; const base = ghConfig.basePath || 'RELAY/data'; return `${base}/${DEVICE_ID}`; }
function getSchedulerPath() { const base = getDeviceDataPath(); return base ? `${base}/scheduler.json` : null; }
function getDeviceConfigPath() { const base = getDeviceDataPath(); return base ? `${base}/device.json` : null; }
function updateGhPathDisplay() {}

// ==================== MQTT ====================
function pub(topic, payload) { if(mqttClient && mqttClient.connected) mqttClient.publish(topic, payload, {qos:0}); else log('⚠️ Disconnected'); }

// ==================== UPDATE SYSTEM HEALTH (FIXED) ====================
function updateSystemHealth(msg) {
  console.log('🔄 updateSystemHealth called, raw msg:', msg.substring(0, 200));
  try {
    const d = JSON.parse(msg);
    console.log('Parsed status:', d);

    // Filter device ID
    if (d.device_id && d.device_id !== DEVICE_ID) {
      console.warn(`Ignoring status from wrong device: ${d.device_id} (current ${DEVICE_ID})`);
      return;
    }

    // 1. Update System Health Card
    if (d.rssi !== undefined) safeTxt('sigVal', d.rssi + '%');
    if (d.uptime !== undefined) safeTxt('upVal', d.uptime);
    if (d.temp !== undefined) safeTxt('tempVal', d.temp + '°C');
    if (d.fw_version !== undefined) safeTxt('fwVal', d.fw_version);

    // 2. Update WiFi Status & SSID
    if (d.wifi_status) {
      let wifiText = d.wifi_status;
      if (d.connected_ssid && d.connected_ssid.trim() !== "") {
        wifiText += ` ${d.connected_ssid}`;
      }
      safeTxt('wifiStatusDisplay', wifiText);
      console.log(`WiFi updated: ${wifiText}`);
    } else {
      safeTxt('wifiStatusDisplay', '--');
    }

    // 3. Update Hardware Info
    if (d.hw_type) {
      currentHardware = d.hw_type;
      safeTxt('hwType', d.hw_type);
    }
    if (d.max_relay) {
      maxRelayFromDevice = d.max_relay;
      safeTxt('maxRelay', d.max_relay);
      safeTxt('maxRelayLimit', d.max_relay);
      safeTxt('maxRelayLimitTab', d.max_relay);
      const inp = $('relayCountInput');
      if (inp) inp.max = d.max_relay;
    }

    // 4. Update Relay Count (dengan throttle)
    const now = Date.now();
    const ignore = (now < ignoreDeviceUpdatesUntil);
    if (ignore && d.relay_count !== undefined) {
      log(`Ignoring relay_count=${d.relay_count} (manual change active)`);
    } else if (d.relay_count !== undefined && d.relay_count != relayCount) {
      relayCount = d.relay_count;
      localStorage.setItem('dm_relay_count', relayCount);
      updateRelayUIByCount();
      log(`Relay count updated to ${relayCount} from device`);
    }

    // 5. Update GPIO Pins (relay_pins)
    if (d.relay_pins) {
      console.log('Raw relay_pins from status:', d.relay_pins);
      renderPinBadges(d.relay_pins);
      if (!ignore) {
        if (d.relay_pins !== window.lastGpio) {
          if (now - lastGpioSyncTime >= GPIO_SYNC_THROTTLE_MS) {
            console.log(`Updating GPIO input field to: ${d.relay_pins}`);
            safeVal('gpioInput', d.relay_pins);
            window.lastGpio = d.relay_pins;
            updateCurrentGpioText();
            lastGpioSyncTime = now;
            log(`GPIO updated from device: ${d.relay_pins}`);
          } else {
            console.log(`GPIO change throttled (${now - lastGpioSyncTime}ms)`);
          }
        } else {
          console.log('GPIO unchanged');
        }
      } else {
        log(`Ignoring GPIO update (manual change active)`);
      }
    }

    // 6. Update Active Relay Count (relay_states)
    if (d.relay_states && Array.isArray(d.relay_states)) {
      const activeCount = d.relay_states.filter(state => state === 1 || state === true).length;
      // Gunakan ID yang benar (activeRelay atau activeRelays)
      const activeRelayElement = document.getElementById('activeRelay');
      if (activeRelayElement) {
        activeRelayElement.textContent = `${activeCount} / ${d.relay_count || relayCount}`;
      } else {
        // Fallback jika ID berbeda
        const altElement = document.getElementById('activeRelays');
        if (altElement) altElement.textContent = `${activeCount} / ${d.relay_count || relayCount}`;
      }
      console.log(`Active relays: ${activeCount} / ${d.relay_count || relayCount}`);
      
      // Pastikan jumlah tombol relay sesuai
      const existingButtons = document.querySelectorAll('[id^="btn-relay-"]').length;
      if (existingButtons !== relayCount) {
        console.log(`Button count mismatch: existing ${existingButtons}, expected ${relayCount}. Re-initializing...`);
        initRelayButtons();
      }
      
      // Update internal currentRelayState dan UI tombol relay
      for (let i = 0; i < d.relay_states.length && i < relayCount; i++) {
        if (currentRelayState[i] !== d.relay_states[i]) {
          currentRelayState[i] = d.relay_states[i];
          const btn = $(`btn-relay-${i+1}`);
          if (btn) {
            const isOn = (d.relay_states[i] === 1);
            btn.dataset.state = isOn ? 'on' : 'off';
            const label = getRelayLabel(i+1);
            btn.textContent = isOn ? `${label} ✓` : label;
            btn.className = isOn ? 'btn-success' : 'btn-secondary';
          } else {
            console.warn(`Button for relay ${i+1} not found, re-initializing...`);
            initRelayButtons();
            break;
          }
        }
      }
    } else if (d.relay_count && !d.relay_states) {
      const activeRelayElement = document.getElementById('activeRelay');
      if (activeRelayElement) activeRelayElement.textContent = '--';
      else {
        const altElement = document.getElementById('activeRelays');
        if (altElement) altElement.textContent = '--';
      }
    }

    // 7. Update suggestions
    updateGPIOSuggestions();
    
  } catch (e) {
    console.error('❌ Failed to parse status message:', e, 'Raw msg:', msg);
  }
}

function renderPinBadges(pinStr) { 
  const container = $('relayPinsContainer'); 
  if(!container) return; 
  container.innerHTML = ''; 
  if(!pinStr || pinStr === '--') { 
    container.innerHTML = '<span style="color:#94a3b8;">--</span>'; 
    return; 
  } 
  const pins = pinStr.split(','); 
  pins.forEach(p => { 
    const badge = document.createElement('span'); 
    badge.className = 'pin-badge'; 
    badge.textContent = `GPIO ${p.trim()}`; 
    container.appendChild(badge); 
  }); 
}

function updateGPIOSuggestions() {
  const datalist = $('gpioSuggestions'); if(!datalist) return; datalist.innerHTML = ''; let commonPins = [];
  if(currentHardware.includes('ESP32S2')) commonPins = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
  else if(currentHardware.includes('ESP32C3')) commonPins = [0,1,3,4,5,6,7,10,18,19];
  else if(currentHardware.includes('ESP32')) commonPins = [12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33];
  else if(currentHardware.includes('WEMOS') || currentHardware.includes('ESP8266')) commonPins = [5,4,14,12,13,15];
  commonPins.forEach(p => { const opt = document.createElement('option'); opt.value = p; datalist.appendChild(opt); });
}

function suggestDefaultPins() { let defaultPinsAll = []; if(currentHardware.includes('ESP32S2')) defaultPinsAll = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]; else if(currentHardware.includes('ESP32C3')) defaultPinsAll = [0,1,3,4,5,6,7,10,18,19]; else if(currentHardware.includes('ESP32')) defaultPinsAll = [12,13,14,15,16,17,18,19,21,22,23,25]; else if(currentHardware.includes('WEMOS') || currentHardware.includes('ESP8266')) defaultPinsAll = [5,4,14,12,13,15]; else defaultPinsAll = [12,14,27,26,25]; let pinCount = relayCount; if(pinCount > defaultPinsAll.length) pinCount = defaultPinsAll.length; const suggested = defaultPinsAll.slice(0, pinCount); $('gpioInput').value = suggested.join(','); updateCurrentGpioText(); log(`Suggested GPIO: ${suggested.join(',')}`); }

function setConnectionState(connected) { 
  safeCls($('connCard'), 'hidden', connected); 
  safeCls($('disconnectBtn'), 'hidden', !connected); 
  document.querySelectorAll('.app-card').forEach(c=>safeCls(c,'hidden',!connected)); 
  safeTxt('connStatus', connected?'Status: Connected':'Status: Not configured'); 
  if(connected) { 
    currentRelayState = new Array(relayCount).fill(false);
    const locDiv = document.getElementById('locationInfo');
    if (locDiv) locDiv.style.display = 'flex';
  } else {
    const locDiv = document.getElementById('locationInfo');
    if (locDiv) locDiv.style.display = 'none';
  }
}

function connectMQTT() {
  if (!DEVICE_ID || !mqttBroker) return;
  
  // Perbaikan: jika broker HiveMQ Cloud dan port 8883 (MQTT TCP), ubah ke 8884 (WebSocket)
  let wsPort = mqttPort;
  if (mqttBroker.includes("hivemq.cloud") && wsPort == 8883) {
    wsPort = 8884;
    log("Auto-switched MQTT port to 8884 for WebSocket");
  }
  
  const url = `wss://${mqttBroker}:${wsPort}/mqtt`;
  const clientId = 'web_' + Math.random().toString(16).substr(2,8);
  if (mqttClient && mqttClient.connected) mqttClient.end(true);
  mqttClient = mqtt.connect(url, {clientId, username:mqttUser, password:mqttPass, clean:true, reconnectPeriod:0});
  mqttClient.on('connect', () => { 
    log('MQTT Connected'); 
    setConnectionState(true); 
    // Subscribe hanya ke topik device aktif
    mqttClient.subscribe(`${DEVICE_ID}/relay/+/state`);
    mqttClient.subscribe(`${DEVICE_ID}/status`);
    mqttClient.subscribe(`${DEVICE_ID}/terminal`);
    mqttClient.subscribe(`${DEVICE_ID}/wifi/scan_result`);
    log(`Subscribed to ${DEVICE_ID}/+`);
    // Minta publish status segera
    mqttClient.publish(`${DEVICE_ID}/cmd/state/request`, '1');
    if(ghSyncEnabled) { loadFromGitHub(); loadDeviceConfigFromGitHub(); } 
  });
  mqttClient.on('message', (topic, msg) => { 
    const t = topic.toString();
    const m = msg.toString().trim();
    console.log(`📨 MQTT message: ${t} -> ${m.substring(0, 150)}`);
    
    // Filter eksak berdasarkan topik
    if (t === DEVICE_ID + '/terminal') {
      log(m);
    } 
    else if (t === DEVICE_ID + '/status') {
      // Cek device_id dari payload sebelum memproses
      try {
        const tempJson = JSON.parse(m);
        if (tempJson.device_id && tempJson.device_id !== DEVICE_ID) {
          console.warn(`Ignoring status from wrong device: ${tempJson.device_id} (expected ${DEVICE_ID})`);
          return;
        }
      } catch(e) {
        console.warn('Failed to parse status for device check');
      }
      console.log('✅ Processing status update');
      updateSystemHealth(m);
    }
    else if (t.startsWith(DEVICE_ID + '/relay/') && t.endsWith('/state')) {
      const parts = t.split('/');
      const relayNum = parseInt(parts[2]);
      console.log(`Relay ${relayNum} state: ${m}`);
      updateRelayUI(relayNum, m);
    }
    else if (t === DEVICE_ID + '/wifi/scan_result') {
      console.log('📡 WiFi scan result received');
      handleWifiScanResult(m);
    }
    else {
      console.warn(`Ignoring message from unknown topic: ${t}`);
    }
  });
  mqttClient.on('error', err => { log('MQTT Error'); setConnectionState(false); });
  mqttClient.on('close', () => { log('Disconnected'); setConnectionState(false); });
}

// ==================== RELAY UI ====================
function initRelayButtons() { 
  const box = $('relayBtns'); 
  if(!box) return; 
  box.innerHTML = ''; 
  currentRelayState = new Array(relayCount).fill(false); 
  for(let i=1; i<=relayCount; i++) { 
    const btn = document.createElement('button'); 
    btn.id = `btn-relay-${i}`; 
    btn.className = 'btn-secondary'; 
    btn.dataset.state = 'off'; 
    const label = getRelayLabel(i);
    btn.textContent = label; 
    btn.style.cssText = 'font-size:0.75rem;padding:10px 0'; 
    btn.onclick = (function(relayNum) { 
      return function() { sendRelayCommand(relayNum); vibrate(); }; 
    })(i); 
    btn.type = 'button'; 
    box.appendChild(btn); 
  } 
  updateSchedulerRelaySelect(); 
}

async function sendRelayCommand(num) { 
  console.log(`sendRelayCommand ${num}, DEVICE_ID=${DEVICE_ID}, mqtt connected=${mqttClient?.connected}`);
  if(!mqttClient || !mqttClient.connected) { 
    alert('MQTT not connected! Please wait for connection.');
    return; 
  }
  const btn = $(`btn-relay-${num}`); 
  if(!btn) return; 
  const newState = btn.dataset.state === 'on' ? 0 : 1;
  await pubSecure(`${DEVICE_ID}/relay/${num}/cmd`, { state: newState });
}

function updateRelayUI(num, state) { 
  const btn = $(`btn-relay-${num}`); 
  if(!btn) return; 
  const isOn = (state==='1'||state===1||state===true); 
  const idx = num-1; 
  if (currentRelayState[idx] !== isOn) { 
    currentRelayState[idx] = isOn; 
    const label = getRelayLabel(num);
    sendNotif(`🔌 ${label}`, `${label} turned ${isOn ? 'ON' : 'OFF'}`); 
  } 
  btn.dataset.state = isOn ? 'on' : 'off'; 
  const label = getRelayLabel(num);
  btn.textContent = isOn ? `${label} ✓` : label; 
  btn.className = isOn ? 'btn-success' : 'btn-secondary'; 
}

function updateSchedulerRelaySelect() { 
  const sel = $('schRelay'); 
  if(!sel) return; 
  const cur = sel.value; 
  sel.innerHTML = ''; 
  for(let i=1; i<=relayCount; i++) { 
    const opt = document.createElement('option'); 
    opt.value = i; 
    opt.textContent = getRelayLabel(i); 
    sel.appendChild(opt); 
  } 
  if(cur && cur <= relayCount) sel.value = cur; 
  else sel.value = '1'; 
}

async function applyRelayConfig() {
  if (!DEVICE_ID) { alert('Set Device ID first'); return; }
  const newCount = parseInt($('relayCountInput').value);
  const gpioRaw = $('gpioInput').value.trim();
  if (!validateGpioAndRelayCount(gpioRaw, newCount)) return;
  if (isNaN(newCount) || newCount < 1 || newCount > maxRelayFromDevice) { alert(`Relay count must be between 1 and ${maxRelayFromDevice}`); return; }
  if (mqttClient && mqttClient.connected) { 
    if (newCount !== relayCount) await pubSecure(DEVICE_ID + '/config/relayCount', { count: newCount });
    if (gpioRaw !== (window.lastGpio || '')) await pubSecure(DEVICE_ID + '/gpio/update', { pins: gpioRaw });
  } else { alert('MQTT not connected. Changes saved locally only.'); }
  localStorage.setItem('dm_relay_count', newCount); localStorage.setItem('dm_gpio', gpioRaw); relayCount = newCount; updateRelayUIByCount(); window.lastGpio = gpioRaw; updateCurrentGpioText(); ignoreDeviceUpdatesUntil = Date.now() + IGNORE_DURATION_MS; lastGpioSyncTime = Date.now(); log(`Relay config applied: ${newCount} relays, GPIO: ${gpioRaw}`); alert('Configuration sent. Device will restart if changed.'); if (ghSyncEnabled && ghConfig.token && DEVICE_ID) await saveDeviceConfigToGitHub();
}

// ==================== GITHUB SYNC ====================
function setSyncStatus(online) { 
  ghSyncEnabled = online; 
  const statusEl = $('ghSyncStatus'); 
  if(statusEl) { 
    statusEl.textContent = online ? '● Online' : '● Offline'; 
    statusEl.className = online ? 'sync-status sync-on' : 'sync-status sync-off'; 
  } 
  log(online ? 'GitHub Sync: ONLINE' : 'GitHub Sync: OFFLINE'); 
}

async function loadFromGitHub() { if(!ghSyncEnabled||!ghConfig.token||!DEVICE_ID) return; const path = getSchedulerPath(); if (!path) return; try { const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`; const res = await fetch(url, { headers: { 'Authorization': `token ${ghConfig.token}` } }); if(res.ok) { const data = await res.json(), content = JSON.parse(atob(data.content)); if(content.device === DEVICE_ID && Array.isArray(content.schedules)) { schedules = mergeScheduleArrays(schedules, content.schedules); saveSchedulesLocal(); renderSchedules(); log(`Pull OK (${schedules.length} schedules)`); } } } catch(e) { log('Pull schedules: '+e.message); } }

async function loadDeviceConfigFromGitHub() {
  if (!ghSyncEnabled || !ghConfig.token || !DEVICE_ID) {
    log('GitHub sync not enabled or missing token/device');
    return;
  }
  const path = getDeviceConfigPath();
  if (!path) {
    log('Invalid device config path');
    return;
  }
  try {
    const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`;
    log(`Loading device config from ${url}`);
    const res = await fetch(url, { headers: { 'Authorization': `token ${ghConfig.token}` } });
    if (res.ok) {
      const data = await res.json();
      const config = JSON.parse(atob(data.content));
      if (config.device === DEVICE_ID) {
        let changed = false;
        // Relay count
        if (config.relayCount && config.relayCount !== relayCount) {
          relayCount = Math.min(maxRelayFromDevice, Math.max(1, config.relayCount));
          localStorage.setItem('dm_relay_count', relayCount);
          changed = true;
          log(`Loaded relayCount from GitHub: ${relayCount}`);
        }
        // GPIO pins
        if (config.gpio && config.gpio.length) {
          const gpioStr = config.gpio.join(',');
          const currentGpio = $('gpioInput').value;
          if (gpioStr !== currentGpio) {
            safeVal('gpioInput', gpioStr);
            window.lastGpio = gpioStr;
            updateCurrentGpioText();
            changed = true;
            log(`Loaded GPIO from GitHub: ${gpioStr}`);
          }
        }
        // Relay labels
        if (config.relayLabels && Array.isArray(config.relayLabels)) {
          if (JSON.stringify(relayLabels) !== JSON.stringify(config.relayLabels)) {
            relayLabels = [...config.relayLabels];
            changed = true;
            log(`Loaded ${relayLabels.length} relay labels from GitHub`);
          }
        }
        // Alias
        if (config.alias && config.alias !== currentDeviceAlias) {
          currentDeviceAlias = config.alias;
          const devIndex = devices.findIndex(d => d.deviceId === DEVICE_ID);
          if (devIndex !== -1) {
            devices[devIndex].alias = config.alias;
            saveDevicesToStorage();
          }
          updateAliasDisplay();
          renderDeviceList();
          changed = true;
          log(`Loaded alias from GitHub: ${config.alias}`);
        }
        if (changed) {
          updateRelayUIByCount();
          renderRelayLabelsInputs();
          initRelayButtons();
          updateSchedulerRelaySelect();
          renderSchedules();
          log('Device config applied from GitHub');
        } else {
          log('Device config unchanged from GitHub');
        }
      } else {
        log(`Device ID mismatch: config.device=${config.device}, DEVICE_ID=${DEVICE_ID}`);
      }
    } else if (res.status === 404) {
      log('device.json not found in GitHub, creating default');
      await saveDeviceConfigToGitHub(0, true);
    } else {
      log(`Failed to load device.json: ${res.status}`);
    }
  } catch(e) {
    log(`device.json load error: ${e.message}`);
  }
}

async function saveDeviceConfigToGitHub(retry = 0, forceLabelSave = false) {
  if (!ghSyncEnabled || !ghConfig.token || !DEVICE_ID) return false;
  const path = getDeviceConfigPath();
  if (!path) return false;
  const gpioRaw = $('gpioInput').value.trim();
  const gpioList = gpioRaw.split(',').map(s=>s.trim()).filter(s=>s);
  let labelsToSave = relayLabels;
  if (forceLabelSave) { labelsToSave = collectLabelsFromInputs(); relayLabels = labelsToSave; }
  else { const firstInput = $(`label_relay_1`); if (firstInput) labelsToSave = collectLabelsFromInputs(); }
  const currentAlias = devices.find(d => d.deviceId === DEVICE_ID)?.alias || currentDeviceAlias || DEVICE_ID;
  const deviceConfig = { device: DEVICE_ID, alias: currentAlias, relayCount, gpio: gpioList, relayLabels: labelsToSave, updatedAt: new Date().toISOString() };
  try {
    const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`;
    let sha = null;
    const getRes = await fetch(url, { headers: { 'Authorization': `token ${ghConfig.token}` } });
    if (getRes.ok) { const data = await getRes.json(); sha = data.sha; }
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(deviceConfig, null, 2))));
    const body = { message: `Update device config for ${DEVICE_ID}`, content, branch: 'main' };
    if (sha) body.sha = sha;
    const putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `token ${ghConfig.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (putRes.ok) { log('Device config saved to GitHub'); return true; }
    if (putRes.status === 409 && retry < 2) { log(`Conflict, retrying (${retry+1}/2)...`); await new Promise(r => setTimeout(r, 500)); return saveDeviceConfigToGitHub(retry + 1, forceLabelSave); }
    throw new Error(`HTTP ${putRes.status}`);
  } catch (err) { log(`Save device config error: ${err.message}`); return false; }
}

async function pushToGitHub(retry=0) { if(!ghSyncEnabled||!ghConfig.token||!DEVICE_ID||retry>=3) return; const path = getSchedulerPath(); if (!path) return; try { const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`; let sha = null; const getRes = await fetch(url, { headers: { 'Authorization': `token ${ghConfig.token}` } }); if(getRes.ok) sha = (await getRes.json()).sha; const clean = schedules.map(s=>{ const {_source,...c}=JSON.parse(JSON.stringify(s)); return c; }); const payload = { device: DEVICE_ID, schedules: clean, updatedAt: new Date().toISOString() }; const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload,null,2)))); const body = { message: `Sync @ ${new Date().toLocaleTimeString()}`, content, branch: 'main' }; if(sha) body.sha = sha; const res = await fetch(url, { method:'PUT', headers:{'Authorization':`token ${ghConfig.token}`,'Content-Type':'application/json'}, body: JSON.stringify(body) }); if(res.ok) { log('Schedules saved to GitHub'); return; } if(res.status===409||res.status===422) { log(`Conflict #${retry+1}`); return await pushToGitHub(retry+1); } } catch(e) { log('Push schedules: '+e.message); } }

// ==================== SCHEDULER ====================
function initScheduler() { document.querySelectorAll('.day-btn').forEach(btn=>{ btn.onclick=function(){ this.classList.toggle('active'); vibrate(); }; }); renderSchedules(); startSchedulerEngine(); }
function addSchedule() { if (!DEVICE_ID) { alert('Set Device ID first'); return; } vibrate(); const time = $('schTime').value, relay = $('schRelay').value, action = $('schAction').value; const activeDays = Array.from(document.querySelectorAll('.day-btn.active')).map(b=>parseInt(b.dataset.day)); if(!time||activeDays.length===0) return alert('Time & active days required!'); const newSch = { id: Date.now().toString(36)+Math.random().toString(36).substr(2,4), time, relay, action, days: activeDays, enabled: true, _modified: new Date().toISOString() }; schedules.push(newSch); saveSchedules(); renderSchedules(); log(`Schedule: ${getRelayLabel(relay)} ${action=='1'?'ON':'OFF'} @ ${time}`); }
function toggleSchedule(id) { const sch = schedules.find(s=>s.id===id); if(sch){ sch.enabled=!sch.enabled; sch._modified=new Date().toISOString(); saveSchedules(); renderSchedules(); } }
function deleteSchedule(id) { if(confirm('Delete schedule?')){ schedules=schedules.filter(s=>s.id!==id); saveSchedules(); renderSchedules(); } }
function mergeScheduleArrays(localArr, serverArr) { const map = new Map(); (serverArr||[]).forEach(s=>{ const clean=JSON.parse(JSON.stringify(s)); delete clean._source; map.set(clean.id,clean); }); (localArr||[]).forEach(s=>{ const existing=map.get(s.id); const isNewer = s._modified && (!existing?._modified || s._modified > existing._modified); if(!existing||isNewer){ const clean=JSON.parse(JSON.stringify(s)); delete clean._source; map.set(s.id,clean); } }); return Array.from(map.values()).sort((a,b)=>a.time.localeCompare(b.time)); }
function saveSchedules() { localStorage.setItem('dm_schedules', JSON.stringify(schedules)); if(ghSyncEnabled && navigator.onLine && ghConfig.token && DEVICE_ID) { clearTimeout(ghSyncTimeout); ghSyncTimeout = setTimeout(()=>pushToGitHub(), 1000+Math.random()*150); } }
function saveSchedulesLocal() { localStorage.setItem('dm_schedules', JSON.stringify(schedules)); }
function renderSchedules() { 
  const list = $('scheduleList'); 
  if(!list) return; 
  list.innerHTML = ''; 
  if(schedules.length===0) { list.innerHTML='<p style="color:#64748b;text-align:center;font-size:0.75rem;">No schedules yet.</p>'; return; } 
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; 
  schedules.forEach(sch=>{ 
    const daysStr = sch.days.map(d=>dayNames[d]).join(', '); 
    const relayLabel = getRelayLabel(parseInt(sch.relay));
    const div = document.createElement('div'); 
    div.className='schedule-item'; 
    div.innerHTML = `<div class="sch-info"><span class="sch-time">🕐 ${sch.time}</span><span>${relayLabel} → ${sch.action=='1'?'ON':'OFF'}</span><br><span style="font-size:0.65rem;">📅 ${daysStr}</span></div><div class="sch-actions"><div class="toggle-switch ${sch.enabled?'active':''}" onclick="toggleSchedule('${sch.id}')"></div><button class="btn-sm btn-del" onclick="deleteSchedule('${sch.id}')">🗑️</button></div>`; 
    list.appendChild(div); 
  }); 
}
function startSchedulerEngine() { if(schedulerInterval) clearInterval(schedulerInterval); schedulerInterval = setInterval(checkSchedules, 30000); log('Scheduler running'); }
function checkSchedules() { if (!DEVICE_ID) return; const now = new Date(), curTime = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`, curDay = now.getDay(), dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`; schedules.forEach(sch=>{ if(!sch.enabled || sch.time!==curTime || !sch.days.includes(curDay)) return; const key = `${sch.id}_${dateKey}`; if(lastTriggered[sch.id]===key) return; lastTriggered[sch.id]=key; if(mqttClient && mqttClient.connected) { pub(`${DEVICE_ID}/relay/${sch.relay}/cmd`, sch.action); log(`[AUTO] ${getRelayLabel(sch.relay)} ${sch.action=='1'?'ON':'OFF'} @ ${curTime}`); sendNotif(`⏰ Auto: ${getRelayLabel(sch.relay)} ${sch.action=='1'?'ON':'OFF'}`,`Schedule ${curTime}`); } }); }

// ==================== NOTIFICATIONS ====================
function saveNotifConfig() { notifConfig = { tg: { token: notifConfig.tg?.token, chatId: notifConfig.tg?.chatId, enabled: tgEnabled, connected: tgConnected } }; localStorage.setItem('dm_notif_config', JSON.stringify(notifConfig)); if(ghSyncEnabled) pushToGitHub(); }
function updateTgUI() { const b=$('tgStatusBadge'),c=$('tgConfig'),d=$('tgConnected'); if(!tgEnabled){ b.textContent='Inactive'; b.className='notif-status status-inactive'; c.classList.add('hidden'); d.classList.add('hidden'); } else if(tgConnected && notifConfig.tg?.token && notifConfig.tg?.chatId){ b.textContent='● Active'; b.className='notif-status status-active'; c.classList.add('hidden'); d.classList.remove('hidden'); } else { b.textContent='⚙️ Config'; b.className='notif-status status-inactive'; c.classList.remove('hidden'); d.classList.add('hidden'); } }
function initNotifUI() {
  const tg = notifConfig.tg||{}; if(tg.token && tg.chatId){ safeVal('tgToken','••••••••'); safeVal('tgChatId',tg.chatId); safeTxt('tgChatDisplay',tg.chatId); tgConnected = tg.connected || false; }
  safeCls($('tgToggle'),'active',tgEnabled); updateTgUI();
  $('tgToggle').onclick = function(){ tgEnabled=!tgEnabled; this.classList.toggle('active',tgEnabled); updateTgUI(); saveNotifConfig(); log(`Telegram: ${tgEnabled?'ON':'OFF'}`); vibrate(); };
}
function editTelegramConfig() { const tgConfigDiv = $('tgConfig'); const tgConnectedDiv = $('tgConnected'); if (tgConfigDiv) tgConfigDiv.classList.remove('hidden'); if (tgConnectedDiv) tgConnectedDiv.classList.add('hidden'); safeVal('tgToken', notifConfig.tg?.token && notifConfig.tg.token !== '••••••••' ? notifConfig.tg.token : ''); safeVal('tgChatId', notifConfig.tg?.chatId || ''); const badge = $('tgStatusBadge'); if (badge) { badge.textContent = '⚙️ Editing'; badge.className = 'notif-status status-inactive'; } }
function saveTelegramConfig() { vibrate(); let token = $('tgToken').value.trim(); let chatId = $('tgChatId').value.trim(); if(!token) return alert('Bot Token required!'); if(!chatId) return alert('Chat ID required!'); notifConfig.tg = { token, chatId, enabled: tgEnabled, connected: false }; saveNotifConfig(); safeVal('tgToken','••••••••'); safeTxt('tgChatDisplay', chatId); updateTgUI(); alert('Telegram config saved'); }
async function testTelegram() { if (!notifConfig.tg?.token || !notifConfig.tg?.chatId) { alert('Save Telegram config first'); return; } try { const response = await fetch(`https://api.telegram.org/bot${notifConfig.tg.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: notifConfig.tg.chatId, text: `<b>✅ dMarch Test</b>\nDevice: ${DEVICE_ID}\nTime: ${new Date().toLocaleString()}`, parse_mode: 'HTML' }) }); const result = await response.json(); if (response.ok && result.ok) { tgConnected = true; notifConfig.tg.connected = true; saveNotifConfig(); updateTgUI(); log('Telegram test OK'); alert('Test message sent!'); } else throw new Error(result.description); } catch (e) { tgConnected = false; notifConfig.tg.connected = false; saveNotifConfig(); updateTgUI(); log(`Telegram test failed: ${e.message}`); alert(`Test failed: ${e.message}`); } }
async function fetchChatId() { const token = $('tgToken').value.trim(); if(!token) return alert('Enter Bot Token first'); try { const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`); const data = await res.json(); if(data.ok && data.result && data.result[0] && data.result[0].message && data.result[0].message.chat && data.result[0].message.chat.id) { safeVal('tgChatId', data.result[0].message.chat.id); alert('Chat ID found!'); } else alert('Send a message to the bot first, then try again.'); } catch(e) { alert('Failed to fetch Chat ID'); } }
async function sendNotif(title, message) { const timestamp = new Date().toLocaleString('en-US'); const fullMsg = `<b>${title}</b>\n${message}\n\n<i>Device: ${DEVICE_ID}</i>\n<i>Time: ${timestamp}</i>`; if (tgEnabled && tgConnected && notifConfig.tg?.token && notifConfig.tg?.chatId) { try { await fetch(`https://api.telegram.org/bot${notifConfig.tg.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: notifConfig.tg.chatId, text: fullMsg, parse_mode: 'HTML', disable_web_page_preview: true }) }); } catch(e) { log(`Telegram send error: ${e.message}`); } } }

// ==================== LABELS UI ====================
function renderRelayLabelsInputs() {
  const container = $('relayLabelsContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!relayCount) return;
  while (relayLabels.length < relayCount) relayLabels.push(`Relay ${relayLabels.length+1}`);
  while (relayLabels.length > relayCount) relayLabels.pop();
  for (let i = 0; i < relayCount; i++) {
    const div = document.createElement('div');
    div.className = 'label-input-group';
    div.innerHTML = `<span style="font-size:0.75rem;">Relay ${i+1}:</span><input type="text" id="label_relay_${i+1}" value="${escapeHtml(relayLabels[i])}" placeholder="Enter label" style="font-size:0.8rem;">`;
    container.appendChild(div);
  }
}
function escapeHtml(str) { return str.replace(/[&<>]/g, function(m){if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }
function collectLabelsFromInputs() {
  const labels = [];
  for (let i = 1; i <= relayCount; i++) {
    const input = $(`label_relay_${i}`);
    if (input) labels.push(input.value.trim() || `Relay ${i}`);
    else labels.push(`Relay ${i}`);
  }
  return labels;
}
async function saveRelayLabelsToGitHub() {
  if (!ghSyncEnabled || !ghConfig.token || !DEVICE_ID) { alert('GitHub sync not enabled.'); return; }
  const newLabels = collectLabelsFromInputs();
  relayLabels = newLabels;
  const success = await saveDeviceConfigToGitHub(0, true);
  if (success) { log('Relay labels saved to GitHub'); initRelayButtons(); updateSchedulerRelaySelect(); renderSchedules(); alert('Labels saved successfully'); }
  else alert('Failed to save labels.');
}

// ==================== QR PROCESSING & MODAL ====================
function openQR() {
  const modal = document.getElementById('qrModal');
  if (modal) modal.style.display = 'flex';
  const readerDiv = document.getElementById('reader');
  if (readerDiv) readerDiv.innerHTML = '';
}
function closeQR() {
  const modal = document.getElementById('qrModal');
  if (modal) modal.style.display = 'none';
  if (qrScanner && typeof qrScanner.stop === 'function') {
    qrScanner.stop().catch(()=>{});
    qrScanner.clear();
    qrScanner = null;
  }
}
window.closeQR = closeQR;

function onQRSuccess(decodedText) {
  addDeviceFromQR(decodedText);
  closeQR();
}

function initQRScanner() {
  const startCameraBtn = document.getElementById('startCameraBtn');
  if (startCameraBtn) {
    startCameraBtn.onclick = async function() {
      if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        alert("🚨 Akses Kamera Ditolak: Browser HP hanya mengizinkan kamera pada koneksi HTTPS (Secure Context).");
        return;
      }
      if (qrScanner) {
        try { await qrScanner.stop(); } catch(e) { console.warn("Scanner stop error:", e); }
        qrScanner.clear();
      }
      const readerDiv = document.getElementById('reader');
      if (readerDiv) readerDiv.innerHTML = '';
      qrScanner = new Html5Qrcode("reader");
      const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
      qrScanner.start({ facingMode: "environment" }, config, onQRSuccess, (errorMessage) => {})
        .catch(err => {
          console.error("Camera Start Error:", err);
          if (err.includes("NotAllowedError") || err.includes("Permission")) {
            alert("❌ Izin Kamera Ditolak. Silakan cek pengaturan privasi browser Anda dan izinkan akses kamera.");
          } else {
            alert("❌ Gagal mengakses kamera: " + err);
          }
        });
    };
  }
  const qrFileInput = document.getElementById('qrFileInput');
  if (qrFileInput) {
    qrFileInput.onchange = async function(e) {
      const file = e.target.files[0];
      if (!file) return;
      if (qrScanner) {
        try { await qrScanner.stop(); } catch(e) {}
        qrScanner.clear();
        qrScanner = null;
      }
      const readerDiv = document.getElementById('reader');
      if (readerDiv) readerDiv.innerHTML = '<p style="text-align:center; padding:20px;">Memproses gambar...</p>';
      try {
        const tempScanner = new Html5Qrcode("reader");
        const decodedText = await tempScanner.scanFile(file, true);
        onQRSuccess(decodedText);
        tempScanner.clear();
        qrFileInput.value = '';
        if (readerDiv) readerDiv.innerHTML = '';
      } catch(err) {
        console.error("QR Scan File Error:", err);
        alert('❌ Gagal membaca QR: Foto terlalu buram atau file terlalu besar. Coba gunakan hasil Screenshot yang lebih tajam.');
        if (readerDiv) readerDiv.innerHTML = '';
        qrFileInput.value = '';
      }
    };
  }
}

// ==================== WIFI SCAN HANDLER ====================
function handleWifiScanResult(data) {
  const scanResultDiv = document.getElementById('wifiScanResult');
  if (!scanResultDiv) return;
  log('📡 Processing WiFi scan result...');
  try {
    let networks;
    if (typeof data === 'string') {
      networks = JSON.parse(data);
    } else {
      networks = data;
    }
    if (!Array.isArray(networks)) throw new Error('Invalid format');
    if (networks.length === 0) {
      scanResultDiv.innerHTML = '<div class="scan-status">📡 No WiFi networks found</div>';
      scanResultDiv.style.display = 'block';
      return;
    }
    let html = '';
    networks.forEach((net) => {
      const ssid = net.ssid || 'Hidden Network';
      const rssi = net.rssi || 0;
      let signalIcon = '📶';
      let signalBars = '';
      if (rssi > -50) signalBars = '████';
      else if (rssi > -60) signalBars = '███▌';
      else if (rssi > -70) signalBars = '██▌';
      else if (rssi > -80) signalBars = '█▌';
      else signalBars = '▌';
      html += `<div class="wifi-scan-item" data-ssid="${escapeHtml(ssid)}">
        <span class="wifi-name">${escapeHtml(ssid)}</span>
        <span class="wifi-signal">${signalIcon} ${rssi} dBm ${signalBars}</span>
      </div>`;
    });
    scanResultDiv.innerHTML = html;
    scanResultDiv.style.display = 'block';
    document.querySelectorAll('.wifi-scan-item').forEach(item => {
      item.addEventListener('click', () => {
        const ssid = item.getAttribute('data-ssid');
        if (ssid) {
          document.getElementById('netSsid').value = ssid;
          const savedPass = localStorage.getItem(`wifi_pass_${ssid}`);
          if (savedPass) {
            document.getElementById('netPass').value = savedPass;
            log(`🔐 Auto-filled password for "${ssid}" from saved credentials`);
          } else {
            document.getElementById('netPass').value = '';
          }
          scanResultDiv.style.display = 'none';
          vibrate();
        }
      });
    });
  } catch(e) {
    log(`❌ WiFi scan result error: ${e.message}`);
    scanResultDiv.innerHTML = '<div class="scan-status">❌ Failed to parse scan result</div>';
    scanResultDiv.style.display = 'block';
  }
}

function scanWifi() {
  if (!mqttClient || !mqttClient.connected) {
    alert('MQTT not connected.');
    return;
  }
  const scanDiv = document.getElementById('wifiScanResult');
  scanDiv.innerHTML = '<div class="scan-status scan-loading">⏳ Scanning... (max 20 detik)</div>';
  scanDiv.style.display = 'block';
  const topic = `${DEVICE_ID}/wifi/scan`;
  mqttClient.publish(topic, '1');
  log(`📡 Scan request sent to ${topic}`);
  if (window.scanTimeout) clearTimeout(window.scanTimeout);
  window.scanTimeout = setTimeout(() => {
    if (scanDiv.innerHTML.includes('Scanning...')) {
      scanDiv.innerHTML = '<div class="scan-status">⚠️ Timeout - no response. Check MQTT connection.</div>';
      log('⚠️ WiFi scan timeout');
    }
  }, 20000);
}

function saveWifiPassword() {
  const ssid = document.getElementById('netSsid').value.trim();
  const pass = document.getElementById('netPass').value;
  if (ssid && pass) {
    localStorage.setItem(`wifi_pass_${ssid}`, pass);
    log(`💾 WiFi password for "${ssid}" saved locally`);
  }
}

// ==================== DROPDOWN HANDLER ====================
function initDropdown() {
  const selected = document.getElementById('dropdownSelected');
  const menu = document.getElementById('dropdownMenu');
  const items = document.querySelectorAll('.dropdown-item');
  const selectedLabel = document.getElementById('selectedLabel');
  const panels = document.querySelectorAll('.settings-panel');
  
  function switchPanel(panelId, itemElement) {
    panels.forEach(panel => panel.classList.remove('active'));
    document.getElementById(panelId).classList.add('active');
    const icon = itemElement.querySelector('.item-icon').innerHTML;
    const label = itemElement.querySelector('.item-label').innerHTML;
    selectedLabel.innerHTML = label;
    selected.querySelector('span:first-child').innerHTML = `<span class="item-icon">${icon}</span> <span>${label}</span>`;
    items.forEach(i => i.classList.remove('active'));
    itemElement.classList.add('active');
  }
  
  items.forEach(item => {
    item.addEventListener('click', () => {
      const panelId = item.getAttribute('data-panel');
      switchPanel(panelId, item);
      menu.classList.remove('show');
      selected.classList.remove('open');
    });
  });
  
  selected.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('show');
    selected.classList.toggle('open');
  });
  
  document.addEventListener('click', (e) => {
    if (!selected.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('show');
      selected.classList.remove('open');
    }
  });
}

// ==================== PWA INSTALL ====================
function initPwaInstall() {
  const installContainer = document.getElementById('pwaInstallContainer');
  const installBtn = document.getElementById('installPwaBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installContainer) installContainer.style.display = 'block';
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') if (installContainer) installContainer.style.display = 'none';
        deferredPrompt = null;
      } else alert('Tap menu and select "Install app"');
    });
  }
}

// ==================== ACCORDION ====================
function initAccordion() {
  document.querySelectorAll('.card.collapsible').forEach(card => {
    const header = card.querySelector('.card-header');
    const btn = card.querySelector('.toggle-btn');
    if (!header) return;
    header.addEventListener('click', (e) => {
      e.stopPropagation(); vibrate();
      if (card.classList.contains('collapsed')) {
        document.querySelectorAll('.card.collapsible').forEach(c => c.classList.add('collapsed'));
        card.classList.remove('collapsed');
      } else { card.classList.add('collapsed'); }
    });
  });
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initAccordion();
  initLocationInfo();
  initPwaInstall();
  initDropdown();
  initQRScanner();
  initNotifUI();
  initScheduler();
  
  $('refreshWhitelistBtn').onclick = () => refreshWhitelist();
  $('showQrBtn').onclick = () => openQR();
  const modal = document.getElementById('qrModal');
  if (modal) modal.onclick = function(e) { if (e.target === this) closeQR(); };
  
  $('disconnectBtn').onclick = () => { if(mqttClient) mqttClient.end(true); };
  $('allOnBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(DEVICE_ID+'/all/on', { state: 1 }); };
  $('allOffBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(DEVICE_ID+'/all/off', { state: 1 }); };
  $('saveNTPBtn').onclick = () => { if(DEVICE_ID) { pub(DEVICE_ID+'/ntp/set', $('ntpSelect').value); pub(DEVICE_ID+'/timezone/set', $('tzInput').value); } };
  $('applyRelayConfigBtn').onclick = () => { applyRelayConfig(); };
  $('suggestDefaultPinsBtn').onclick = () => suggestDefaultPins();
  
  const scanBtn = document.getElementById('scanWifiBtn');
  if (scanBtn) scanBtn.onclick = () => scanWifi();
  
  const updateNetBtn = document.getElementById('updateNetBtn');
  if (updateNetBtn) {
    updateNetBtn.onclick = async () => {
      const ssid = document.getElementById('netSsid').value.trim();
      if (!ssid) return alert('SSID required!');
      if (DEVICE_ID) {
        saveWifiPassword();
        await pubSecure(DEVICE_ID + '/network/update', { ssid, pass: document.getElementById('netPass').value.trim() });
        alert('Command sent.');
      }
    };
  }
  
  const resetNetBtn = document.getElementById('resetNetBtn');
  if (resetNetBtn) resetNetBtn.onclick = async () => { if(confirm('Reset WiFi to AP mode?')) if(DEVICE_ID) await pubSecure(DEVICE_ID+'/network/reset', { cmd: 1 }); };
  
  $('otaBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(DEVICE_ID+'/system/ota', { cmd: 1 }); };
  $('restartBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(DEVICE_ID+'/system/restart', { cmd: 1 }); };
  const forceApBtn = document.getElementById('forceApBtn');
  if (forceApBtn) {
    forceApBtn.onclick = async () => {
      if (!DEVICE_ID) {
        alert('No active device');
        return;
      }
      if (confirm('⚠️ Force SoftAP mode will disconnect device from current WiFi and restart. You will need to reconnect to device\'s AP (dMarch-Pro-Config) for setup. Continue?')) {
        mqttClient.publish(DEVICE_ID + '/force_ap', '1');
        alert('Command sent. Device will restart in AP mode shortly.');
      }
    };
  }
  $('clearLogBtn').onclick = () => { const t=$('terminal'); if(t) t.innerHTML=''; };
  $('saveLabelsBtn').onclick = () => { saveRelayLabelsToGitHub(); };
  $('addScheduleBtn').onclick = () => addSchedule();
  $('saveTelegramBtn').onclick = () => saveTelegramConfig();
  $('testTelegramBtn').onclick = () => testTelegram();
  $('fetchChatIdBtn').onclick = () => fetchChatId();
  $('editTelegramBtn').onclick = () => editTelegramConfig();
  $('testTelegramConnectedBtn').onclick = () => testTelegram();
  
  loadDevicesFromStorage();
  if (devices.length === 0) {
    const oldConfig = localStorage.getItem('dm_full_config');
    if (oldConfig) {
      try {
        const cfg = JSON.parse(oldConfig);
        if (cfg.device && cfg.broker) {
          const oldDevice = {
            deviceId: cfg.device,
            alias: cfg.device,
            mqttBroker: cfg.broker,
            mqttPort: cfg.port,
            mqttUser: cfg.user,
            mqttPass: cfg.pass,
            ghOwner: cfg.ghOwner,
            ghRepo: cfg.ghRepo,
            ghBasePath: cfg.ghBasePath || 'RELAY/data',
            ghToken: cfg.ghToken,
            secret: ''
          };
          devices.push(oldDevice);
          currentDeviceId = oldDevice.deviceId;
          saveDevicesToStorage();
          renderDeviceList();
          alert('Old device detected without secret. Please re-pair by scanning QR from SoftAP to enable secure commands.');
        }
      } catch(e) {}
    }
  } else if (currentDeviceId) {
    switchDevice(currentDeviceId);
  } else if (devices.length > 0) {
    switchDevice(devices[0].deviceId);
  }
  document.getElementById('addDeviceBtn').onclick = () => openQR();
  
  if (devices.length === 0 && !DEVICE_ID) {
    $('connCard').classList.remove('hidden');
    document.querySelectorAll('.app-card').forEach(c => c.classList.add('hidden'));
  }
  
  const gpioInputElem = $('gpioInput');
  if (gpioInputElem) gpioInputElem.addEventListener('input', updateCurrentGpioText);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').then(reg => console.log('SW registered')).catch(err => console.log('SW failed')); });
}