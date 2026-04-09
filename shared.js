/* ================================================
   Mechanomyography — Shared JS
   Platform: ThingSpeak IoT / Firebase
   ================================================ */

const FB_URL      = 'https://send-mmg-default-rtdb.asia-southeast1.firebasedatabase.app';
const FB_REALTIME = `${FB_URL}/fsr/realtime.json`;
const FB_EVENTS   = `${FB_URL}/fsr/event.json?orderBy="$key"&limitToLast=100`;
const FB_CONTROL  = `${FB_URL}/fsr/control.json`;

const DB = {
  getUsers:     () => JSON.parse(localStorage.getItem('myo_users')    || '[]'),
  saveUsers:    (u) => localStorage.setItem('myo_users',    JSON.stringify(u)),
  getSessions:  () => JSON.parse(localStorage.getItem('myo_sessions') || '[]'),
  saveSessions: (s) => localStorage.setItem('myo_sessions', JSON.stringify(s)),
};

const API = {
  register: async (p) => {
    const users = DB.getUsers();
    if (users.find(u => u.email === p.email)) throw new Error('Email sudah terdaftar.');
    const user = { id: Date.now(), ...p };
    users.push(user); DB.saveUsers(users);
    return { token: 'local_' + Date.now(), user };
  },
  login: async (email, password) => {
    const user = DB.getUsers().find(u => u.email === email && u.password === password);
    if (!user) throw new Error('Email atau password salah.');
    return { token: 'local_' + Date.now(), user };
  },
  updateProfile: async (updatedData) => {
    const users = DB.getUsers();
    const idx = users.findIndex(u => u.id === Auth.user().id);
    if (idx > -1) {
      users[idx] = { ...users[idx], ...updatedData };
      DB.saveUsers(users);
      Auth.save(localStorage.getItem('myo_token'), users[idx]);
    }
  },
  logout:     async () => ({ message: 'ok' }),
  startSession: async () => {
    const sessions = DB.getSessions();
    const session = { id: Date.now(), user_id: Auth.user()?.id, started_at: new Date().toISOString(), ended_at: null };
    sessions.push(session); DB.saveSessions(sessions);
    return { session };
  },
  endSession: async (id, summary) => {
    const sessions = DB.getSessions();
    const idx = sessions.findIndex(s => s.id == id);
    if (idx !== -1) { sessions[idx] = { ...sessions[idx], ended_at: new Date().toISOString(), ...summary }; DB.saveSessions(sessions); }
    return { session: sessions[idx] };
  },
  deleteSession: async (id) => {
    let sessions = DB.getSessions();
    sessions = sessions.filter(s => s.id != id);
    DB.saveSessions(sessions);
  },
  getSessions: async () => {
    const uid = Auth.user()?.id;
    const all = DB.getSessions().filter(s => s.user_id == uid && s.ended_at).reverse();
    return { data: all, total: all.length };
  },
  pushMmgBatch: async (sid, readings) => ({ saved: readings.length }),
  getProgressReport: async () => {
    const uid      = Auth.user()?.id;
    const sessions = DB.getSessions().filter(s => s.user_id == uid && s.ended_at).reverse();
    const last     = sessions[0] || null;
    return { latest_grip_pct: last?.avg_grip_pct ?? null, total_sessions: sessions.length, last_session: last, alerts: [] };
  }
};

const Firebase = {
  fetchLatest: async () => {
    try {
      const res = await fetch(FB_REALTIME);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || json.force === undefined) return null;
      return { force: parseFloat(json.force || 0), status: json.status || '—', timestamp: Date.now() };
    } catch (e) { return null; }
  },
  fetchEvents: async () => {
    try {
      const res = await fetch(FB_EVENTS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json) return [];
      return Object.entries(json).map(([key, val]) => ({
        force: parseFloat(val.force || 0), status: val.status || '—', timestamp: parseInt(key),
      })).sort((a,b) => a.timestamp - b.timestamp);
    } catch (e) { return []; }
  },
  startPolling: (callback, intervalMs = 2000) => {
    let lastForce = -1;
    const poll = async () => {
      const data = await Firebase.fetchLatest();
      if (data && data.force !== lastForce) {
        lastForce = data.force;
        callback(data);
        setTSStatus(true, 'Sensor terhubung ✓');
      }
    };
    poll();
    const timer = setInterval(poll, intervalMs);
    return () => clearInterval(timer);
  },
  setDevicePower: async (isOn) => {
    try {
      await fetch(FB_CONTROL, { method: 'PUT', body: JSON.stringify({ power: isOn ? 1 : 0 }) });
    } catch(e) { console.warn("Gagal mengirim perintah ke alat"); }
  }
};

const Auth = {
  save:         (token, user) => { localStorage.setItem('myo_token', token); localStorage.setItem('myo_user', JSON.stringify(user)); },
  user:         () => { try { return JSON.parse(localStorage.getItem('myo_user')); } catch { return null; } },
  isLoggedIn:   () => !!localStorage.getItem('myo_token'),
  clear:        () => { localStorage.removeItem('myo_token'); localStorage.removeItem('myo_user'); },
  requireLogin: () => { if (!Auth.isLoggedIn()) { location.href = 'login.html'; return null; } return Auth.user(); },
  fillTopbar:   () => { const u = Auth.user(); if (!u) return; const a = document.getElementById('top-avatar'); if (a) a.textContent = u.name[0].toUpperCase(); const n = document.getElementById('top-name'); if (n) n.textContent = u.name; },
  logout: async () => { try { await API.logout(); } catch {} Auth.clear(); location.href = 'login.html'; }
};

function showToast(msg, type='info') { const t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.style.background=type==='error'?'#c84b31':type==='success'?'#2d6a4f':'#1c1a17'; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3200); }
function setText(id, val) { const e=document.getElementById(id); if(e) e.textContent=val; }
function formatDate(iso) { if(!iso) return '—'; const d=new Date(iso); return `${['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()]}, ${d.getDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][d.getMonth()]} ${d.getFullYear()}`; }
function formatDur(s) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function getGreeting(name) { const h=new Date().getHours(); return `Selamat ${h<12?'pagi':h<15?'siang':h<18?'sore':'malam'}, ${name.split(' ')[0]} \u{1F44B}`; }
function setTSStatus(connected, msg) { const el=document.getElementById('antares-status'); const lbl=document.getElementById('antares-label'); if(!el||!lbl) return; lbl.textContent=msg||(connected?'Sensor terhubung':'Menunggu data sensor...'); el.classList.toggle('err',!connected); el.classList.add('show'); }

// =====================================================================
// RUMUS NORMATIF KEKUATAN OTOT (BERDASARKAN JURNAL MEDIS 2023-2024)
// Sumber 1: "Normative data for handgrip strength..." (2022) - PMC8902402
// Sumber 2: "Hand grip strength should be normalized by weight" (Wang et al., 2023) - PMC9890066
// =====================================================================
function calcNorm(gender, age, weight) {
  let baseKg = gender === 'male' ? 49.7 : 29.7;
  let idealW = gender === 'male' ? 70 : 60;
  
  let ageFactor = 1.0;
  if (age >= 40 && age < 50) ageFactor = 0.95;
  else if (age >= 50 && age < 60) ageFactor = 0.85;
  else if (age >= 60 && age < 70) ageFactor = 0.75;
  else if (age >= 70) ageFactor = 0.65;
  
  let weightDiff = weight - idealW;
  let weightFactor = 1 + (weightDiff * 0.005); 
  if (weightFactor > 1.15) weightFactor = 1.15; 
  if (weightFactor < 0.85) weightFactor = 0.85;
  
  let targetKg = baseKg * ageFactor * weightFactor;
  
  return { 
    min: parseFloat((targetKg * 0.7 * 9.806).toFixed(2)),   // Batas Sedang/Lemah
    avg: parseFloat((targetKg * 9.806).toFixed(2)),         // Target Normal
    max: parseFloat((targetKg * 1.2 * 9.806).toFixed(2))    // Maksimal Kuat
  };
}

// SVG Export — Profesional, detail, dengan grid, legend, statistik, dan warna status
function exportToSVG(dataArr, titleText) {
    if (!dataArr || dataArr.length === 0) {
        showToast('Tidak ada data untuk diexport', 'error');
        return;
    }
    const u = Auth.user() || {};
    const norm = calcNorm(u.gender||'male', u.age||25, u.weight||70);
    const normMinN = norm.min, normAvgN = norm.avg, normMaxN = norm.max;

    const W = 1000, H = 580;
    const padL = 80, padR = 40, padT = 110, padB = 80;
    const cW = W - padL - padR, cH = H - padT - padB;

    const forces = dataArr.map(d => d.force);
    const maxVal = Math.max(...forces, normAvgN * 1.2);
    const avgVal = forces.reduce((a,b)=>a+b,0)/forces.length;
    const maxF   = Math.max(...forces);
    const minF   = Math.min(...forces);

    const toX = i => padL + (i / Math.max(dataArr.length - 1, 1)) * cW;
    const toY = v => padT + cH - (v / maxVal) * cH;

    // Path garis utama
    let pathD = dataArr.map((d,i) => `${i===0?'M':'L'} ${toX(i).toFixed(1)} ${toY(d.force).toFixed(1)}`).join(' ');
    // Area fill
    let areaD = pathD + ` L ${toX(dataArr.length-1).toFixed(1)} ${(padT+cH).toFixed(1)} L ${toX(0).toFixed(1)} ${(padT+cH).toFixed(1)} Z`;

    // Data points warna sesuai status
    let dots = '';
    const step = Math.max(1, Math.floor(dataArr.length / 30));
    dataArr.forEach((d, i) => {
        if (i % step !== 0 && i !== dataArr.length - 1) return;
        const x = toX(i), y = toY(d.force);
        const col = d.force >= normAvgN ? '#16a34a' : d.force >= normMinN ? '#e8a838' : '#dc2626';
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${col}" stroke="#fff" stroke-width="1.5" opacity="0.9"/>`;
    });

    // Grid lines + labels Y
    let grid = '', yLbls = '';
    const ySteps = 6;
    for (let i=0; i<=ySteps; i++) {
        const v = (maxVal * i/ySteps);
        const y = toY(v);
        grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="#e8e8e8" stroke-width="${i===0?1.5:1}" stroke-dasharray="${i===0?'none':'5 4'}"/>`;
        yLbls += `<text x="${padL-10}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="12" fill="#888" font-family="sans-serif">${v.toFixed(1)} N</text>`;
    }

    // Labels X (sparse)
    let xLbls = '';
    const xStep = Math.max(1, Math.floor(dataArr.length / 8));
    dataArr.forEach((d, i) => {
        if (i % xStep !== 0 && i !== dataArr.length - 1) return;
        const x = toX(i);
        const lbl = new Date(d.timestamp).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
        xLbls += `<text x="${x.toFixed(1)}" y="${(padT+cH+18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#888" font-family="sans-serif">${lbl}</text>`;
    });

    // Reference lines
    const yAvg = toY(normAvgN), yMin = toY(normMinN);
    const refLines = `
      <line x1="${padL}" y1="${yAvg.toFixed(1)}" x2="${W-padR}" y2="${yAvg.toFixed(1)}" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="7 4" opacity="0.8"/>
      <rect x="${W-padR-90}" y="${(yAvg-16).toFixed(1)}" width="88" height="18" rx="4" fill="#f0fdf4" stroke="#bbf7d0"/>
      <text x="${W-padR-46}" y="${(yAvg-3).toFixed(1)}" text-anchor="middle" font-size="11" fill="#16a34a" font-family="sans-serif" font-weight="bold">Target ${normAvgN.toFixed(1)} N</text>
      <line x1="${padL}" y1="${yMin.toFixed(1)}" x2="${W-padR}" y2="${yMin.toFixed(1)}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.7"/>
      <rect x="${W-padR-80}" y="${(yMin+2).toFixed(1)}" width="78" height="18" rx="4" fill="#fef2f2" stroke="#fecaca"/>
      <text x="${W-padR-41}" y="${(yMin+15).toFixed(1)}" text-anchor="middle" font-size="11" fill="#dc2626" font-family="sans-serif" font-weight="bold">Min ${normMinN.toFixed(1)} N</text>
    `;

    // Statistik box kanan atas
    const kualitas = avgVal >= normAvgN ? 'Sangat Baik' : avgVal >= normMinN ? 'Baik' : 'Perlu Peningkatan';
    const statBox = `
      <rect x="${W-padR-220}" y="10" width="218" height="90" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
      <text x="${W-padR-110}" y="28" text-anchor="middle" font-size="11" fill="#888" font-family="sans-serif" font-weight="bold" letter-spacing="0.05em">RINGKASAN STATISTIK</text>
      <text x="${W-padR-210}" y="46" font-size="12" fill="#333" font-family="sans-serif">Rata-rata: <tspan font-weight="bold" fill="#0891b2">${avgVal.toFixed(3)} N</tspan></text>
      <text x="${W-padR-210}" y="62" font-size="12" fill="#333" font-family="sans-serif">Tertinggi: <tspan font-weight="bold" fill="#16a34a">${maxF.toFixed(3)} N</tspan>  Terendah: <tspan font-weight="bold" fill="#dc2626">${minF.toFixed(3)} N</tspan></text>
      <text x="${W-padR-210}" y="78" font-size="12" fill="#333" font-family="sans-serif">Kondisi: <tspan font-weight="bold" fill="#1a472a">${kualitas}</tspan></text>
      <text x="${W-padR-210}" y="94" font-size="11" fill="#aaa" font-family="sans-serif">Total: ${dataArr.length} data | Target: ${normAvgN.toFixed(2)} N</text>
    `;

    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="font-family:sans-serif;background:#ffffff;">
      <defs>
        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0891b2" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#0891b2" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <!-- Background -->
      <rect width="${W}" height="${H}" fill="#ffffff"/>
      <rect x="0" y="0" width="${W}" height="8" fill="#0891b2"/>
      <!-- Title -->
      <text x="${padL}" y="35" font-size="18" font-weight="bold" fill="#1c1a17" font-family="sans-serif">${titleText}</text>
      <text x="${padL}" y="55" font-size="12" fill="#888" font-family="sans-serif">Pasien: ${u.name||'—'} | ${new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</text>
      <text x="${padL}" y="72" font-size="11" fill="#aaa" font-family="sans-serif">Sistem Monitoring Mechanomyography — BRIN KST Samaun Samadikun</text>
      ${statBox}
      <!-- Grid -->
      ${grid}
      <!-- Area -->
      <path d="${areaD}" fill="url(#ag)"/>
      <!-- Reference lines -->
      ${refLines}
      <!-- Main line -->
      <path d="${pathD}" fill="none" stroke="#0891b2" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <!-- Data points -->
      ${dots}
      <!-- Axes -->
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+cH}" stroke="#ccc" stroke-width="1.5"/>
      <line x1="${padL}" y1="${padT+cH}" x2="${W-padR}" y2="${padT+cH}" stroke="#ccc" stroke-width="1.5"/>
      <!-- Y labels -->
      ${yLbls}
      <!-- X labels -->
      ${xLbls}
      <!-- Axis titles -->
      <text x="${padL/2 - 5}" y="${padT + cH/2}" transform="rotate(-90 ${padL/2 - 5} ${padT + cH/2})" text-anchor="middle" font-size="13" font-weight="bold" fill="#555" font-family="sans-serif">Kekuatan Otot (Newton)</text>
      <text x="${padL + cW/2}" y="${H - 10}" text-anchor="middle" font-size="13" font-weight="bold" fill="#555" font-family="sans-serif">Waktu Perekaman</text>
      <!-- Legend -->
      <circle cx="${padL}" cy="${H-22}" r="5" fill="#0891b2"/>
      <text x="${padL+12}" y="${H-18}" font-size="11" fill="#555" font-family="sans-serif">Force Sensor (N)</text>
      <line x1="${padL+130}" y1="${H-22}" x2="${padL+155}" y2="${H-22}" stroke="#16a34a" stroke-width="2" stroke-dasharray="5 3"/>
      <text x="${padL+160}" y="${H-18}" font-size="11" fill="#16a34a" font-family="sans-serif">Target Normal</text>
      <line x1="${padL+260}" y1="${H-22}" x2="${padL+285}" y2="${H-22}" stroke="#dc2626" stroke-width="2" stroke-dasharray="4 3"/>
      <text x="${padL+290}" y="${H-18}" font-size="11" fill="#dc2626" font-family="sans-serif">Batas Minimal</text>
      <circle cx="${padL+390}" cy="${H-22}" r="5" fill="#16a34a" stroke="#fff" stroke-width="1.5"/>
      <text x="${padL+400}" y="${H-18}" font-size="11" fill="#555" font-family="sans-serif">Normal</text>
      <circle cx="${padL+460}" cy="${H-22}" r="5" fill="#e8a838" stroke="#fff" stroke-width="1.5"/>
      <text x="${padL+470}" y="${H-18}" font-size="11" fill="#555" font-family="sans-serif">Sedang</text>
      <circle cx="${padL+520}" cy="${H-22}" r="5" fill="#dc2626" stroke="#fff" stroke-width="1.5"/>
      <text x="${padL+530}" y="${H-18}" font-size="11" fill="#555" font-family="sans-serif">Rendah</text>
    </svg>`;

    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `Grafik_MMG_${new Date().getTime()}.svg`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('Grafik SVG berhasil diunduh ✓', 'success');
}

(function injectCSS() {
  if(document.getElementById('myo-shared-css')) return;
  const s=document.createElement('style'); s.id='myo-shared-css';
  s.textContent=`:root{--bg:#f5f2ed;--bg2:#ede9e2;--surface:#fff;--border:#e0dbd3;--accent:#1a472a;--accent-l:#2d6a4f;--accent-p:#d8f0e0;--red:#c84b31;--red-p:#fde8e3;--yellow:#e8a838;--yellow-p:#fef3d8;--text:#1c1a17;--text2:#5a5649;--muted:#9a9489;} *{box-sizing:border-box;margin:0;padding:0;} body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;min-height:100vh;} .topbar{position:sticky;top:0;z-index:99;background:rgba(245,242,237,.93);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:64px;} .logo{font-family:'DM Serif Display',serif;font-size:20px;color:var(--accent);display:flex;align-items:center;gap:10px;text-decoration:none;} .topbar-nav{display:flex;gap:4px;} .nav-a{padding:7px 16px;border-radius:8px;border:none;background:none;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;transition:all .2s;font-family:'Outfit',sans-serif;} .nav-a:hover{background:var(--bg2);color:var(--text);} .nav-a.active{background:var(--accent);color:#fff;} .u-avatar{width:36px;height:36px;background:var(--accent);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;} .wrap{max-width:1240px;margin:0 auto;padding:32px;} .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.05);} .card-title{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;} .g2{display:grid;grid-template-columns:1fr 1fr;gap:20px;} .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;} .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:10px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .2s;text-decoration:none;} .btn-p{background:var(--accent);color:#fff;} .btn-p:hover{background:var(--accent-l);} .btn-o{background:var(--surface);color:var(--text2);border:1.5px solid var(--border);} .btn-o:hover{border-color:var(--accent);color:var(--accent);} .btn-r{background:var(--red);color:#fff;} .btn-sm{padding:7px 14px;font-size:12px;} .btn-full{width:100%;justify-content:center;} .fg{margin-bottom:18px;} .flabel{display:block;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin-bottom:7px;} .finput{width:100%;padding:12px 16px;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;font-family:'Outfit',sans-serif;font-size:15px;color:var(--text);outline:none;transition:all .2s;} .finput:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(26,71,42,.1);} .err-box{background:var(--red-p);border:1px solid rgba(200,75,49,.3);color:var(--red);padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none;} .err-box.show{display:block;} .alrt{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:8px;} .alrt-warn{background:var(--yellow-p);border:1px solid rgba(232,168,56,.3);} .alrt-ok{background:var(--accent-p);border:1px solid rgba(26,71,42,.2);} .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;} .b-ok{background:var(--accent-p);color:var(--accent);} .b-warn{background:var(--yellow-p);color:var(--yellow);} .b-err{background:var(--red-p);color:var(--red);} .pbar{height:8px;background:var(--bg2);border-radius:4px;overflow:hidden;} .pfill{height:100%;border-radius:4px;transition:width .6s ease;} .ldot{width:7px;height:7px;background:#c84b31;border-radius:50%;animation:blink 1s infinite;display:inline-block;} @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}} .modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:200;} .modal-ov.show{display:flex;} .modal-box{background:var(--surface);border-radius:20px;padding:32px;max-width:460px;width:90%;animation:fu .3s ease;} @keyframes fu{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} #toast{position:fixed;bottom:24px;right:24px;background:#1c1a17;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;z-index:999;opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none;} #toast.show{opacity:1;transform:translateY(0);} #antares-status{position:fixed;top:70px;right:20px;background:#1c1a17;color:#fff;padding:6px 14px;border-radius:20px;font-size:11px;z-index:98;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .3s;} #antares-status.show{opacity:1;} #antares-status .adot{width:6px;height:6px;border-radius:50%;background:#4aeaaa;} #antares-status.err .adot{background:#e8a838;} .tbl{width:100%;border-collapse:collapse;} .tbl th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:10px 16px;border-bottom:1px solid var(--border);} .tbl td{padding:13px 16px;font-size:13px;border-bottom:1px solid var(--border);color:var(--text2);} .tbl tr:last-child td{border-bottom:none;} .tbl tr:hover td{background:var(--bg2);} .mono{font-family:'DM Mono',monospace;} .serif{font-family:'DM Serif Display',serif;} .muted{color:var(--muted);} .sm{font-size:13px;} .xs{font-size:11px;} .flex{display:flex;} .items-c{align-items:center;} .jb{justify-content:space-between;} .gap2{gap:8px;} .mt4{margin-top:16px;} .mt6{margin-top:24px;} .mb4{margin-bottom:16px;} .mb6{margin-bottom:24px;} .tc{text-align:center;} @media(max-width:900px){.g2,.g3{grid-template-columns:1fr;}.topbar-nav{display:none;}.wrap{padding:16px;}}`;
  document.head.appendChild(s);
  const l=document.createElement('link'); l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap'; document.head.prepend(l);
  const badge=document.createElement('div'); badge.id='antares-status'; badge.innerHTML='<div class="adot"></div><span id="antares-label">Menunggu data sensor...</span>'; document.body.appendChild(badge);
})();