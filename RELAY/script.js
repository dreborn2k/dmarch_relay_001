// ==================== GLOBALS ====================
const WORKER_URL = "https://dmarchff.dreborn2k.workers.dev";

let mqttClient = null, qrScanner = null;
let schedules = JSON.parse(localStorage.getItem('dm_schedules') || '[]');
let schedulerInterval = null, lastTriggered = {};
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
let devices = [];
let currentDeviceId = null;

const $ = id => document.getElementById(id);
const safeVal = (id, val) => { const el = $(id); if(el) el.value = val; };
const safeTxt = (id, txt) => { const el = $(id); if(el) el.textContent = txt; };
const safeCls = (el, cls, add) => { if(el) el.classList.toggle(cls, add); };
const log = msg => { const t = $('terminal'); if(t) t.innerHTML = '['+new Date().toLocaleTimeString()+'] '+msg+'\n'+t.innerHTML; };
function debugLog(...args) { console.log(...args); }
function vibrate() { if (window.navigator?.vibrate) window.navigator.vibrate(20); }

function getRelayLabel(relayNum) {
  if (relayLabels && relayLabels.length >= relayNum && relayLabels[relayNum-1]?.trim()) return relayLabels[relayNum-1];
  return `Relay ${relayNum}`;
}

function updateAliasDisplay() {
  const titleSpan = document.getElementById('healthCardTitle');
  if (titleSpan) {
    const displayName = currentDeviceAlias && currentDeviceAlias.trim() !== "" ? currentDeviceAlias : DEVICE_ID;
    titleSpan.innerHTML = `📊 System Health of ${displayName}`;
  }
}

// ==================== HMAC & SECURE PUBLISH ====================
function generateNonce() { return Math.random().toString(36).substring(2, 15) + Date.now().toString(36); }
function getTimestamp() { return Math.floor(Date.now() / 1000); }
async function hmacSha256(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pubSecure(topic, payloadObj) {
  const device = devices.find(d => d.deviceId === DEVICE_ID);
  if (!device || !device.secret) return false;
  const nonce = generateNonce();
  const timestamp = getTimestamp();
  const fullPayloadObj = { ...payloadObj, nonce, timestamp };
  const payloadStr = JSON.stringify(fullPayloadObj);
  const sig = await hmacSha256(payloadStr, device.secret);
  return new Promise((resolve) => {
    mqttClient.publish(topic, JSON.stringify({ ...fullPayloadObj, sig }), { qos: 1 }, (err) => resolve(!err));
  });
}

// ==================== DEVICE API ====================
async function loadDeviceConfigFromWorker(deviceId) {
  try {
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/device.json`);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = await res.json();
    if (config.device === deviceId) {
      if (config.relayCount && config.relayCount !== relayCount) {
        relayCount = Math.min(maxRelayFromDevice, Math.max(1, config.relayCount));
        localStorage.setItem('dm_relay_count', relayCount);
        updateRelayUIByCount();
      }
      if (config.gpio && config.gpio.length) {
        const gpioStr = config.gpio.join(',');
        if (gpioStr !== $('gpioInput')?.value) safeVal('gpioInput', gpioStr);
        updateCurrentGpioText();
      }
      if (config.relayLabels && Array.isArray(config.relayLabels)) {
        relayLabels = [...config.relayLabels];
        renderRelayLabelsInputs();
        initRelayButtons();
      }
      if (config.alias && config.alias !== currentDeviceAlias) {
        currentDeviceAlias = config.alias;
        const idx = devices.findIndex(d => d.deviceId === deviceId);
        if (idx !== -1) devices[idx].alias = config.alias;
        saveDevicesToStorage();
        updateAliasDisplay();
        renderDeviceList();
      }
      updateSchedulerRelaySelect();
      renderSchedules();
      return true;
    }
  } catch(e) { debugLog(e); }
  return false;
}
async function saveDeviceConfigToWorker(deviceId, config) {
  try {
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/device.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config)
    });
    return res.ok;
  } catch(e) { return false; }
}
async function loadSchedulerFromWorker(deviceId) {
  try {
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/scheduler.json`);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.device === deviceId && Array.isArray(data.schedules)) {
      schedules = mergeScheduleArrays(schedules, data.schedules);
      saveSchedulesLocal();
      renderSchedules();
      return true;
    }
  } catch(e) { debugLog(e); }
  return false;
}
async function saveSchedulerToWorker(deviceId) {
  try {
    const payload = { device: deviceId, schedules: schedules.map(s => { const {_source,...rest}=s; return rest; }), updatedAt: new Date().toISOString() };
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/scheduler.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    return res.ok;
  } catch(e) { return false; }
}

// ==================== DEVICE MANAGER ====================
function loadDevicesFromStorage() {
  const stored = localStorage.getItem('dm_devices');
  if (stored) {
    try {
      devices = JSON.parse(stored);
      devices = devices.map(({ ghToken, ghOwner, ghRepo, ghBasePath, ...rest }) => rest);
    } catch(e) { devices = []; }
  }
  currentDeviceId = localStorage.getItem('dm_current_device_id');
  if (!currentDeviceId && devices.length) currentDeviceId = devices[0].deviceId;
  renderDeviceList();
}
function saveDevicesToStorage() {
  localStorage.setItem('dm_devices', JSON.stringify(devices));
  if (currentDeviceId) localStorage.setItem('dm_current_device_id', currentDeviceId);
}
async function updateDeviceAliasInWorker(deviceId, newAlias) {
  const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/device.json`);
  if (!res.ok) return false;
  let config = await res.json();
  config.alias = newAlias;
  config.updatedAt = new Date().toISOString();
  const ok = await saveDeviceConfigToWorker(deviceId, config);
  if (ok) {
    const device = devices.find(d => d.deviceId === deviceId);
    if (device) device.alias = newAlias;
    saveDevicesToStorage();
    renderDeviceList();
    if (deviceId === currentDeviceId) {
      currentDeviceAlias = newAlias;
      updateAliasDisplay();
    }
  }
  return ok;
}
function renderDeviceList() {
  const container = document.getElementById('deviceListContainer');
  if (!container) return;
  if (!devices.length) {
    container.innerHTML = '<p>No devices added. Click "Add Device" to start.</p>';
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
            <input type="text" class="device-alias-input" data-id="${dev.deviceId}" value="${escapeHtml(dev.alias || dev.deviceId)}" style="font-weight:bold;">
            <div style="font-size:0.7rem;">ID: ${dev.deviceId}</div>
          </div>
          <div style="display:flex; gap:6px;">
            ${!isActive ? `<button class="btn-sm btn-primary switch-device-btn" data-id="${dev.deviceId}">Switch</button>` : '<span class="sync-status sync-on">Active</span>'}
            <button class="btn-sm btn-danger delete-device-btn" data-id="${dev.deviceId}" ${devices.length === 1 ? 'disabled' : ''}>🗑️</button>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  document.getElementById('activeDeviceName').innerText = devices.find(d => d.deviceId === currentDeviceId)?.alias || currentDeviceId;
  document.querySelectorAll('.device-alias-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const id = input.getAttribute('data-id');
      const newAlias = input.value.trim();
      if (newAlias && newAlias !== devices.find(d => d.deviceId === id)?.alias) await updateDeviceAliasInWorker(id, newAlias);
      else if (!newAlias) input.value = devices.find(d => d.deviceId === id)?.alias || id;
    });
  });
  document.querySelectorAll('.switch-device-btn').forEach(btn => {
    btn.addEventListener('click', () => switchDevice(btn.getAttribute('data-id')));
  });
  document.querySelectorAll('.delete-device-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (devices.length === 1) return alert('Cannot delete the only device.');
      if (confirm(`Delete device "${id}"?`)) deleteDevice(id);
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
}
async function addDeviceFromQR(data) {
  try {
    let jsonData = JSON.parse(data);
    if (!jsonData.broker || !jsonData.port || !jsonData.user || !jsonData.pass || !jsonData.device) throw new Error('Missing MQTT fields');
    if (!jsonData.workerUrl) throw new Error('Missing workerUrl');
    if (!jsonData.secret) throw new Error('Missing secret');
    let deviceRaw = jsonData.device;
    if (!deviceRaw.startsWith('DmarchFF_')) deviceRaw = 'DmarchFF_' + deviceRaw;
    const deviceId = deviceRaw;
    const whitelistRes = await fetch(`${WORKER_URL}/RELAY/api/whitelist`);
    if (whitelistRes.ok) {
      const whitelist = await whitelistRes.json();
      if (!whitelist.includes(deviceId)) { alert(`Device ${deviceId} not whitelisted.`); return; }
    } else { alert('Cannot verify whitelist'); return; }
    if (devices.find(d => d.deviceId === deviceId)) {
      if (confirm(`Device ${deviceId} exists. Switch?`)) switchDevice(deviceId);
      return;
    }
    devices.push({
      deviceId, alias: deviceId, mqttBroker: jsonData.broker, mqttPort: jsonData.port,
      mqttUser: jsonData.user, mqttPass: jsonData.pass, workerUrl: jsonData.workerUrl, secret: jsonData.secret
    });
    saveDevicesToStorage();
    renderDeviceList();
    if (confirm(`Device ${deviceId} added. Switch now?`)) switchDevice(deviceId);
  } catch(e) { alert('Invalid QR: ' + e.message); }
}
async function switchDevice(deviceId) {
  const device = devices.find(d => d.deviceId === deviceId);
  if (!device) return;
  if (mqttClient?.connected) {
    mqttClient.unsubscribe(`${DEVICE_ID}/relay/+/state`);
    mqttClient.unsubscribe(`${DEVICE_ID}/status`);
    mqttClient.unsubscribe(`${DEVICE_ID}/terminal`);
    mqttClient.end(true);
  }
  DEVICE_ID = device.deviceId;
  mqttBroker = device.mqttBroker;
  mqttPort = device.mqttPort;
  mqttUser = device.mqttUser;
  mqttPass = device.mqttPass;
  currentDeviceId = deviceId;
  currentDeviceAlias = device.alias || deviceId;
  localStorage.setItem('dm_full_config', JSON.stringify({ broker: mqttBroker, port: mqttPort, user: mqttUser, pass: mqttPass, device: DEVICE_ID }));
  saveDevicesToStorage();
  updateAliasDisplay();
  renderDeviceList();
  await loadDeviceConfigFromWorker(DEVICE_ID);
  await loadSchedulerFromWorker(DEVICE_ID);
  updateRelayUIByCount();
  connectMQTT();
}

// ==================== MQTT ====================
function updateSystemHealth(msg) {
  try {
    const d = JSON.parse(msg);
    if (d.device_id !== DEVICE_ID) return;
    if (d.relay_count !== undefined && d.relay_count !== relayCount) {
      relayCount = d.relay_count;
      localStorage.setItem('dm_relay_count', relayCount);
      updateRelayUIByCount();
    }
    safeTxt('sigVal', (d.rssi ?? '--') + '%');
    safeTxt('upVal', d.uptime ?? '--');
    safeTxt('tempVal', (d.temp ?? '--') + '°C');
    safeTxt('fwVal', d.fw_version ?? '--');
    safeTxt('hwType', d.hw_type ?? '--');
    if (d.max_relay) safeTxt('maxRelay', d.max_relay);
    if (d.relay_pins) renderPinBadges(d.relay_pins);
    if (d.relay_states && Array.isArray(d.relay_states)) {
      const activeCount = d.relay_states.filter(s => s === 1).length;
      const activeRelayEl = document.getElementById('activeRelay');
      if (activeRelayEl) activeRelayEl.textContent = `${activeCount} / ${d.relay_count || relayCount}`;
      for (let i=0; i<d.relay_states.length && i<relayCount; i++) {
        if (currentRelayState[i] !== d.relay_states[i]) {
          currentRelayState[i] = d.relay_states[i];
          const btn = $(`btn-relay-${i+1}`);
          if (btn) {
            const isOn = d.relay_states[i] === 1;
            btn.dataset.state = isOn ? 'on' : 'off';
            btn.textContent = isOn ? `${getRelayLabel(i+1)} ✓` : getRelayLabel(i+1);
            btn.className = isOn ? 'btn-success' : 'btn-secondary';
          }
        }
      }
    }
    updateCloudSyncUI(true);
    if (d.wifi_status === 'Online' && d.connected_ssid) updateWifiUI('Online', d.connected_ssid);
    else updateWifiUI('Offline', null);
    updateGPIOSuggestions();
  } catch(e) { console.error(e); }
}
function updateCloudSyncUI(online) {
  const led = document.getElementById('cloudLed');
  const text = document.getElementById('cloudText');
  if (led && text) {
    led.className = online ? 'led led-on' : 'led led-off';
    text.textContent = online ? 'Online' : 'Offline';
  }
}
function updateWifiUI(status, ssid) {
  const iconSpan = document.getElementById('wifiIcon');
  const textSpan = document.getElementById('wifiText');
  if (iconSpan && textSpan) {
    iconSpan.className = status === 'Online' ? 'wifi-online' : 'wifi-offline';
    textSpan.textContent = status === 'Online' ? (ssid || 'Connected') : 'Offline';
  }
}
function renderPinBadges(pinStr) {
  const container = $('relayPinsContainer');
  if(!container) return;
  container.innerHTML = '';
  if(!pinStr || pinStr === '--') { container.innerHTML = '<span>--</span>'; return; }
  pinStr.split(',').forEach(p => {
    const badge = document.createElement('span');
    badge.className = 'pin-badge';
    badge.textContent = p.trim();
    container.appendChild(badge);
  });
}
function updateCurrentGpioText() {
  const container = $('currentGpioText');
  if (!container) return;
  const gpioRaw = $('gpioInput')?.value.trim() || '';
  container.textContent = gpioRaw ? `Current: ${gpioRaw}` : 'Current: --';
}
function setConnectionState(connected) {
  safeCls($('connCard'), 'hidden', connected);
  safeCls($('disconnectBtn'), 'hidden', !connected);
  document.querySelectorAll('.app-card').forEach(c=>safeCls(c,'hidden',!connected));
  safeTxt('connStatus', connected?'Connected':'Not configured');
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
  let wsPort = mqttPort;
  if (mqttBroker.includes("hivemq.cloud") && wsPort == 8883) wsPort = 8884;
  const url = `wss://${mqttBroker}:${wsPort}/mqtt`;
  if (mqttClient?.connected) mqttClient.end(true);
  mqttClient = mqtt.connect(url, { clientId: 'web_' + Math.random().toString(16).substr(2,8), username: mqttUser, password: mqttPass, clean: true, reconnectPeriod: 0 });
  mqttClient.on('connect', () => {
    log('MQTT Connected');
    setConnectionState(true);
    mqttClient.subscribe(`${DEVICE_ID}/relay/+/state`);
    mqttClient.subscribe(`${DEVICE_ID}/status`);
    mqttClient.subscribe(`${DEVICE_ID}/terminal`);
    mqttClient.subscribe(`${DEVICE_ID}/wifi/scan_result`);
    mqttClient.publish(`${DEVICE_ID}/cmd/state/request`, '1');
  });
  mqttClient.on('message', (topic, msg) => {
    const t = topic.toString();
    const m = msg.toString().trim();
    if (t === `${DEVICE_ID}/terminal`) {
      if (!m.includes('Timestamp diff')) log(m);
    } else if (t === `${DEVICE_ID}/status`) {
      updateSystemHealth(m);
    } else if (t.startsWith(`${DEVICE_ID}/relay/`) && t.endsWith('/state')) {
      const relayNum = parseInt(t.split('/')[2]);
      const isOn = (m === '1');
      const btn = $(`btn-relay-${relayNum}`);
      if (btn) {
        btn.dataset.state = isOn ? 'on' : 'off';
        btn.textContent = isOn ? `${getRelayLabel(relayNum)} ✓` : getRelayLabel(relayNum);
        btn.className = isOn ? 'btn-success' : 'btn-secondary';
      }
      currentRelayState[relayNum-1] = isOn;
    } else if (t === `${DEVICE_ID}/wifi/scan_result`) {
      handleWifiScanResult(m);
    }
  });
  mqttClient.on('error', () => { log('MQTT Error'); setConnectionState(false); });
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
    btn.textContent = getRelayLabel(i);
    btn.onclick = (r => () => sendRelayCommand(r))(i);
    box.appendChild(btn);
  }
  updateSchedulerRelaySelect();
}
async function sendRelayCommand(num) {
  if (!mqttClient?.connected) { alert('MQTT not connected!'); return; }
  const btn = $(`btn-relay-${num}`);
  if(!btn) return;
  const newState = btn.dataset.state === 'on' ? 0 : 1;
  await pubSecure(`${DEVICE_ID}/relay/${num}/cmd`, { state: newState });
}
function updateRelayUIByCount() {
  safeVal('relayCountInput', relayCount);
  initRelayButtons();
  updateSchedulerRelaySelect();
  renderRelayLabelsInputs();
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
  const pins = gpioRaw.split(',').map(p=>p.trim()).filter(p=>p);
  if (pins.length !== newCount) { alert(`GPIO count mismatch`); return; }
  if (isNaN(newCount) || newCount < 1 || newCount > maxRelayFromDevice) { alert(`Relay count must be 1-${maxRelayFromDevice}`); return; }
  if (mqttClient?.connected) {
    await pubSecure(`${DEVICE_ID}/config/relayCount`, { count: newCount });
    await pubSecure(`${DEVICE_ID}/gpio/update`, { pins: gpioRaw });
    const configToSave = { device: DEVICE_ID, relayCount: newCount, gpio: pins, relayLabels, updatedAt: new Date().toISOString() };
    await saveDeviceConfigToWorker(DEVICE_ID, configToSave);
  }
  localStorage.setItem('dm_relay_count', newCount);
  relayCount = newCount;
  updateRelayUIByCount();
  log(`Relay config applied: ${newCount} relays, GPIO: ${gpioRaw}`);
  alert('Configuration sent. Device may restart.');
}

// ==================== SCHEDULER ====================
function initScheduler() {
  document.querySelectorAll('.day-btn').forEach(btn=>{ btn.onclick=function(){ this.classList.toggle('active'); vibrate(); }; });
  renderSchedules();
  startSchedulerEngine();
}
function addSchedule() {
  if (!DEVICE_ID) { alert('Set Device ID first'); return; }
  vibrate();
  const time = $('schTime').value, relay = $('schRelay').value, action = $('schAction').value;
  const activeDays = Array.from(document.querySelectorAll('.day-btn.active')).map(b=>parseInt(b.dataset.day));
  if(!time || activeDays.length===0) return alert('Time & days required');
  schedules.push({ id: Date.now().toString(36)+Math.random().toString(36).substr(2,4), time, relay, action, days: activeDays, enabled: true, _modified: new Date().toISOString() });
  saveSchedules();
  renderSchedules();
}
function toggleSchedule(id) {
  const sch = schedules.find(s=>s.id===id);
  if(sch) { sch.enabled = !sch.enabled; sch._modified = new Date().toISOString(); saveSchedules(); renderSchedules(); }
}
function deleteSchedule(id) {
  if(confirm('Delete schedule?')) { schedules = schedules.filter(s=>s.id!==id); saveSchedules(); renderSchedules(); }
}
function mergeScheduleArrays(localArr, serverArr) {
  const map = new Map();
  (serverArr||[]).forEach(s=>{ const clean=JSON.parse(JSON.stringify(s)); delete clean._source; map.set(clean.id,clean); });
  (localArr||[]).forEach(s=>{ const existing=map.get(s.id); const isNewer = s._modified && (!existing?._modified || s._modified > existing._modified); if(!existing||isNewer){ const clean=JSON.parse(JSON.stringify(s)); delete clean._source; map.set(s.id,clean); } });
  return Array.from(map.values()).sort((a,b)=>a.time.localeCompare(b.time));
}
function saveSchedules() {
  localStorage.setItem('dm_schedules', JSON.stringify(schedules));
  if (DEVICE_ID) saveSchedulerToWorker(DEVICE_ID).catch(e=>debugLog(e));
}
function saveSchedulesLocal() { localStorage.setItem('dm_schedules', JSON.stringify(schedules)); }
function renderSchedules() {
  const list = $('scheduleList');
  if(!list) return;
  list.innerHTML = '';
  if(schedules.length===0) { list.innerHTML='<p>No schedules yet.</p>'; return; }
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  schedules.forEach(sch=>{
    const daysStr = sch.days.map(d=>dayNames[d]).join(',');
    const relayLabel = getRelayLabel(parseInt(sch.relay));
    const div = document.createElement('div');
    div.className='schedule-item';
    div.innerHTML = `<div class="sch-info"><span class="sch-time">🕐 ${sch.time}</span> ${relayLabel} → ${sch.action=='1'?'ON':'OFF'}<br><span>📅 ${daysStr}</span></div><div class="sch-actions"><div class="toggle-switch ${sch.enabled?'active':''}" onclick="toggleSchedule('${sch.id}')"></div><button onclick="deleteSchedule('${sch.id}')">🗑️</button></div>`;
    list.appendChild(div);
  });
}
function startSchedulerEngine() {
  if(schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(checkSchedules, 30000);
}
function checkSchedules() {
  if (!DEVICE_ID) return;
  const now = new Date(), curTime = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`, curDay = now.getDay(), dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  schedules.forEach(sch=>{
    if(!sch.enabled || sch.time!==curTime || !sch.days.includes(curDay)) return;
    const key = `${sch.id}_${dateKey}`;
    if(lastTriggered[sch.id]===key) return;
    lastTriggered[sch.id]=key;
    if(mqttClient?.connected) mqttClient.publish(`${DEVICE_ID}/relay/${sch.relay}/cmd`, sch.action);
  });
}

// ==================== LABELS ====================
function renderRelayLabelsInputs() {
  const container = $('relayLabelsContainer');
  if (!container) return;
  container.innerHTML = '';
  while (relayLabels.length < relayCount) relayLabels.push(`Relay ${relayLabels.length+1}`);
  while (relayLabels.length > relayCount) relayLabels.pop();
  for (let i=0; i<relayCount; i++) {
    const div = document.createElement('div');
    div.className = 'label-input-group';
    div.innerHTML = `<span>Relay ${i+1}:</span><input type="text" id="label_relay_${i+1}" value="${escapeHtml(relayLabels[i])}" placeholder="Label">`;
    container.appendChild(div);
  }
}
function collectLabelsFromInputs() {
  const labels = [];
  for (let i=1; i<=relayCount; i++) {
    const input = $(`label_relay_${i}`);
    labels.push(input?.value.trim() || `Relay ${i}`);
  }
  return labels;
}
async function saveRelayLabelsToCloud() {
  if (!DEVICE_ID) { alert('No active device'); return; }
  const newLabels = collectLabelsFromInputs();
  relayLabels = newLabels;
  
  const currentRelayCount = relayCount;
  const gpioRaw = $('gpioInput')?.value.trim() || "";
  const gpio = gpioRaw ? gpioRaw.split(',').map(p=>p.trim()) : [];

  // PERBAIKAN: Sertakan 'alias' agar tidak hilang saat refresh
  const config = { 
    device: DEVICE_ID, 
    relayCount: currentRelayCount, 
    gpio: gpio, 
    relayLabels: relayLabels,
    alias: currentDeviceAlias, // Tambahkan baris ini
    updatedAt: new Date().toISOString() 
  };

  const ok = await saveDeviceConfigToWorker(DEVICE_ID, config);
  if (ok) {
    log('Labels & Alias saved to cloud');
    initRelayButtons();
    updateAliasDisplay(); // Update tampilan seketika
    alert('Settings synchronized with GitHub');
  } else {
    alert('Failed to save to cloud');
  }
}
function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m] || m)); }

// ==================== NOTIF ====================
function initNotifUI() {
  const tg = notifConfig.tg||{};
  if(tg.token && tg.chatId){ safeVal('tgToken','••••••••'); safeVal('tgChatId',tg.chatId); safeTxt('tgChatDisplay',tg.chatId); tgConnected = tg.connected || false; }
  safeCls($('tgToggle'),'active',tgEnabled);
  const update = () => {
    const b=$('tgStatusBadge'), c=$('tgConfig'), d=$('tgConnected');
    if(!tgEnabled){ b.textContent='Inactive'; b.className='notif-status status-inactive'; c.classList.add('hidden'); d.classList.add('hidden'); }
    else if(tgConnected && notifConfig.tg?.token && notifConfig.tg?.chatId){ b.textContent='Active'; b.className='notif-status status-active'; c.classList.add('hidden'); d.classList.remove('hidden'); }
    else { b.textContent='Config'; b.className='notif-status status-inactive'; c.classList.remove('hidden'); d.classList.add('hidden'); }
  };
  $('tgToggle').onclick = function(){ tgEnabled=!tgEnabled; this.classList.toggle('active',tgEnabled); update(); saveNotifConfig(); };
  update();
}
function saveNotifConfig() {
  notifConfig = { tg: { token: notifConfig.tg?.token, chatId: notifConfig.tg?.chatId, enabled: tgEnabled, connected: tgConnected } };
  localStorage.setItem('dm_notif_config', JSON.stringify(notifConfig));
}
function saveTelegramConfig() {}
function testTelegram() {}
function fetchChatId() {}
function editTelegramConfig() {}

// ==================== QR SCANNER ====================
function openQR() { $('qrModal').style.display = 'flex'; }
function closeQR() { $('qrModal').style.display = 'none'; if(qrScanner) { qrScanner.stop().catch(()=>{}); qrScanner = null; } }
function onQRSuccess(decodedText) { addDeviceFromQR(decodedText); closeQR(); }
function initQRScanner() {
  const startCameraBtn = document.getElementById('startCameraBtn');
  startCameraBtn.onclick = async () => {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') { alert("Camera requires HTTPS"); return; }
    if (qrScanner) try { await qrScanner.stop(); } catch(e) {}
    if (qrScanner) qrScanner.clear();
    const readerDiv = document.getElementById('reader');
    readerDiv.innerHTML = '';
    qrScanner = new Html5Qrcode("reader");
    qrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onQRSuccess, ()=>{}).catch(err=>alert("Camera error: "+err));
  };
  document.getElementById('qrFileInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (qrScanner) { try { await qrScanner.stop(); } catch(e) {} qrScanner.clear(); qrScanner = null; }
    const readerDiv = document.getElementById('reader');
    readerDiv.innerHTML = '<p>Processing...</p>';
    const tempScanner = new Html5Qrcode("reader");
    const decoded = await tempScanner.scanFile(file, true);
    onQRSuccess(decoded);
    tempScanner.clear();
    readerDiv.innerHTML = '';
    e.target.value = '';
  };
}

// ==================== WIFI SCAN ====================
function scanWifi() {
  if (!mqttClient?.connected) { alert('MQTT not connected.'); return; }
  const scanDiv = document.getElementById('wifiScanResult');
  scanDiv.innerHTML = '<div>Scanning...</div>';
  scanDiv.style.display = 'block';
  mqttClient.publish(`${DEVICE_ID}/wifi/scan`, '1');
  setTimeout(() => { if(scanDiv.innerHTML.includes('Scanning...')) scanDiv.innerHTML = '<div>Timeout</div>'; }, 20000);
}
function handleWifiScanResult(data) {
  const scanDiv = document.getElementById('wifiScanResult');
  try {
    let networks = JSON.parse(data);
    if (!networks.length) { scanDiv.innerHTML = '<div>No networks</div>'; return; }
    let html = '';
    networks.forEach(net => { html += `<div class="wifi-scan-item" data-ssid="${escapeHtml(net.ssid)}"><span>${escapeHtml(net.ssid)}</span><span>${net.rssi} dBm</span></div>`; });
    scanDiv.innerHTML = html;
    document.querySelectorAll('.wifi-scan-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('netSsid').value = item.getAttribute('data-ssid');
        scanDiv.style.display = 'none';
      });
    });
  } catch(e) { scanDiv.innerHTML = '<div>Invalid response</div>'; }
}

// ==================== DROPDOWN, ACCORDION ====================
function initDropdown() {
  const selected = document.getElementById('dropdownSelected');
  const menu = document.getElementById('dropdownMenu');
  if (!selected || !menu) return;
  const items = document.querySelectorAll('.dropdown-item');
  const panels = document.querySelectorAll('.settings-panel');
  const selectedLabel = document.getElementById('selectedLabel');
  function switchPanel(panelId, itemElement) {
    panels.forEach(p => p.classList.remove('active'));
    document.getElementById(panelId)?.classList.add('active');
    const icon = itemElement?.querySelector('.item-icon')?.innerHTML || '⚙️';
    const label = itemElement?.querySelector('.item-label')?.innerHTML || 'Config';
    if (selectedLabel) selectedLabel.innerHTML = label;
    const firstSpan = selected.querySelector('span:first-child');
    if (firstSpan) firstSpan.innerHTML = `<span class="item-icon">${icon}</span> <span>${label}</span>`;
    items.forEach(i => i.classList.remove('active'));
    if (itemElement) itemElement.classList.add('active');
  }
  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const panelId = item.getAttribute('data-panel');
      if (panelId) switchPanel(panelId, item);
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
function initAccordion() {
  document.querySelectorAll('.card.collapsible').forEach(card => {
    const header = card.querySelector('.card-header');
    if (!header) return;
    if (header._clickHandler) header.removeEventListener('click', header._clickHandler);
    const handler = (e) => { e.stopPropagation(); card.classList.toggle('collapsed'); };
    header.addEventListener('click', handler);
    header._clickHandler = handler;
  });
}
function initPwaInstall() {}
function updateGPIOSuggestions() {
  const datalist = $('gpioSuggestions');
  if(!datalist) return;
  datalist.innerHTML = '';
  let commonPins = [];
  if(currentHardware.includes('ESP32S2')) commonPins = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
  else if(currentHardware.includes('ESP32C3')) commonPins = [0,1,3,4,5,6,7,10,18,19];
  else if(currentHardware.includes('ESP32')) commonPins = [12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33];
  else if(currentHardware.includes('WEMOS') || currentHardware.includes('ESP8266')) commonPins = [5,4,14,12,13,15];
  commonPins.forEach(p => { const opt = document.createElement('option'); opt.value = p; datalist.appendChild(opt); });
}
function suggestDefaultPins() {
  let defaultPinsAll = [];
  if(currentHardware.includes('ESP32S2')) defaultPinsAll = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
  else if(currentHardware.includes('ESP32C3')) defaultPinsAll = [0,1,3,4,5,6,7,10,18,19];
  else if(currentHardware.includes('ESP32')) defaultPinsAll = [12,13,14,15,16,17,18,19,21,22,23,25];
  else if(currentHardware.includes('WEMOS') || currentHardware.includes('ESP8266')) defaultPinsAll = [5,4,14,12,13,15];
  else defaultPinsAll = [12,14,27,26,25];
  let pinCount = relayCount;
  if(pinCount > defaultPinsAll.length) pinCount = defaultPinsAll.length;
  $('gpioInput').value = defaultPinsAll.slice(0, pinCount).join(',');
  updateCurrentGpioText();
}
function initLocationInfo() {
  const locSpan = document.getElementById('locText');
  if(locSpan) setInterval(() => { locSpan.innerHTML = `🕐 ${new Date().toLocaleTimeString()} &nbsp; 🌐 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`; }, 1000);
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initAccordion();
  initLocationInfo();
  initPwaInstall();
  initDropdown();
  initQRScanner();
  initNotifUI();
  initScheduler();

  $('refreshWhitelistBtn').onclick = refreshWhitelist;
  $('showQrBtn').onclick = openQR;
  $('qrModal').onclick = function(e) { if(e.target === this) closeQR(); };
  $('disconnectBtn').onclick = () => { if(mqttClient) mqttClient.end(true); };
  $('allOnBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(`${DEVICE_ID}/all/on`, { state: 1 }); };
  $('allOffBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(`${DEVICE_ID}/all/off`, { state: 1 }); };
  $('saveNTPBtn').onclick = () => { if(DEVICE_ID) { mqttClient?.publish(`${DEVICE_ID}/ntp/set`, $('ntpSelect').value); mqttClient?.publish(`${DEVICE_ID}/timezone/set`, $('tzInput').value); } };
  $('applyRelayConfigBtn').onclick = applyRelayConfig;
  $('suggestDefaultPinsBtn').onclick = suggestDefaultPins;
  $('scanWifiBtn').onclick = scanWifi;
  $('updateNetBtn').onclick = async () => { const ssid = $('netSsid').value.trim(); if(ssid && DEVICE_ID) { localStorage.setItem(`wifi_pass_${ssid}`, $('netPass').value); await pubSecure(`${DEVICE_ID}/network/update`, { ssid, pass: $('netPass').value }); alert('Sent'); } };
  $('resetNetBtn').onclick = async () => { if(confirm('Reset WiFi?')) await pubSecure(`${DEVICE_ID}/network/reset`, { cmd: 1 }); };
  $('otaBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(`${DEVICE_ID}/system/ota`, { cmd: 1 }); };
  $('restartBtn').onclick = async () => { if(DEVICE_ID) await pubSecure(`${DEVICE_ID}/system/restart`, { cmd: 1 }); };
  $('forceApBtn').onclick = async () => { if(DEVICE_ID && confirm('Force AP?')) await pubSecure(`${DEVICE_ID}/force_ap`, { cmd: 1 }); };
  $('clearLogBtn').onclick = () => { const t=$('terminal'); if(t) t.innerHTML=''; };
  $('saveLabelsBtn').onclick = saveRelayLabelsToCloud;
  $('addScheduleBtn').onclick = addSchedule;
  $('saveTelegramBtn').onclick = saveTelegramConfig;
  $('testTelegramBtn').onclick = testTelegram;
  $('fetchChatIdBtn').onclick = fetchChatId;
  $('editTelegramBtn').onclick = editTelegramConfig;
  $('testTelegramConnectedBtn').onclick = testTelegram;
  $('addDeviceBtn').onclick = openQR;

  loadDevicesFromStorage();
  if (devices.length === 0) {
    $('connCard').classList.remove('hidden');
    document.querySelectorAll('.app-card').forEach(c => c.classList.add('hidden'));
  } else if (currentDeviceId) switchDevice(currentDeviceId);
  else if (devices.length) switchDevice(devices[0].deviceId);

  if ($('gpioInput')) $('gpioInput').addEventListener('input', updateCurrentGpioText);
  const healthHeader = document.getElementById('healthCardHeader');
  const healthContent = document.getElementById('healthCardContent');
  if (healthHeader && healthContent) {
    healthHeader.style.cursor = 'pointer';
    healthHeader.addEventListener('click', () => healthContent.classList.toggle('hidden'));
  }
});
async function refreshWhitelist() {
  localStorage.removeItem('dm_whitelist_cache');
  const statusEl = $('whitelistStatus');
  if (statusEl) statusEl.textContent = '🔄 Refreshing...';
  try {
    const res = await fetch(`${WORKER_URL}/RELAY/api/whitelist`);
    if (res.ok) {
      const whitelist = await res.json();
      localStorage.setItem('dm_whitelist_cache', JSON.stringify({ list: whitelist, timestamp: Date.now() }));
      if (statusEl) statusEl.textContent = '✅ Refreshed';
    } else throw new Error();
  } catch(e) { if(statusEl) statusEl.textContent = '❌ Failed'; }
  setTimeout(() => { if(statusEl) statusEl.textContent = ''; }, 2000);
}
