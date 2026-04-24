
// ── ESNL Contabilidade v2 · Firebase Core ─────────────────────────────────
// © Rui Gonçalves · SNC-ESNL


const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBHAI-u6nuAcn2KWgoZwsavyXZY6o4JhA",
  authDomain: "esnl-contabilidade.firebaseapp.com",
  databaseURL: "https://esnl-contabilidade-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "esnl-contabilidade",
  storageBucket: "esnl-contabilidade.firebasestorage.app",
  messagingSenderId: "829122453343",
  appId: "1:829122453343:web:7a516be90941a4761320ea"
};

const ADMIN_HASH = "21e0969c3460872a571aaa26f3873ebdc315c8e9d30668f39a47579c67c2b338";

// Firebase SDK (v9 compat)
let _db = null;
let _fbReady = false;
let _fbCallbacks = [];

function onFirebaseReady(cb) {
  if (_fbReady) { cb(); } else { _fbCallbacks.push(cb); }
}

function initFirebase() {
  if (typeof firebase === 'undefined') { setTimeout(initFirebase, 100); return; }
  if (_db) return;
  try {
    const app = firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(FIREBASE_CONFIG);
    _db = firebase.database(app);
    _fbReady = true;
    _fbCallbacks.forEach(function(cb){ cb(); });
    _fbCallbacks = [];
  } catch(e) { console.error('Firebase init error:', e); }
}

// ── AUTH ───────────────────────────────────────────────────────────────────
function isLoggedIn() {
  return sessionStorage.getItem('esnl_auth') === '1';
}

function login(password, cb) {
  // SHA-256 da password
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
    .then(function(buf) {
      var hash = Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      if (hash === ADMIN_HASH) {
        sessionStorage.setItem('esnl_auth', '1');
        cb(true);
      } else {
        cb(false);
      }
    });
}

function logout() {
  sessionStorage.removeItem('esnl_auth');
  location.href = 'index.html';
}

function requireAuth() {
  if (!isLoggedIn()) { location.href = 'index.html'; return false; }
  return true;
}

// ── DATABASE ───────────────────────────────────────────────────────────────
function dbRef(path) {
  return _db ? _db.ref(path) : null;
}

function dbGet(path, cb) {
  onFirebaseReady(function() {
    _db.ref(path).once('value', function(snap) { cb(snap.val()); });
  });
}

function dbSet(path, data, cb) {
  onFirebaseReady(function() {
    _db.ref(path).set(data, function(err) { if(cb) cb(err); });
  });
}

function dbUpdate(path, data, cb) {
  onFirebaseReady(function() {
    _db.ref(path).update(data, function(err) { if(cb) cb(err); });
  });
}

function dbRemove(path, cb) {
  onFirebaseReady(function() {
    _db.ref(path).remove(function(err) { if(cb) cb(err); });
  });
}

function dbPush(path, data, cb) {
  onFirebaseReady(function() {
    var ref = _db.ref(path).push(data, function(err) { if(cb) cb(err, ref.key); });
  });
}

// ── ENTIDADES ──────────────────────────────────────────────────────────────
function getEntitiesLocal() {
  try { return JSON.parse(localStorage.getItem('esnl_entities_cache') || '[]'); }
  catch(e) { return []; }
}

function loadEntities(cb) {
  dbGet('entidades', function(data) {
    var arr = data ? Object.keys(data).map(function(k){ var e=data[k]; e.id=k; return e; }) : [];
    arr.sort(function(a,b){ return (a.nome||'').localeCompare(b.nome||''); });
    localStorage.setItem('esnl_entities_cache', JSON.stringify(arr));
    cb(arr);
  });
}

function saveEntity(entity, cb) {
  var id = entity.id || _db.ref('entidades').push().key;
  entity.id = id;
  dbSet('entidades/' + id, entity, function(err) {
    if (!err) {
      var arr = getEntitiesLocal();
      var idx = arr.findIndex(function(e){ return e.id===id; });
      if (idx>=0) arr[idx]=entity; else arr.push(entity);
      localStorage.setItem('esnl_entities_cache', JSON.stringify(arr));
    }
    if(cb) cb(err, id);
  });
}

function getCurrentEntityId() {
  return localStorage.getItem('esnl_current_entity') || '';
}

function setCurrentEntityId(id) {
  localStorage.setItem('esnl_current_entity', id);
}

// ── DIÁRIO ─────────────────────────────────────────────────────────────────
function loadDiario(entityId, ano, cb) {
  dbGet('diario/' + entityId + '/' + ano, function(data) {
    var arr = data ? Object.keys(data).map(function(k){ var l=data[k]; l.fbKey=k; return l; }) : [];
    arr.sort(function(a,b){ return (b.data||'').localeCompare(a.data||''); });
    cb(arr);
  });
}

function saveLancamento(entityId, ano, lanc, cb) {
  var path = 'diario/' + entityId + '/' + ano;
  if (lanc.fbKey) {
    dbSet(path + '/' + lanc.fbKey, lanc, cb);
  } else {
    dbPush(path, lanc, cb);
  }
}

function deleteLancamento(entityId, ano, fbKey, cb) {
  dbRemove('diario/' + entityId + '/' + ano + '/' + fbKey, cb);
}

// ── CÁLCULOS ───────────────────────────────────────────────────────────────
function calcResultadoFromLancs(lancs) {
  var rend=0, gasto=0, caixa=0, banco=0;
  lancs.forEach(function(l) {
    (l.movimentos||[]).forEach(function(m) {
      var v = m.dc==='D' ? m.valor : -m.valor;
      if (m.conta && m.conta.startsWith('11')) caixa += v;
      if (m.conta && (m.conta.startsWith('12')||m.conta.startsWith('13'))) banco += v;
      if (m.dc==='D' && m.tipo==='gasto') gasto += m.valor;
      if (m.dc==='C' && m.tipo==='rendimento') rend += m.valor;
    });
  });
  return { rend:rend, gasto:gasto, resultado:rend-gasto, caixa:Math.max(caixa,0), banco:Math.max(banco,0) };
}

// ── FORMATAÇÃO ─────────────────────────────────────────────────────────────
function fmt(v) {
  return parseFloat(v||0).toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtDate(d) {
  if(!d) return '';
  var p=d.split('-'); return p[2]+'/'+p[1]+'/'+p[0];
}
function hojeISO() {
  return new Date().toISOString().split('T')[0];
}
function hoje() {
  return new Date().toLocaleDateString('pt-PT',{day:'numeric',month:'long',year:'numeric'});
}

// ── TOAST ──────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  var t=document.getElementById('_toast');
  if(!t){
    t=document.createElement('div');t.id='_toast';
    t.style.cssText='position:fixed;bottom:20px;right:20px;background:#1a2a45;border:1px solid #c8943a;border-radius:8px;padding:10px 16px;font-size:13px;color:#e8edf5;box-shadow:0 8px 24px rgba(0,0,0,.5);transform:translateY(20px);opacity:0;transition:all .3s;z-index:9999;pointer-events:none;font-family:Outfit,sans-serif;max-width:320px';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.borderColor=type==='error'?'#e05050':'#c8943a';
  t.style.opacity='1';t.style.transform='translateY(0)';
  clearTimeout(t._tmr);
  t._tmr=setTimeout(function(){t.style.opacity='0';t.style.transform='translateY(20px)';},2800);
}

// ── SIDEBAR ────────────────────────────────────────────────────────────────
var _NAV=[
  {id:'dashboard', href:'dashboard.html', icon:'⊞',  label:'Dashboard'},
  {id:'entidades', href:'entidades.html', icon:'🏛️', label:'Entidades'},
  {id:'diario',    href:'diario.html',    icon:'📒',  label:'Diário'},
  {id:'efatura',   href:'efatura.html',   icon:'📥',  label:'Importar eFatura'},
  {id:'balancetes',href:'balancetes.html',icon:'📊',  label:'Balancetes'},
  {id:'balanco',   href:'balanco.html',   icon:'⚖️',  label:'Balanço · DRN'},
  {id:'documentos',href:'documentos.html',icon:'📄',  label:'Documentos'},
];
var _SECS=[
  {label:'Principal',     ids:['dashboard']},
  {label:'Contabilidade', ids:['entidades','diario','efatura']},
  {label:'Relatórios',    ids:['balancetes','balanco']},
  {label:'Documentos',    ids:['documentos']},
];

function buildSidebar(activeId) {
  var entities = getEntitiesLocal();
  var curId = getCurrentEntityId();
  var curEnt = entities.find(function(e){return e.id===curId;}) || entities[0] || {sigla:'—',nif:''};
  var html = '<div class="sidebar">'
    +'<div class="sb-logo"><div class="sb-logo-icon">Σ</div>'
    +'<div class="sb-logo-name">ESNL Contabilidade</div>'
    +'<div class="sb-logo-sub">Gestão para associações</div></div>'
    +'<div class="sb-entity" onclick="openEntitySwitcher()">'
    +'<div style="display:flex;align-items:center;justify-content:space-between">'
    +'<div style="display:flex;align-items:center;gap:6px">'
    +'<span class="sb-entity-dot"></span>'
    +'<span class="sb-entity-name">'+(curEnt.sigla||curEnt.nome||'—')+'</span></div>'
    +'<span style="font-size:10px;color:var(--silver)">▾</span></div>'
    +'<div class="sb-entity-sub">NIF '+(curEnt.nif||'—')+'</div></div>'
    +'<nav class="sb-nav">';
  _SECS.forEach(function(sec){
    html+='<div class="sb-section-label">'+sec.label+'</div>';
    sec.ids.forEach(function(id){
      var m=_NAV.find(function(x){return x.id===id;});
      if(!m) return;
      html+='<a href="'+m.href+'" class="nav-item'+(id===activeId?' active':'')+'">'
        +'<span class="nav-icon">'+m.icon+'</span>'
        +'<span class="nav-label">'+m.label+'</span></a>';
    });
  });
  html+='</nav>'
    +'<div class="sb-footer">'
    +'<button onclick="logout()" style="background:transparent;border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:6px 12px;font-size:11px;color:var(--silver);cursor:pointer;width:100%;font-family:Outfit,sans-serif;transition:all .2s" onmouseover="this.style.borderColor=\'var(--red)\';this.style.color=\'var(--red)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.08)\';this.style.color=\'var(--silver)\'">Terminar sessão</button>'
    +'<div class="sb-footer-copy" style="margin-top:8px">© Rui Gonçalves · SNC-ESNL</div>'
    +'</div></div>';
  return html;
}

function openEntitySwitcher() {
  if(document.getElementById('_es_ov')) return;
  var entities=getEntitiesLocal();
  var cur=getCurrentEntityId();
  var html='<div id="_es_ov" onclick="if(event.target===this)closeEntitySwitcher()" style="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:500;display:flex;align-items:flex-start;justify-content:flex-start;padding:70px 0 0 14px">'
    +'<div style="background:#111d35;border:1px solid rgba(200,148,58,.18);border-radius:12px;width:320px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6)">'
    +'<div style="padding:13px 16px;border-bottom:1px solid rgba(255,255,255,.06);font-family:Cormorant Garamond,serif;font-size:16px;font-weight:600;color:#e8edf5">Selecionar entidade</div>';
  entities.forEach(function(e){
    var sel=e.id===cur;
    html+='<div onclick="switchEntity(\''+e.id+'\')" style="padding:11px 16px;cursor:pointer;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(255,255,255,.04);transition:background .15s;background:'+(sel?'rgba(200,148,58,.08)':'transparent')+';border-left:'+(sel?'2px solid #c8943a':'2px solid transparent')+'">'
      +'<div style="width:34px;height:34px;border-radius:8px;background:#1a2a45;border:1px solid rgba(200,148,58,.2);display:flex;align-items:center;justify-content:center;font-family:Cormorant Garamond,serif;font-size:13px;font-weight:600;color:#e0a84a;flex-shrink:0">'+(e.sigla||e.nome.substring(0,2).toUpperCase())+'</div>'
      +'<div><div style="font-size:13px;font-weight:500;color:#e8edf5">'+e.nome+'</div><div style="font-size:11px;color:#8a9ab5;margin-top:2px">NIF '+(e.nif||'—')+'</div></div></div>';
  });
  html+='<div onclick="location.href=\'entidades.html\'" style="padding:11px 16px;cursor:pointer;display:flex;align-items:center;gap:11px">'
    +'<div style="width:34px;height:34px;border-radius:8px;background:rgba(200,148,58,.1);border:1px solid rgba(200,148,58,.3);display:flex;align-items:center;justify-content:center;font-size:18px;color:#e0a84a">+</div>'
    +'<div style="font-size:13px;font-weight:500;color:#e0a84a">Nova associação</div></div>'
    +'</div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
}

function closeEntitySwitcher(){var el=document.getElementById('_es_ov');if(el)el.remove();}

function switchEntity(id){
  setCurrentEntityId(id);
  closeEntitySwitcher();
  location.reload();
}

// ── CSS ────────────────────────────────────────────────────────────────────
(function(){
  if(document.getElementById('_esnl_css')) return;
  var s=document.createElement('style');
  s.id='_esnl_css';
  s.textContent='@import url(\'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap\');'
  +'*{box-sizing:border-box;margin:0;padding:0}'
  +':root{'
  +'--navy:#0b1426;--navy2:#111d35;--navy3:#1a2a45;--navy4:#243352;'
  +'--gold:#c8943a;--gold2:#e0a84a;'
  +'--silver:#8a9ab5;--silver2:#b0bfd4;'
  +'--bg:#0d1829;--surface:#111d35;--surface2:#162038;--surface3:#1e2e4a;'
  +'--text:#e8edf5;--text2:#a0b0c8;'
  +'--red:#e05050;--green:#4ab87a;--amber:#e0a040;--blue:#4a90d9;'
  +'--border:rgba(200,148,58,.18);--border2:rgba(255,255,255,.06);'
  +'--radius:12px;--radius-sm:8px;}'
  +'html,body{height:100%;background:var(--bg);color:var(--text);font-family:Outfit,sans-serif}'
  +'a{text-decoration:none;color:inherit}'
  +'.app-layout{display:grid;grid-template-columns:230px 1fr;min-height:100vh}'
  +'.app-main{display:flex;flex-direction:column;min-height:100vh;overflow:hidden}'
  +'.sidebar{background:var(--navy);border-right:1px solid var(--border);display:flex;flex-direction:column;height:100vh;position:sticky;top:0;overflow-y:auto}'
  +'.sidebar::-webkit-scrollbar{width:0}'
  +'.sb-logo{padding:20px 18px 16px;border-bottom:1px solid rgba(200,148,58,.12)}'
  +'.sb-logo-icon{width:38px;height:38px;background:linear-gradient(135deg,var(--gold),var(--gold2));border-radius:9px;display:flex;align-items:center;justify-content:center;font-family:Cormorant Garamond,serif;font-size:20px;font-weight:700;color:var(--navy);margin-bottom:10px}'
  +'.sb-logo-name{font-family:Cormorant Garamond,serif;font-size:17px;font-weight:600;line-height:1.2;color:var(--text)}'
  +'.sb-logo-sub{font-size:10px;color:var(--silver);letter-spacing:1.2px;text-transform:uppercase;margin-top:2px}'
  +'.sb-entity{padding:10px 14px;margin:10px 12px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-sm);cursor:pointer;transition:all .2s}'
  +'.sb-entity:hover{border-color:rgba(200,148,58,.3)}'
  +'.sb-entity-dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;margin-right:6px}'
  +'.sb-entity-name{font-size:12px;color:var(--text);font-weight:500}'
  +'.sb-entity-sub{font-size:10px;color:var(--silver);margin-top:2px}'
  +'.sb-nav{flex:1;padding:8px 0}'
  +'.sb-section-label{font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:var(--silver);padding:10px 18px 4px;opacity:.7}'
  +'.nav-item{display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;transition:all .2s;border-left:2px solid transparent;margin:1px 0;color:var(--text2)}'
  +'.nav-item:hover{background:rgba(255,255,255,.03);border-left-color:rgba(200,148,58,.3)}'
  +'.nav-item.active{background:rgba(200,148,58,.08);border-left-color:var(--gold)}'
  +'.nav-item.active .nav-label{color:var(--gold2);font-weight:500}'
  +'.nav-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0}'
  +'.nav-label{font-size:13px}'
  +'.sb-footer{padding:12px 14px;border-top:1px solid var(--border2)}'
  +'.sb-footer-copy{font-size:10px;color:var(--silver);text-align:center;letter-spacing:.3px}'
  +'.topbar{background:var(--navy2);border-bottom:1px solid var(--border2);padding:13px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}'
  +'.topbar-title{font-family:Cormorant Garamond,serif;font-size:20px;font-weight:600;color:var(--text)}'
  +'.topbar-right{display:flex;align-items:center;gap:8px}'
  +'.finput{width:100%;background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:9px 12px;font-size:13px;color:var(--text);font-family:Outfit,sans-serif;outline:none;transition:all .2s}'
  +'.finput:focus{border-color:var(--gold);background:var(--surface3);box-shadow:0 0 0 3px rgba(200,148,58,.08)}'
  +'.finput::placeholder{color:rgba(138,154,181,.45)}'
  +'select.finput option{background:var(--navy2)}'
  +'textarea.finput{resize:vertical;line-height:1.6}'
  +'.flabel{font-size:10px;font-weight:500;color:var(--silver2);letter-spacing:.8px;text-transform:uppercase;margin-bottom:5px;display:block}'
  +'.fgroup{margin-bottom:12px}'
  +'.btn-primary{background:var(--gold);color:var(--navy);border:none;border-radius:var(--radius-sm);padding:9px 20px;font-family:Outfit,sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;letter-spacing:.3px}'
  +'.btn-primary:hover{background:var(--gold2);transform:translateY(-1px);box-shadow:0 4px 14px rgba(200,148,58,.3)}'
  +'.btn-primary:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}'
  +'.btn-secondary{background:transparent;color:var(--text2);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:9px 16px;font-family:Outfit,sans-serif;font-size:13px;cursor:pointer;transition:all .2s}'
  +'.btn-secondary:hover{border-color:rgba(255,255,255,.2);color:var(--text)}'
  +'.btn-danger{background:transparent;color:var(--red);border:1px solid rgba(224,80,80,.25);border-radius:var(--radius-sm);padding:8px 16px;font-family:Outfit,sans-serif;font-size:13px;cursor:pointer;transition:all .2s}'
  +'.btn-danger:hover{background:rgba(224,80,80,.08);border-color:var(--red)}'
  +'.mono{font-family:JetBrains Mono,monospace}'
  +'.val-pos{color:var(--green);font-family:JetBrains Mono,monospace}'
  +'.val-neg{color:var(--red);font-family:JetBrains Mono,monospace}'
  +'.val-neu{color:var(--text2);font-family:JetBrains Mono,monospace}'
  +'@media print{.sidebar,.topbar,.no-print{display:none!important}.app-layout{display:block}body{background:#fff;color:#000}}';
  var first=document.head.firstChild;
  if(first) document.head.insertBefore(s,first); else document.head.appendChild(s);
})();

// Auto-init Firebase
initFirebase();
