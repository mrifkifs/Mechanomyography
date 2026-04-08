/* ================================================
   Mechanomyography — Shared JS
   ================================================ */

const FB_URL      = 'https://send-mmg-default-rtdb.asia-southeast1.firebasedatabase.app';
const FB_REALTIME = `${FB_URL}/fsr/realtime.json`;
const FB_EVENTS   = `${FB_URL}/fsr/event.json?orderBy="$key"&limitToLast=50`;
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
function calcNorm(gender, age, weight) {
  const t = { male:[{m:20,b:40},{m:30,b:54},{m:40,b:52},{m:50,b:50},{m:60,b:46},{m:999,b:38}], female:[{m:20,b:24},{m:30,b:32},{m:40,b:31},{m:50,b:29},{m:60,b:26},{m:999,b:22}] };
  const r = (t[gender]||t.male).find(x=>age<x.m)||t.male[5];
  const base = r.b*(0.7+0.3*(weight/(gender==='male'?70:60)));
  return { min:Math.round(base*0.8*10)/10, avg:Math.round(base*10)/10, max:Math.round(base*1.2*10)/10 };
}
function setTSStatus(connected, msg) { const el=document.getElementById('antares-status'); const lbl=document.getElementById('antares-label'); if(!el||!lbl) return; lbl.textContent=msg||(connected?'Sensor terhubung':'Menunggu data sensor...'); el.classList.toggle('err',!connected); el.classList.add('show'); }

// SVG Export Generator
function exportToSVG(dataArr, titleText) {
    if (!dataArr || dataArr.length === 0) { showToast('Tidak ada data untuk diexport','error'); return; }
    const W = 800, H = 400, pad = 50;
    const maxVal = Math.max(...dataArr.map(d => d.force), 10);
    
    let pathD = "";
    dataArr.forEach((d, i) => {
        const x = pad + (i / (dataArr.length - 1 || 1)) * (W - pad * 2);
        const y = H - pad - (d.force / maxVal) * (H - pad * 2);
        pathD += (i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `);
    });

    const svgStr = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="background:#ffffff; font-family:sans-serif;">
            <rect width="100%" height="100%" fill="#ffffff"/>
            <text x="${W/2}" y="30" text-anchor="middle" font-size="20" font-weight="bold" fill="#333">${titleText}</text>
            <text x="${W/2}" y="50" text-anchor="middle" font-size="14" fill="#666">Max Force: ${maxVal.toFixed(2)} N</text>
            <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#ccc" stroke-width="2"/>
            <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" stroke="#ccc" stroke-width="2"/>
            <path d="${pathD}" fill="none" stroke="#20b2aa" stroke-width="3" stroke-linejoin="round"/>
        </svg>
    `;
    const win = window.open('', '_blank');
    win.document.write(`<html><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0;">${svgStr}</body></html>`);
    win.document.close();
}

(function injectCSS() {
  if(document.getElementById('myo-shared-css')) return;
  const s=document.createElement('style'); s.id='myo-shared-css';
  s.textContent=`:root{--bg:#f5f2ed;--bg2:#ede9e2;--surface:#fff;--border:#e0dbd3;--accent:#1a472a;--accent-l:#2d6a4f;--accent-p:#d8f0e0;--red:#c84b31;--red-p:#fde8e3;--yellow:#e8a838;--yellow-p:#fef3d8;--text:#1c1a17;--text2:#5a5649;--muted:#9a9489;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;min-height:100vh;}
  .topbar{position:sticky;top:0;z-index:99;background:rgba(245,242,237,.93);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:64px;}
  .logo{font-family:'DM Serif Display',serif;font-size:20px;color:var(--accent);display:flex;align-items:center;gap:10px;text-decoration:none;}
  .topbar-nav{display:flex;gap:4px;}
  .nav-a{padding:7px 16px;border-radius:8px;border:none;background:none;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;transition:all .2s;font-family:'Outfit',sans-serif;}
  .nav-a:hover{background:var(--bg2);color:var(--text);}
  .nav-a.active{background:var(--accent);color:#fff;}
  .u-avatar{width:36px;height:36px;background:var(--accent);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;}
  .wrap{max-width:1240px;margin:0 auto;padding:32px;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.05);}
  .card-title{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
  .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:10px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .2s;text-decoration:none;}
  .btn-p{background:var(--accent);color:#fff;} .btn-p:hover{background:var(--accent-l);}
  .btn-o{background:var(--surface);color:var(--text2);border:1.5px solid var(--border);} .btn-o:hover{border-color:var(--accent);color:var(--accent);}
  .btn-r{background:var(--red);color:#fff;} .btn-sm{padding:7px 14px;font-size:12px;}
  .btn-full{width:100%;justify-content:center;}
  .fg{margin-bottom:18px;}
  .flabel{display:block;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin-bottom:7px;}
  .finput{width:100%;padding:12px 16px;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;font-family:'Outfit',sans-serif;font-size:15px;color:var(--text);outline:none;transition:all .2s;}
  .finput:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(26,71,42,.1);}
  .err-box{background:var(--red-p);border:1px solid rgba(200,75,49,.3);color:var(--red);padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none;}
  .err-box.show{display:block;}
  .alrt{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:8px;}
  .alrt-warn{background:var(--yellow-p);border:1px solid rgba(232,168,56,.3);}
  .alrt-ok{background:var(--accent-p);border:1px solid rgba(26,71,42,.2);}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}
  .b-ok{background:var(--accent-p);color:var(--accent);}
  .b-warn{background:var(--yellow-p);color:var(--yellow);}
  .b-err{background:var(--red-p);color:var(--red);}
  .pbar{height:8px;background:var(--bg2);border-radius:4px;overflow:hidden;}
  .pfill{height:100%;border-radius:4px;transition:width .6s ease;}
  .ldot{width:7px;height:7px;background:#c84b31;border-radius:50%;animation:blink 1s infinite;display:inline-block;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
  .modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:200;}
  .modal-ov.show{display:flex;}
  .modal-box{background:var(--surface);border-radius:20px;padding:32px;max-width:460px;width:90%;animation:fu .3s ease;}
  @keyframes fu{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  #toast{position:fixed;bottom:24px;right:24px;background:#1c1a17;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;z-index:999;opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none;}
  #toast.show{opacity:1;transform:translateY(0);}
  #antares-status{position:fixed;top:70px;right:20px;background:#1c1a17;color:#fff;padding:6px 14px;border-radius:20px;font-size:11px;z-index:98;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .3s;}
  #antares-status.show{opacity:1;}
  #antares-status .adot{width:6px;height:6px;border-radius:50%;background:#4aeaaa;}
  #antares-status.err .adot{background:#e8a838;}
  .tbl{width:100%;border-collapse:collapse;}
  .tbl th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:10px 16px;border-bottom:1px solid var(--border);}
  .tbl td{padding:13px 16px;font-size:13px;border-bottom:1px solid var(--border);color:var(--text2);}
  .tbl tr:last-child td{border-bottom:none;}
  .tbl tr:hover td{background:var(--bg2);}
  .mono{font-family:'DM Mono',monospace;} .serif{font-family:'DM Serif Display',serif;}
  .muted{color:var(--muted);} .sm{font-size:13px;} .xs{font-size:11px;}
  .flex{display:flex;} .items-c{align-items:center;} .jb{justify-content:space-between;} .gap2{gap:8px;}
  .mt4{margin-top:16px;} .mt6{margin-top:24px;} .mb4{margin-bottom:16px;} .mb6{margin-bottom:24px;}
  .tc{text-align:center;}
  @media(max-width:900px){.g2,.g3{grid-template-columns:1fr;}.topbar-nav{display:none;}.wrap{padding:16px;}}`;
  document.head.appendChild(s);
  const l=document.createElement('link'); l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap'; document.head.prepend(l);
  const badge=document.createElement('div'); badge.id='antares-status'; badge.innerHTML='<div class="adot"></div><span id="antares-label">Menunggu data sensor...</span>'; document.body.appendChild(badge);
})();