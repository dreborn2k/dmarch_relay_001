// ========== POLLING DATA DARI ESP32 ==========
let rpmValue = 750;
let speedValue = 0;
let overrevActive = false;

const canvas = document.getElementById('gauge-canvas');
const ctx = canvas.getContext('2d');
const rpmLabel = document.getElementById('rpm-label');
const speedElem = document.getElementById('speed-val');

const waves = {
    frontCenter: document.querySelector('.sensor-front-center'),
    frontLeft: document.querySelector('.sensor-front-left'),
    frontRight: document.querySelector('.sensor-front-right'),
    rearLeft: document.querySelector('.sensor-rear-left'),
    rearRight: document.querySelector('.sensor-rear-right')
};

// ========== WARNING THRESHOLD SETTINGS ==========
const warningParams = [
    { id: 'val-ect', label: 'ECT Temp', default: 100, unit: '°C' },
    { id: 'val-tps', label: 'Throttle', default: 85, unit: '%' },
    { id: 'val-maf', label: 'MAF', default: 80, unit: 'g/s' },
    { id: 'val-iat', label: 'Intake Air', default: 60, unit: '°C' },
    { id: 'val-load', label: 'Engine Load', default: 90, unit: '%' },
    { id: 'val-oil', label: 'Oil Temp', default: 120, unit: '°C' },
    { id: 'val-map', label: 'MAP', default: 120, unit: 'kPa' },
    { id: 'val-fuel', label: 'Fuel Rate', default: 25, unit: 'L/h' },
    { id: 'val-fuel-level', label: 'Fuel Level', default: 10, unit: '%', lowWarning: true },
    { id: 'val-volt', label: 'Voltage', default: 11.5, unit: 'V', lowWarning: true },
    { id: 'val-stft1', label: 'STFT B1', default: 15, unit: '%' },
    { id: 'val-ltft1', label: 'LTFT B1', default: 15, unit: '%' },
    { id: 'val-timing', label: 'Timing', default: 30, unit: '°' },
    { id: 'rpm', label: 'RPM', default: 6000, unit: 'rpm' },
    { id: 'speed', label: 'Speed', default: 120, unit: 'km/h' }
];

let warningThresholds = {};

function loadWarningSettings() {
    const saved = localStorage.getItem('obd2_warning_thresholds');
    if (saved) {
        warningThresholds = JSON.parse(saved);
    } else {
        warningParams.forEach(p => { warningThresholds[p.id] = p.default; });
    }
}

function saveWarningSettings() {
    localStorage.setItem('obd2_warning_thresholds', JSON.stringify(warningThresholds));
    updateAllCardsWarningStatus();
}

function isWarningActive(paramId, value) {
    let threshold = warningThresholds[paramId];
    if (threshold === undefined || threshold === null || threshold === '') return false;
    threshold = parseFloat(threshold);
    if (isNaN(threshold)) return false;
    const param = warningParams.find(p => p.id === paramId);
    if (param && param.lowWarning) {
        return value < threshold;
    }
    return value > threshold;
}

function updateCardWarning(paramId, value) {
    const card = document.getElementById(paramId)?.closest('.data-card.small-card');
    if (!card) return;
    if (isWarningActive(paramId, value)) {
        card.classList.add('warning-card');
    } else {
        card.classList.remove('warning-card');
    }
}

function updateAllCardsWarningStatus() {
    warningParams.forEach(param => {
        const elem = document.getElementById(param.id);
        if (elem) {
            let val = parseFloat(elem.innerText);
            if (!isNaN(val)) {
                updateCardWarning(param.id, val);
            }
        }
    });
}

// ========== JAM & KALENDER ==========
function updateClockAndCalendar() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const clockElem = document.getElementById('live-clock');
    if (clockElem) clockElem.innerText = `${hours}:${minutes}:${seconds}`;
    
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const dayName = days[now.getDay()];
    const day = now.getDate();
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    const calendarElem = document.getElementById('live-calendar');
    if (calendarElem) calendarElem.innerText = `${dayName}, ${day} ${month} ${year}`;
}
setInterval(updateClockAndCalendar, 1000);
updateClockAndCalendar();

// ========== GAUGE DRAW ==========
function drawGauge() {
    const cx = 200, cy = 200, r = 180;
    const MAX_RPM = 8000;
    const REDLINE = 3000;
    ctx.clearRect(0, 0, 400, 400);
    for (let i = 0; i <= MAX_RPM; i += 1000) {
        let angle = 0.75 * Math.PI + (i / MAX_RPM) * 1.5 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + (r - 10) * Math.cos(angle), cy + (r - 10) * Math.sin(angle));
        ctx.lineTo(cx + (r + 15) * Math.cos(angle), cy + (r + 15) * Math.sin(angle));
        ctx.strokeStyle = i >= REDLINE ? '#ff4757' : '#475569';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 14;
    ctx.stroke();
    let endAngle = 0.75 * Math.PI + (rpmValue / MAX_RPM) * 1.5 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.75 * Math.PI, endAngle);
    let arcColor = (rpmValue >= REDLINE && overrevActive) ? '#ff4757' : '#00d2ff';
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.stroke();
    const labelRadius = r - 30;
    rpmLabel.innerText = Math.floor(rpmValue);
    rpmLabel.style.left = (cx + labelRadius * Math.cos(endAngle)) + 'px';
    rpmLabel.style.top = (cy + labelRadius * Math.sin(endAngle)) + 'px';
    rpmLabel.style.transform = 'translate(-50%, -50%)';
    rpmLabel.style.color = (rpmValue >= REDLINE && overrevActive) ? '#ff4757' : '#00d2ff';
    if (rpmValue >= REDLINE && overrevActive && (Math.floor(Date.now() / 100) % 2 === 0)) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 18;
        ctx.stroke();
    }
    requestAnimationFrame(drawGauge);
}
drawGauge();

// ========== TRIP COMPUTER & FUEL ECONOMY ==========
let tripDistance = 0;
let tripSeconds = 0;
let totalFuelUsed = 0;
let lastFuelRate = 0;
let tripRunning = false;
let lastTripTimestamp = 0;

const INSTANT_WINDOW_SIZE = 20;
let instantKmlBuffer = [];

function addToInstantBuffer(value) {
    if (value !== null && !isNaN(value) && isFinite(value)) {
        instantKmlBuffer.push(value);
        if (instantKmlBuffer.length > INSTANT_WINDOW_SIZE) instantKmlBuffer.shift();
    }
}

function getSmoothedInstantKml() {
    if (instantKmlBuffer.length === 0) return "--";
    const sum = instantKmlBuffer.reduce((a, b) => a + b, 0);
    return (sum / instantKmlBuffer.length).toFixed(1);
}

const tripDistElem = document.getElementById('trip-dist');
const tripTimeElem = document.getElementById('trip-time');
const instantKmlElem = document.getElementById('instant-kml');
const avgKmlElem = document.getElementById('avg-kml');

function updateTripDisplay() {
    if (tripDistElem) tripDistElem.innerText = tripDistance.toFixed(1);
    if (tripTimeElem) {
        const hours = Math.floor(tripSeconds / 3600);
        const minutes = Math.floor((tripSeconds % 3600) / 60);
        const secs = Math.floor(tripSeconds % 60);
        tripTimeElem.innerText = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
    }
    if (avgKmlElem) {
        if (totalFuelUsed > 0 && tripDistance > 0) {
            avgKmlElem.innerText = (tripDistance / totalFuelUsed).toFixed(1);
        } else {
            avgKmlElem.innerText = "--";
        }
    }
}

function resetTrip() {
    if (confirm("Reset trip distance, timer, dan konsumsi bahan bakar?")) {
        tripDistance = 0;
        tripSeconds = 0;
        totalFuelUsed = 0;
        tripRunning = false;
        lastTripTimestamp = 0;
        instantKmlBuffer = [];
        updateTripDisplay();
        if (instantKmlElem) instantKmlElem.innerText = "--";
    }
}

document.getElementById('trip-dist-card')?.addEventListener('click', resetTrip);
document.getElementById('trip-time-card')?.addEventListener('click', resetTrip);

function updateTripAndFuel(speedKmh, fuelRateLph, nowMs) {
    let rawInstant = null;
    if (fuelRateLph > 0 && speedKmh > 0) rawInstant = speedKmh / fuelRateLph;
    if (rawInstant !== null && !isNaN(rawInstant) && isFinite(rawInstant)) {
        addToInstantBuffer(rawInstant);
    }
    if (instantKmlElem) instantKmlElem.innerText = getSmoothedInstantKml();
    
    if (!tripRunning) {
        if (speedKmh > 0) {
            tripRunning = true;
            lastTripTimestamp = nowMs;
            lastFuelRate = fuelRateLph;
        }
        return;
    }
    if (lastTripTimestamp === 0) {
        lastTripTimestamp = nowMs;
        lastFuelRate = fuelRateLph;
        return;
    }
    let deltaSec = (nowMs - lastTripTimestamp) / 1000;
    if (deltaSec > 1) deltaSec = 1;
    lastTripTimestamp = nowMs;
    tripSeconds += deltaSec;
    if (speedKmh > 0) tripDistance += speedKmh * (deltaSec / 3600);
    if (fuelRateLph > 0) totalFuelUsed += fuelRateLph * (deltaSec / 3600);
    updateTripDisplay();
}

// ========== STATUS KONEKSI RADAR & OBD2 ==========
let radarLastSeen = {
    frontLeft: 0,
    frontCenter: 0,
    frontRight: 0,
    rearLeft: 0,
    rearRight: 0
};
let lastObdDataTime = 0;

function updateConnectionStatus() {
    const now = Date.now();
    const timeout = 5000;
    const radarStatusIds = {
        frontLeft: 'radar-fl-status',
        frontCenter: 'radar-fc-status',
        frontRight: 'radar-fr-status',
        rearLeft: 'radar-lb-status',
        rearRight: 'radar-rb-status'
    };
    for (const [key, id] of Object.entries(radarStatusIds)) {
        const elem = document.getElementById(id);
        if (elem) {
            const isConnected = (now - radarLastSeen[key]) < timeout;
            elem.className = 'radar-status ' + (isConnected ? 'connected' : 'disconnected');
            elem.innerText = isConnected ? '●' : '○';
        }
    }
    const obdBadge = document.getElementById('obd-badge');
    if (obdBadge) {
        const isObdConnected = (now - lastObdDataTime) < timeout;
        obdBadge.innerText = isObdConnected ? 'OBD2 ●' : 'OBD2 ○';
        obdBadge.className = 'badge ' + (isObdConnected ? 'active' : '');
    }
}
setInterval(updateConnectionStatus, 2000);

// ========== POLLING DATA ==========
let lastFetchSpeed = 0;
let lastFetchFuelRate = 0;

function fetchData() {
    fetch('/data')
        .then(response => response.json())
        .then(data => updateDashboard(data))
        .catch(err => console.error('Fetch error:', err));
}

function updateDashboard(d) {
    const now = Date.now();
    if (d.rpm !== undefined) {
        rpmValue = d.rpm;
        overrevActive = (rpmValue >= 3000);
        lastObdDataTime = now;
    }
    if (d.speed !== undefined) {
        lastFetchSpeed = d.speed;
        speedValue = d.speed;
        speedElem.innerText = Math.floor(speedValue);
        lastObdDataTime = now;
    }
    if (d['val-fuel'] !== undefined) {
        lastFetchFuelRate = d['val-fuel'];
        lastObdDataTime = now;
    }
    
    updateTripAndFuel(lastFetchSpeed, lastFetchFuelRate, now);
    
    if (d.radarFrontLeft !== undefined) radarLastSeen.frontLeft = now;
    if (d.radarFrontCenter !== undefined) radarLastSeen.frontCenter = now;
    if (d.radarFrontRight !== undefined) radarLastSeen.frontRight = now;
    if (d.radarRearLeft !== undefined) radarLastSeen.rearLeft = now;
    if (d.radarRearRight !== undefined) radarLastSeen.rearRight = now;
    
    const fieldMap = {
        'val-ect': d['val-ect'], 'val-tps': d['val-tps'], 'val-maf': d['val-maf'], 'val-iat': d['val-iat'],
        'val-load': d['val-load'], 'radar-front-val': d['radar-front-val'],
        'val-fuel-level': d['val-fuel-level'], 'val-volt': d['val-volt'],
        'val-stft1': d['val-stft1'], 'val-ltft1': d['val-ltft1'], 'val-timing': d['val-timing'],
        'val-stft2': d['val-stft2'], 'val-ltft2': d['val-ltft2'], 'runtime': d['runtime']
    };
    for (let [id, val] of Object.entries(fieldMap)) {
        if (val !== undefined && document.getElementById(id)) {
            let display = (typeof val === 'number') ? val.toFixed(1) : val;
            if (id === 'runtime') display = Math.floor(val);
            document.getElementById(id).innerText = display;
        }
    }
    
    if (d['val-ect']) document.getElementById('fill-ect').style.width = Math.min(100, d['val-ect']/130*100)+'%';
    if (d['val-tps']) document.getElementById('fill-tps').style.width = Math.min(100, d['val-tps'])+'%';
    if (d['val-maf']) document.getElementById('fill-maf').style.width = Math.min(100, d['val-maf']/100*100)+'%';
    if (d['val-iat']) document.getElementById('fill-iat').style.width = Math.min(100, d['val-iat']/80*100)+'%';
    if (d['val-load']) document.getElementById('fill-load').style.width = Math.min(100, d['val-load'])+'%';
    if (d['val-fuel']) document.getElementById('fill-fuel').style.width = Math.min(100, d['val-fuel']/30*100)+'%';
    if (d['val-volt']) document.getElementById('fill-volt').style.width = Math.min(100, (d['val-volt']-10)/6*100)+'%';
    
    const setWave = (id, warn) => {
        const el = waves[id];
        if (el) warn ? el.classList.add('warning') : el.classList.remove('warning');
    };
    setWave('frontCenter', d.radarFrontCenter);
    setWave('frontLeft', d.radarFrontLeft);
    setWave('frontRight', d.radarFrontRight);
    setWave('rearLeft', d.radarRearLeft);
    setWave('rearRight', d.radarRearRight);
    
    const milIcon = document.getElementById('ind-checkengine');
    if (d.mil) milIcon.classList.add('danger');
    else milIcon.classList.remove('danger');
    
    updateAllCardsWarningStatus();
}

setInterval(fetchData, 500);
fetchData();

// ========== OTA UPDATE MODAL & WARNING SETTINGS ==========
const modal = document.getElementById('updateModal');
const updateBadge = document.getElementById('update-badge');
const closeBtn = document.querySelector('.close');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

if (updateBadge) {
    updateBadge.style.cursor = 'pointer';
    updateBadge.addEventListener('click', () => {
        if (modal) modal.style.display = 'block';
    });
}
if (closeBtn) closeBtn.onclick = () => { if (modal) modal.style.display = 'none'; };
window.onclick = (event) => {
    if (event.target == modal && modal) modal.style.display = 'none';
};

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tabContents.forEach(content => content.classList.remove('active'));
        const activeTab = document.getElementById(`${tabId}-tab`);
        if (activeTab) activeTab.classList.add('active');
        if (tabId === 'warning') {
            buildWarningSettingsForm();
        }
    });
});

function buildWarningSettingsForm() {
    const container = document.getElementById('warning-settings-grid');
    if (!container) return;
    container.innerHTML = '';
    warningParams.forEach(param => {
        const currentVal = warningThresholds[param.id];
        const displayVal = (currentVal !== undefined && currentVal !== null && currentVal !== '') ? currentVal : '';
        const div = document.createElement('div');
        div.className = 'warning-item';
        div.innerHTML = `
            <label>${param.label}</label>
            <input type="number" step="any" id="threshold-${param.id}" value="${displayVal}" class="threshold-input" data-id="${param.id}" placeholder="kosong = tanpa warning">
            <span class="unit">${param.unit}</span>
        `;
        container.appendChild(div);
    });
}

function initWarningSettingsEvents() {
    const saveBtn = document.getElementById('save-warning-settings');
    const resetBtn = document.getElementById('reset-warning-default');
    const statusDiv = document.getElementById('warning-settings-status');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            document.querySelectorAll('.threshold-input').forEach(input => {
                const id = input.getAttribute('data-id');
                let val = input.value.trim();
                if (val === '') {
                    warningThresholds[id] = null;
                } else {
                    let num = parseFloat(val);
                    if (!isNaN(num)) {
                        warningThresholds[id] = num;
                    } else {
                        warningThresholds[id] = null;
                    }
                }
            });
            saveWarningSettings();
            statusDiv.innerText = 'Pengaturan tersimpan!';
            setTimeout(() => { statusDiv.innerText = ''; }, 2000);
        });
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            warningParams.forEach(p => {
                warningThresholds[p.id] = p.default;
            });
            saveWarningSettings();
            buildWarningSettingsForm();
            statusDiv.innerText = 'Reset ke default!';
            setTimeout(() => { statusDiv.innerText = ''; }, 2000);
        });
    }
}

// Firmware upload
const firmwareForm = document.getElementById('firmware-form');
if (firmwareForm) {
    firmwareForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fileInput = document.getElementById('firmware-file');
        const file = fileInput.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('firmware', file);
        const progressDiv = document.getElementById('firmware-progress');
        progressDiv.innerText = 'Uploading firmware...';
        progressDiv.style.color = '#facc15';
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const res = await fetch('/update-firmware', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                progressDiv.innerText = 'Update success! Rebooting...';
                progressDiv.style.color = '#22c55e';
                setTimeout(() => location.reload(), 5000);
            } else {
                const text = await res.text();
                progressDiv.innerText = `Update failed: ${text}`;
                progressDiv.style.color = '#ef4444';
            }
        } catch(err) {
            progressDiv.innerText = `Error: ${err.message}`;
            progressDiv.style.color = '#ef4444';
        }
    });
}

async function uploadSpiffsFile(file, targetPath, progressDiv) {
    const formData = new FormData();
    formData.append('file', file);
    const url = '/update-spiffs?path=' + encodeURIComponent(targetPath);
    progressDiv.innerText = `Uploading ${file.name}...`;
    progressDiv.style.color = '#facc15';
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
            progressDiv.innerText = `${file.name} uploaded! Refresh page.`;
            progressDiv.style.color = '#22c55e';
            setTimeout(() => location.reload(), 2000);
        } else {
            const text = await res.text();
            progressDiv.innerText = `Failed: ${text}`;
            progressDiv.style.color = '#ef4444';
        }
    } catch(err) {
        progressDiv.innerText = `Error: ${err.message}`;
        progressDiv.style.color = '#ef4444';
    }
}

document.querySelectorAll('.spiffs-upload').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const targetFile = btn.getAttribute('data-file');
        let fileInput = null;
        if (targetFile === 'index.html') fileInput = document.getElementById('spiffs-file-index');
        else if (targetFile === 'style.css') fileInput = document.getElementById('spiffs-file-css');
        else if (targetFile === 'app.js') fileInput = document.getElementById('spiffs-file-js');
        else if (targetFile === 'car.png') fileInput = document.getElementById('spiffs-file-png');
        else if (targetFile === 'css/all.min.css') fileInput = document.getElementById('spiffs-file-cssfile');
        else if (targetFile === 'webfonts/') {
            fileInput = document.getElementById('spiffs-file-woff2');
            if (!fileInput.files[0]) return;
            const file = fileInput.files[0];
            const fullPath = 'webfonts/' + file.name;
            const progressDiv = document.getElementById('spiffs-progress');
            await uploadSpiffsFile(file, fullPath, progressDiv);
            return;
        }
        if (!fileInput || !fileInput.files[0]) return;
        const file = fileInput.files[0];
        const progressDiv = document.getElementById('spiffs-progress');
        await uploadSpiffsFile(file, targetFile, progressDiv);
    });
});

loadWarningSettings();
initWarningSettingsEvents();
buildWarningSettingsForm();