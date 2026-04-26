// ==================== GLOBALS ====================
// Gunakan string kosong jika dashboard dihosting di domain Worker yang sama
const WORKER_URL = ""; 

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
function debugLog(...args) { console.log("[Debug]", ...args); }
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

// ==================== DEVICE API (KONEKSI KE WORKER) ====================
async function loadDeviceConfigFromWorker(deviceId) {
  try {
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/device.json`);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = await res.json();
    if (config.device === deviceId) {
      if (config.relayCount) {
        relayCount = Math.min(maxRelayFromDevice, Math.max(1, config.relayCount));
        localStorage.setItem('dm_relay_count', relayCount);
        updateRelayUIByCount();
      }
      if (config.gpio && config.gpio.length) {
        safeVal('gpioInput', config.gpio.join(','));
        updateCurrentGpioText();
      }
      if (config.relayLabels && Array.isArray(config.relayLabels)) {
        relayLabels = [...config.relayLabels];
        renderRelayLabelsInputs();
        initRelayButtons();
      }
      if (config.alias) {
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
  } catch(e) { debugLog("Load Config Gagal:", e); }
  return false;
}

async function saveDeviceConfigToWorker(deviceId, config) {
  try {
    console.log("Saving device config...", config);
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/device.json`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(config)
    });
    return res.ok;
  } catch(e) { 
    console.error("Save Config Error:", e);
    return false; 
  }
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
  } catch(e) { debugLog("Load Scheduler Gagal:", e); }
  return false;
}

async function saveSchedulerToWorker(deviceId) {
  try {
    if (!schedules) return false;
    const payload = { 
      device: deviceId, 
      schedules: schedules.map(s => { 
        const { _source, ...rest } = s; 
        return rest; 
      }), 
      updatedAt: new Date().toISOString() 
    };
    
    console.log("Saving scheduler...", payload);
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/scheduler.json`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    });
    return res.ok;
  } catch(e) { 
    console.error("Save Scheduler Gagal:", e);
    return false; 
  }
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
  try {
    const res = await fetch(`${WORKER_URL}/api/device/${deviceId}/device.json`);
    let config = res.ok ? await res.json() : { device: deviceId };
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
  } catch(e) { return false; }
}

function renderDeviceList() {
  const container = document.getElementById('deviceListContainer');
  if (!container) return;
  if (!devices.length) {
    container.innerHTML = '<p>No devices added. Scan QR to start.</p>';
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
  
  // Event Listeners
  document.querySelectorAll('.device-alias-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const id = input.getAttribute('data-id');
      const newAlias = input.value.trim();
      if (newAlias) await updateDeviceAliasInWorker(id, newAlias);
    });
  });
  document.querySelectorAll('.switch-device-btn').forEach(btn => {
    btn.addEventListener('click', () => switchDevice(btn.getAttribute('data-id')));
  });
  document.querySelectorAll('.delete-device-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm(`Delete device "${id}"?`)) deleteDevice(id);
    });
  });
}

function deleteDevice(deviceId) {
  devices = devices.filter(d => d.deviceId !== deviceId);
  if (deviceId === currentDeviceId && devices.length > 0) switchDevice(devices[0].deviceId);
  saveDevicesToStorage();
  renderDeviceList();
}

async function addDeviceFromQR(data) {
  try {
    let jsonData = JSON.parse(data);
    if (!jsonData.broker || !jsonData.device || !jsonData.secret) throw new Error('Invalid Config');
    
    let deviceId = jsonData.device.startsWith('DmarchFF_') ? jsonData.device : 'DmarchFF_' + jsonData.device;

    // Cek Whitelist
    const whitelistRes = await fetch(`${WORKER_URL}/RELAY/api/whitelist`);
    if (whitelistRes.ok) {
      const whitelist = await whitelistRes.json();
      if (!whitelist.includes(deviceId)) { alert(`Device ${deviceId} not whitelisted.`); return; }
    }

    if (!devices.find(d => d.deviceId === deviceId)) {
      devices.push({
        deviceId, alias: deviceId, mqttBroker: jsonData.broker, mqttPort: jsonData.port,
        mqttUser: jsonData.user, mqttPass: jsonData.pass, secret: jsonData.secret
      });
      saveDevicesToStorage();
    }
    switchDevice(deviceId);
  } catch(e) { alert('Invalid QR: ' + e.message); }
}

async function switchDevice(deviceId) {
  const device = devices.find(d => d.deviceId === deviceId);
  if (!device) return;
  
  if (mqttClient?.connected) mqttClient.end(true);
  
  DEVICE_ID = device.deviceId;
  mqttBroker = device.mqttBroker;
  mqttPort = device.mqttPort;
  mqttUser = device.mqttUser;
  mqttPass = device.mqttPass;
  currentDeviceId = deviceId;
  currentDeviceAlias = device.alias || deviceId;
  
  updateAliasDisplay();
  renderDeviceList();
  
  // Load Config & Scheduler secara bersamaan
  await Promise.all([
    loadDeviceConfigFromWorker(DEVICE_ID),
    loadSchedulerFromWorker(DEVICE_ID)
  ]);
  
  connectMQTT();
}

// ==================== MQTT ====================
function connectMQTT() {
  if (!DEVICE_ID || !mqttBroker) return;
  let wsPort = mqttPort;
  if (mqttBroker.includes("hivemq.cloud") && wsPort == 8883) wsPort = 8884;
  const url = `wss://${mqttBroker}:${wsPort}/mqtt`;
  
  mqttClient = mqtt.connect(url, { 
    clientId: 'web_' + Math.random().toString(16).substr(2,8), 
    username: mqttUser, password: mqttPass, 
    clean: true, reconnectPeriod: 5000 
  });

  mqttClient.on('connect', () => {
    log('MQTT Connected');
    setConnectionState(true);
    mqttClient.subscribe(`${DEVICE_ID}/status`);
    mqttClient.subscribe(`${DEVICE_ID}/terminal`);
    mqttClient.subscribe(`${DEVICE_ID}/relay/+/state`);
    mqttClient.publish(`${DEVICE_ID}/cmd/state/request`, '1');
  });

  mqttClient.on('message', (topic, msg) => {
    const t = topic.toString();
    const m = msg.toString().trim();
    if (t === `${DEVICE_ID}/status`) updateSystemHealth(m);
    if (t === `${DEVICE_ID}/terminal`) log(m);
    if (t.includes('/relay/') && t.endsWith('/state')) {
      const num = t.split('/')[2];
      updateRelayUI(num, m === '1');
    }
  });

  mqttClient.on('close', () => setConnectionState(false));
}

function updateRelayUI(num, isOn) {
  const btn = $(`btn-relay-${num}`);
  if (btn) {
    btn.dataset.state = isOn ? 'on' : 'off';
    btn.textContent = isOn ? `${getRelayLabel(num)} ✓` : getRelayLabel(num);
    btn.className = isOn ? 'btn-success' : 'btn-secondary';
  }
}

function updateSystemHealth(msg) {
  try {
    const d = JSON.parse(msg);
    safeTxt('sigVal', (d.rssi ?? '--') + '%');
    safeTxt('upVal', d.uptime ?? '--');
    safeTxt('tempVal', (d.temp ?? '--') + '°C');
    safeTxt('fwVal', d.fw_version ?? '--');
    if (d.relay_states) {
      d.relay_states.forEach((state, i) => updateRelayUI(i+1, state === 1));
    }
    updateCloudSyncUI(true);
  } catch(e) {}
}

function updateCloudSyncUI(online) {
  const led = $('cloudLed');
  if (led) led.className = online ? 'led led-on' : 'led led-off';
}

function setConnectionState(connected) {
  safeCls($('connCard'), 'hidden', connected);
  document.querySelectorAll('.app-card').forEach(c=>safeCls(c,'hidden',!connected));
}

// ==================== RELAY UI ====================
function initRelayButtons() {
  const box = $('relayBtns');
  if(!box) return;
  box.innerHTML = '';
  for(let i=1; i<=relayCount; i++) {
    const btn = document.createElement('button');
    btn.id = `btn-relay-${i}`;
    btn.className = 'btn-secondary';
    btn.textContent = getRelayLabel(i);
    btn.onclick = () => sendRelayCommand(i);
    box.appendChild(btn);
  }
}

async function sendRelayCommand(num) {
  const btn = $(`btn-relay-${num}`);
  const newState = btn.dataset.state === 'on' ? 0 : 1;
  await pubSecure(`${DEVICE_ID}/relay/${num}/cmd`, { state: newState });
}

function updateRelayUIByCount() {
  safeVal('relayCountInput', relayCount);
  initRelayButtons();
  updateSchedulerRelaySelect();
  renderRelayLabelsInputs();
}

// ==================== SCHEDULER ====================
function initScheduler() {
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.onclick = () => { btn.classList.toggle('active'); vibrate(); };
  });
  renderSchedules();
  setInterval(checkSchedules, 30000);
}

function addSchedule() {
  const time = $('schTime').value, relay = $('schRelay').value, action = $('schAction').value;
  const activeDays = Array.from(document.querySelectorAll('.day-btn.active')).map(b=>parseInt(b.dataset.day));
  if(!time || activeDays.length===0) return alert('Time & days required');
  
  schedules.push({ 
    id: Math.random().toString(36).substr(2, 9), 
    time, relay, action, days: activeDays, enabled: true, 
    _modified: new Date().toISOString() 
  });
  
  saveSchedules();
  renderSchedules();
}

function saveSchedules() {
  localStorage.setItem('dm_schedules', JSON.stringify(schedules));
  if (DEVICE_ID) saveSchedulerToWorker(DEVICE_ID);
}

function saveSchedulesLocal() { localStorage.setItem('dm_schedules', JSON.stringify(schedules)); }

function renderSchedules() {
  const list = $('scheduleList');
  if(!list) return;
  list.innerHTML = schedules.length ? '' : '<p>No schedules yet.</p>';
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  schedules.forEach(sch=>{
    const div = document.createElement('div');
    div.className='schedule-item';
    div.innerHTML = `
      <div class="sch-info">
        <span class="sch-time">🕐 ${sch.time}</span> ${getRelayLabel(sch.relay)} → ${sch.action=='1'?'ON':'OFF'}<br>
        <span>📅 ${sch.days.map(d=>dayNames[d]).join(',')}</span>
      </div>
      <div class="sch-actions">
        <div class="toggle-switch ${sch.enabled?'active':''}" onclick="toggleSchedule('${sch.id}')"></div>
        <button onclick="deleteSchedule('${sch.id}')">🗑️</button>
      </div>`;
    list.appendChild(div);
  });
}

function toggleSchedule(id) {
  const sch = schedules.find(s=>s.id===id);
  if(sch) { sch.enabled = !sch.enabled; sch._modified = new Date().toISOString(); saveSchedules(); renderSchedules(); }
}

function deleteSchedule(id) {
  if(confirm('Delete schedule?')) { schedules = schedules.filter(s=>s.id!==id); saveSchedules(); renderSchedules(); }
}

function checkSchedules() {
  const now = new Date(), curTime = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`, curDay = now.getDay();
  schedules.forEach(sch=>{
    if(!sch.enabled || sch.time!==curTime || !sch.days.includes(curDay)) return;
    const key = `${sch.id}_${now.toDateString()}`;
    if(lastTriggered[sch.id]===key) return;
    lastTriggered[sch.id]=key;
    if(mqttClient?.connected) mqttClient.publish(`${DEVICE_ID}/relay/${sch.relay}/cmd`, sch.action);
  });
}

// ==================== LABELS & CONFIG ====================
function renderRelayLabelsInputs() {
  const container = $('relayLabelsContainer');
  if (!container) return;
  container.innerHTML = '';
  for (let i=0; i<relayCount; i++) {
    const val = relayLabels[i] || `Relay ${i+1}`;
    container.innerHTML += `<div class="label-input-group"><span>Relay ${i+1}:</span><input type="text" id="label_relay_${i+1}" value="${escapeHtml(val)}"></div>`;
  }
}

async function saveRelayLabelsToCloud() {
  if (!DEVICE_ID) return;
  relayLabels = [];
  for (let i=1; i<=relayCount; i++) {
    relayLabels.push($(`label_relay_${i}`).value.trim());
  }

  const config = { 
    device: DEVICE_ID, 
    relayCount, 
    relayLabels,
    alias: currentDeviceAlias,
    updatedAt: new Date().toISOString() 
  };

  if (await saveDeviceConfigToWorker(DEVICE_ID, config)) {
    initRelayButtons();
    alert('Labels synchronized!');
  }
}

function updateSchedulerRelaySelect() {
  const sel = $('schRelay');
  if(!sel) return;
  sel.innerHTML = '';
  for(let i=1; i<=relayCount; i++) {
    sel.innerHTML += `<option value="${i}">${getRelayLabel(i)}</option>`;
  }
}

function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m] || m)); }

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initScheduler();
  $('showQrBtn').onclick = () => $('qrModal').style.display = 'flex';
  $('saveLabelsBtn').onclick = saveRelayLabelsToCloud;
  $('addScheduleBtn').onclick = addSchedule;
  $('addDeviceBtn').onclick = () => $('qrModal').style.display = 'flex';
  
  loadDevicesFromStorage();
  if (currentDeviceId) switchDevice(currentDeviceId);
});
