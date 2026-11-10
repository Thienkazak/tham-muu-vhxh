// [STR-01] TRẠNG THÁI HỆ THỐNG, TỰ NHẬN LINK #PIN= & BẢNG NHẮC ĐẦU TRANG
window.APP_STATE = {
  profile: null,
  api: { key: '', internalPin: '', primaryModel: 'gemini-3.5-flash', liveModels: [] },
  workspaces: [],
  activeTabId: '',
  dirHandle: null,
  dirWritable: false,
  cabinetCollapsed: false,
  cabinetFiles: []
};

var autoSaveTimer = null;
var autoDiskTimer = null;
var snapshotFlashTimer = null;
var isApplyingTabToDOM = false;
var MAX_OPEN_TABS = 15;
var MAX_SNAPSHOTS = 10;

function el(id) { return document.getElementById(id); }
function setVal(id, val) { var n = el(id); if (n) n.value = (val !== undefined && val !== null) ? val : ''; }
function getVal(id) { var n = el(id); return n ? String(n.value || '').trim() : ''; }
function openModalSafe(id) { var m = el(id); if (m) { m.classList.remove('hidden'); m.classList.add('flex'); } }
function closeModalSafe(id) { var m = el(id); if (m) { m.classList.remove('flex'); m.classList.add('hidden'); } }

function formatTimeHHMMSS(ts) {
  var d = new Date(ts || Date.now());
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

function slugifyFileName(str) {
  var s = (str || 'Van_ban').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'Van_ban').substring(0, 42);
}

function setDefaultQuickPromptInInput() {
  var defTxt = APP_CONFIG.defaultPrompt || 'Hãy tham mưu soạn thảo đầy đủ văn bản từ tài liệu đề bài và hồ sơ đính kèm, đúng thể thức Nghị định 30.';
  if (el('aiPromptInput')) el('aiPromptInput').value = defTxt;
  document.querySelectorAll('.quick-prompt-btn').forEach(function(b) {
    var isDef = b.id === 'btnQuickDefault';
    b.className = 'quick-prompt-btn h-10 text-[10.5px] leading-tight rounded-md flex items-center justify-center text-center px-1 transition '
      + (isDef ? 'bg-purple-100 border border-purple-400 text-purple-900 font-semibold' : 'bg-white hover:bg-purple-50 border border-slate-300 text-slate-700 font-medium');
  });
}

function openLocalDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('TroLyThamMuu_VHXH_DB', 2);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('app_state')) db.createObjectStore('app_state');
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

async function saveDirHandleToDB(handle) {
  try {
    var db = await openLocalDB();
    var tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'cabinet_dir');
    tx.oncomplete = function() { db.close(); };
  } catch (err) {}
}

async function loadDirHandleFromDB() {
  try {
    var db = await openLocalDB();
    return await new Promise(function(resolve) {
      var tx = db.transaction('handles', 'readonly');
      var req = tx.objectStore('handles').get('cabinet_dir');
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { resolve(null); };
      tx.oncomplete = function() { db.close(); };
    });
  } catch (err) { return null; }
}

// [STR-02] CHỤP NỘI DUNG GIẤY A4 & LƯU TỰ ĐỘNG 3 TẦNG
function getActiveTab() {
  return APP_STATE.workspaces.find(function(t) { return t.id === APP_STATE.activeTabId; }) || APP_STATE.workspaces[0] || null;
}

function deriveShortTabTitle(tab) {
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
  var rawSub = docType.isCongVan ? (tab.cvSubject || '') : (tab.namedSub || '');
  var clean = rawSub.replace(/^(V\/v|Về việc)\s*/i, '').replace(/^\.+$/, '').replace(/\s+/g, ' ').trim();
  if (!clean) clean = docType.name + ' mới';
  if (clean.length > 22) clean = clean.substring(0, 22) + '...';
  return '[' + docType.code + '] ' + clean;
}

function captureDOMIntoActiveTab(forceCapture) {
  if (isApplyingTabToDOM && !forceCapture) return getActiveTab();
  var tab = getActiveTab();
  if (!tab) return null;

  if (el('a4OrgLine1')) tab.orgLine1 = el('a4OrgLine1').textContent;
  if (el('a4OrgLine2')) tab.orgLine2 = el('a4OrgLine2').textContent;
  if (el('a4DocNumber')) tab.docNumber = el('a4DocNumber').textContent;
  if (el('a4CvSubject')) tab.cvSubject = el('a4CvSubject').textContent.trim();
  if (el('a4DateLine')) tab.dateLine = el('a4DateLine').textContent;
  if (el('a4DocTypeName')) tab.docTypeName = el('a4DocTypeName').textContent;
  if (el('a4NamedSub')) tab.namedSub = el('a4NamedSub').textContent.trim();
  if (el('a4DearLine')) tab.dearLine = el('a4DearLine').textContent.trim();
  if (el('a4BodyContent')) tab.bodyHtml = el('a4BodyContent').innerHTML;
  if (el('a4Recipients')) tab.recipients = el('a4Recipients').innerText;
  if (el('a4SignerAuth')) tab.signerAuth = el('a4SignerAuth').innerText;
  if (el('a4SignerName')) tab.signerName = el('a4SignerName').textContent;
  if (el('fontSizeSelect')) tab.fontSize = el('fontSizeSelect').value || '14pt';
  tab.updatedAt = Date.now();
  tab.title = deriveShortTabTitle(tab);
  return tab;
}

function setSaveBadgeStatus(mode, text) {
  var badge = el('saveStatusBadge');
  if (!badge) return;
  badge.className = (mode === 'saving' ? 'text-amber-300' : 'text-emerald-400') + ' flex items-center gap-1 font-medium';
  badge.innerHTML = (mode === 'saving' ? '<i class="fa-solid fa-spinner fa-spin"></i> ' : '<i class="fa-solid fa-shield-halved"></i> ') + text;
}

async function persistWorkspacesNow() {
  var payload = { activeTabId: APP_STATE.activeTabId, workspaces: APP_STATE.workspaces, savedAt: Date.now() };
  try { localStorage.setItem('tmv_workspaces_v2', JSON.stringify(payload)); } catch (e) {}
  try {
    var db = await openLocalDB();
    var tx = db.transaction('app_state', 'readwrite');
    tx.objectStore('app_state').put(payload, 'workspaces_bundle');
    tx.oncomplete = function() { db.close(); };
  } catch (err) {}
  setSaveBadgeStatus('saved', 'Đã lưu ' + formatTimeHHMMSS(payload.savedAt));
}

function scheduleAutoSave() {
  if (isApplyingTabToDOM) return;
  setSaveBadgeStatus('saving', 'Đang lưu...');
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async function() {
    autoSaveTimer = null;
    var tab = captureDOMIntoActiveTab(false);
    renderWorkspaceTabsBar();
    await persistWorkspacesNow();
    if (tab && APP_STATE.dirHandle && APP_STATE.dirWritable) scheduleAutoDiskWrite(tab);
  }, 500);
}
function scheduleAutoDiskWrite(tab) {
  if (autoDiskTimer) clearTimeout(autoDiskTimer);
  autoDiskTimer = setTimeout(function() { autoDiskTimer = null; writeTabTmvToDisk(tab, false); }, 2000);
}

async function writeTabTmvToDisk(tab, allowBrowserDownload) {
  if (!tab) return;
  var fileName = 'DangSoan_' + tab.docType + '_' + slugifyFileName(tab.namedSub || tab.cvSubject) + '_' + tab.id.slice(-4) + '.tmv';
  var contentStr = JSON.stringify({ app: 'TroLyThamMuu_VHXH', version: '1.2', exportedAt: new Date().toISOString(), tab: tab }, null, 2);

  if (APP_STATE.dirHandle && APP_STATE.dirWritable) {
    try {
      var subDir = await APP_STATE.dirHandle.getDirectoryHandle(APP_CONFIG.defaultOrg.draftSubfolder, { create: true });
      var fileHandle = await subDir.getFileHandle(fileName, { create: true });
      var writable = await fileHandle.createWritable();
      await writable.write(contentStr);
      await writable.close();
      if (el('diskStatusBadge')) el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> Ổ cứng (' + formatTimeHHMMSS() + ')';
      if (allowBrowserDownload) alert('Đã lưu [' + fileName + '] vào thư mục ' + APP_CONFIG.defaultOrg.draftSubfolder + ' trên ổ cứng!');
      return;
    } catch (err) {}
  }

  if (allowBrowserDownload) {
    var blob = new Blob([contentStr], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (el('diskStatusBadge')) el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> Đã tải .tmv (' + formatTimeHHMMSS() + ')';
  }
}

function importTmvProjectFile(fileObj) {
  if (!fileObj) return;
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var parsed = JSON.parse(e.target.result);
      var importedTab = parsed.tab || parsed;
      if (!importedTab || !importedTab.docType) return alert('File .tmv không hợp lệ!');
      captureDOMIntoActiveTab(true);
      if (APP_STATE.workspaces.length >= MAX_OPEN_TABS) return alert('Đang mở tối đa ' + MAX_OPEN_TABS + ' văn bản!');
      importedTab.id = 'tab_' + Date.now() + '_' + Math.floor(Math.random() * 900 + 100);
      importedTab.snapshots = Array.isArray(importedTab.snapshots) ? importedTab.snapshots : [];
      importedTab.title = deriveShortTabTitle(importedTab);
      APP_STATE.workspaces.push(importedTab);
      APP_STATE.activeTabId = importedTab.id;
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      await persistWorkspacesNow();
    } catch (err) { alert('Lỗi đọc file .tmv: ' + err.message); }
  };
  reader.readAsText(fileObj, 'utf-8');
}

// [STR-03] ĐA TAB CHUẨN 2 VAI KÝ & CHỮ KÝ KT. MẶC ĐỊNH
function normalizeRoleId(roleId) {
  if (roleId === 'dept' || roleId === 'dept_to_ubnd') return 'dept';
  return 'ubnd';
}

function buildDefaultDearLine(roleId, docTypeCode) {
  if (['KH', 'QD', 'TB'].indexOf(docTypeCode) !== -1) return '';
  if (normalizeRoleId(roleId) === 'dept') return 'Kính gửi: Ủy ban nhân dân Phường Phú Nhuận.';
  return 'Kính gửi: Ban Điều hành 24 Khu phố và các đơn vị liên quan.';
}

function createBlankWorkspaceTab(roleId, docTypeCode) {
  var def = APP_CONFIG.defaultOrg;
  var rId = (!roleId || roleId === 'dept_to_ubnd') ? 'ubnd' : normalizeRoleId(roleId);
  var dCode = docTypeCode || 'KH';
  var role = APP_CONFIG.roles.find(function(r) { return r.id === rId; }) || APP_CONFIG.roles[0];
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === dCode; }) || APP_CONFIG.docTypes[0];
  var now = new Date();
  var dateStr = def.locationName + ', ngày ' + String(now.getDate()).padStart(2, '0') + ' tháng ' + String(now.getMonth() + 1).padStart(2, '0') + ' năm ' + now.getFullYear();
  var isDept = role.orgMode === 'dept';

  var tab = {
    id: 'tab_' + Date.now() + '_' + Math.floor(Math.random() * 900 + 100),
    roleId: rId,
    docType: dCode,
    fontSize: '14pt',
    orgLine1: isDept ? def.govParent : def.ubndLine1,
    orgLine2: isDept ? def.deptName : def.ubndLine2,
    docNumber: 'Số:\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0/' + (isDept ? docType.suffixDept : docType.suffixUbnd),
    cvSubject: 'V/v ',
    dateLine: dateStr,
    docTypeName: docType.name.toUpperCase(),
    namedSub: 'Về việc ',
    dearLine: buildDefaultDearLine(rId, dCode),
    bodyHtml: '<p><br /></p>',
    recipients: role.defaultRecipients,
    signerAuth: isDept ? def.deptSignerTitle : def.ubndSignerTitle,
    signerName: '[Họ và tên người ký]',
    snapshots: [],
    chatHistory: [],
    updatedAt: Date.now()
  };
  tab.title = deriveShortTabTitle(tab);
  return tab;
}

async function loadSavedWorkspacesOrInit() {
  var bundle = null;
  try {
    var db = await openLocalDB();
    bundle = await new Promise(function(resolve) {
      var tx = db.transaction('app_state', 'readonly');
      var req = tx.objectStore('app_state').get('workspaces_bundle');
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { resolve(null); };
      tx.oncomplete = function() { db.close(); };
    });
  } catch (e) {}

  var localBackup = null;
  try { localBackup = JSON.parse(localStorage.getItem('tmv_workspaces_v2')); } catch (e) {}
  if (localBackup && (!bundle || (localBackup.savedAt || 0) > (bundle.savedAt || 0))) bundle = localBackup;

  if (bundle && Array.isArray(bundle.workspaces) && bundle.workspaces.length > 0) {
    var def = APP_CONFIG.defaultOrg;
    bundle.workspaces.forEach(function(w) {
      w.roleId = normalizeRoleId(w.roleId);
      w.snapshots = Array.isArray(w.snapshots) ? w.snapshots : [];
      w.chatHistory = Array.isArray(w.chatHistory) ? w.chatHistory : [];
      if (!w.signerName || !w.signerName.trim()) w.signerName = '[Họ và tên người ký]';
      var authClean = (w.signerAuth || '').trim();
      if (w.roleId === 'ubnd' && (!authClean || authClean === 'TM. ỦY BAN NHÂN DÂN\nCHỦ TỊCH')) {
        w.signerAuth = def.ubndSignerTitle;
      } else if (w.roleId === 'dept' && (!authClean || authClean === 'TRƯỞNG PHÒNG')) {
        w.signerAuth = def.deptSignerTitle;
      }
    });
    APP_STATE.workspaces = bundle.workspaces;
    var hasActive = bundle.workspaces.some(function(w) { return w.id === bundle.activeTabId; });
    APP_STATE.activeTabId = hasActive ? bundle.activeTabId : bundle.workspaces[0].id;
    setSaveBadgeStatus('saved', 'Đã khôi phục ' + formatTimeHHMMSS(bundle.savedAt));
  } else {
    var firstTab = createBlankWorkspaceTab('ubnd', 'KH');
    APP_STATE.workspaces = [firstTab];
    APP_STATE.activeTabId = firstTab.id;
    await persistWorkspacesNow();
  }
}

function pushTabSnapshot(labelNote, showVisualFeedback) {
  var tab = captureDOMIntoActiveTab(true);
  if (!tab) return;
  tab.snapshots = Array.isArray(tab.snapshots) ? tab.snapshots : [];
  var nowTs = Date.now();
  tab.snapshots.unshift({
    savedAt: nowTs, note: labelNote || 'Lưu mốc thủ công',
    docType: tab.docType, roleId: tab.roleId, docNumber: tab.docNumber,
    cvSubject: tab.cvSubject, namedSub: tab.namedSub, dearLine: tab.dearLine,
    bodyHtml: tab.bodyHtml, recipients: tab.recipients
  });
  if (tab.snapshots.length > MAX_SNAPSHOTS) tab.snapshots = tab.snapshots.slice(0, MAX_SNAPSHOTS);
  updateSnapshotUI();
  persistWorkspacesNow();

  if (showVisualFeedback) {
    var btn = el('btnSaveSnapshot');
    if (btn) {
      if (snapshotFlashTimer) clearTimeout(snapshotFlashTimer);
      btn.className = 'bg-emerald-600 text-white px-2.5 py-1 rounded flex items-center gap-1 border border-emerald-400 font-bold transition';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Đã lưu ' + formatTimeHHMMSS(nowTs) + '</span>';
      snapshotFlashTimer = setTimeout(function() {
        btn.className = 'bg-slate-700 hover:bg-slate-600 text-amber-300 px-2.5 py-1 rounded flex items-center gap-1 border border-slate-600 transition';
        btn.innerHTML = '<i class="fa-solid fa-camera-rotate"></i> <span>Lưu mốc</span>';
      }, 1800);
    }
    if (el('snapshotDropdown')) el('snapshotDropdown').classList.remove('hidden');
  }
}

function updateSnapshotUI() {
  var tab = getActiveTab();
  var snaps = (tab && Array.isArray(tab.snapshots)) ? tab.snapshots : [];
  if (el('snapshotCountLabel')) el('snapshotCountLabel').textContent = 'Mốc lưu (' + snaps.length + ')';
  var box = el('snapshotListBox');
  if (!box) return;
  if (snaps.length === 0) {
    box.innerHTML = '<div class="text-xs text-slate-400 p-3 text-center">Chưa có mốc lưu nào cho văn bản này.</div>';
    return;
  }
  box.innerHTML = '';
  snaps.forEach(function(s, idx) {
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-1 px-2 py-1.5 hover:bg-blue-50 rounded-lg transition ' + (idx === 0 ? 'bg-emerald-50/60' : '');
    var restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'flex-1 text-left min-w-0';
    restoreBtn.innerHTML = '<div class="text-xs font-semibold text-blue-800 truncate">#' + (snaps.length - idx) + ' • ' + formatTimeHHMMSS(s.savedAt) + ' - ' + (s.note || 'Mốc lưu') + '</div>'
      + '<div class="text-[10.5px] text-slate-500 truncate">' + (s.namedSub || s.cvSubject || '') + '</div>';
    restoreBtn.addEventListener('click', function() {
      var cur = getActiveTab();
      if (!cur) return;
      cur.docType = s.docType || cur.docType; cur.roleId = s.roleId || cur.roleId;
      cur.docNumber = s.docNumber || cur.docNumber; cur.cvSubject = s.cvSubject || '';
      cur.namedSub = s.namedSub || ''; cur.dearLine = s.dearLine || '';
      cur.bodyHtml = s.bodyHtml || '<p><br /></p>'; cur.recipients = s.recipients || '';
      window.applyActiveTabToDOM();
      el('snapshotDropdown').classList.add('hidden');
      scheduleAutoSave();
    });
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'text-slate-400 hover:text-rose-600 px-1.5 py-1 text-xs shrink-0';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var cur = getActiveTab();
      if (!cur) return;
      cur.snapshots.splice(idx, 1);
      updateSnapshotUI();
      persistWorkspacesNow();
    });
    row.appendChild(restoreBtn); row.appendChild(delBtn); box.appendChild(row);
  });
}
function renderWorkspaceTabsBar() {
  var bar = el('workspaceTabsBar');
  if (!bar) return;
  bar.innerHTML = '';
  APP_STATE.workspaces.forEach(function(tab) {
    var isAct = tab.id === APP_STATE.activeTabId;
    var item = document.createElement('div');
    item.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs cursor-pointer shrink-0 border transition '
      + (isAct ? 'bg-white text-slate-900 font-bold border-white shadow-sm' : 'bg-slate-700/70 text-slate-300 border-slate-600 hover:bg-slate-700');
    var span = document.createElement('span');
    span.className = 'max-w-[165px] truncate';
    span.textContent = tab.title || deriveShortTabTitle(tab);
    span.addEventListener('click', function() {
      if (tab.id === APP_STATE.activeTabId) return;
      captureDOMIntoActiveTab(true);
      APP_STATE.activeTabId = tab.id;
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      persistWorkspacesNow();
    });
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ml-0.5 w-4 h-4 rounded hover:bg-rose-500 hover:text-white flex items-center justify-center text-[10px] opacity-75 hover:opacity-100';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (!confirm('Đóng văn bản "' + (tab.title || '') + '"?')) return;
      APP_STATE.workspaces = APP_STATE.workspaces.filter(function(w) { return w.id !== tab.id; });
      if (APP_STATE.workspaces.length === 0) APP_STATE.workspaces = [createBlankWorkspaceTab('dept_to_ubnd', 'TTr')];
      if (APP_STATE.activeTabId === tab.id) APP_STATE.activeTabId = APP_STATE.workspaces[0].id;
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      await persistWorkspacesNow();
    });
    item.appendChild(span); item.appendChild(closeBtn); bar.appendChild(item);
  });
}

// [STR-04] GHI CHÚ MÁY ĐỘC LẬP, MÃ NỘI BỘ / API KEY & TỦ HỒ SƠ PC
function loadProfileSettings() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tmv_profile_v1')); } catch (e) {}
  APP_STATE.profile = {
    staffName: (saved && saved.staffName) ? saved.staffName : '',
    staffField: (saved && saved.staffField) ? saved.staffField : 'Văn hóa - Xã hội'
  };
  if (el('profileBtnLabel')) {
    el('profileBtnLabel').textContent = APP_STATE.profile.staffName ? APP_STATE.profile.staffName : 'Ghi chú máy';
  }
}

function renderRoleButtons() {
  var tab = getActiveTab();
  var activeRoleId = tab ? normalizeRoleId(tab.roleId) : 'ubnd';
  var wrap = el('roleButtonsContainer');
  if (!wrap) return;
  wrap.innerHTML = '';
  APP_CONFIG.roles.forEach(function(r) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.title = r.toneDesc;
    btn.className = 'role-card min-h-[38px] rounded-md px-2 py-1 text-[11px] leading-tight flex items-center justify-center gap-1.5 text-center '
      + (r.id === activeRoleId ? 'active font-bold text-blue-900' : 'text-slate-700 font-medium');
    btn.innerHTML = '<i class="' + r.icon + ' text-blue-600 shrink-0"></i><span>' + r.shortName + '</span>';
    btn.addEventListener('click', function() {
      var cur = captureDOMIntoActiveTab(true);
      if (!cur) return;
      cur.roleId = r.id;
      applyRoleOrDocTypeChangeToTab(cur, true);
      window.applyActiveTabToDOM();
      scheduleAutoSave();
    });
    wrap.appendChild(btn);
  });
}

function applyRoleOrDocTypeChangeToTab(tab, roleChanged) {
  var def = APP_CONFIG.defaultOrg;
  var role = APP_CONFIG.roles.find(function(r) { return r.id === tab.roleId; }) || APP_CONFIG.roles[0];
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
  var isDept = role.orgMode === 'dept';

  tab.orgLine1 = isDept ? def.govParent : def.ubndLine1;
  tab.orgLine2 = isDept ? def.deptName : def.ubndLine2;
  tab.docNumber = 'Số:\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0/' + (isDept ? docType.suffixDept : docType.suffixUbnd);
  tab.docTypeName = docType.name.toUpperCase();
  if (roleChanged) {
    tab.recipients = role.defaultRecipients;
    tab.signerAuth = isDept ? def.deptSignerTitle : def.ubndSignerTitle;
    if (!tab.signerName || !tab.signerName.trim()) tab.signerName = '[Họ và tên người ký]';
    tab.dearLine = buildDefaultDearLine(tab.roleId, tab.docType);
  }
  tab.title = deriveShortTabTitle(tab);
}

function applyActiveTabToDOM() {
  var tab = getActiveTab();
  if (!tab) return;
  isApplyingTabToDOM = true;
  try {
    var role = APP_CONFIG.roles.find(function(r) { return r.id === tab.roleId; }) || APP_CONFIG.roles[0];
    var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];

    setVal('docTypeSelect', tab.docType);
    setVal('fontSizeSelect', tab.fontSize || '14pt');
    if (el('a4Paper')) el('a4Paper').setAttribute('data-fontsize', tab.fontSize || '14pt');
    if (el('activeRoleBadge')) el('activeRoleBadge').textContent = role.shortName;

    if (el('a4OrgLine1')) el('a4OrgLine1').textContent = tab.orgLine1 || '';
    if (el('a4OrgLine2')) el('a4OrgLine2').textContent = tab.orgLine2 || '';
    if (el('a4DocNumber')) el('a4DocNumber').textContent = tab.docNumber || '';
    if (el('a4CvSubject')) el('a4CvSubject').textContent = tab.cvSubject || '';
    if (el('a4DateLine')) el('a4DateLine').textContent = tab.dateLine || '';
    if (el('a4DocTypeName')) el('a4DocTypeName').textContent = tab.docTypeName || '';
    if (el('a4NamedSub')) el('a4NamedSub').textContent = tab.namedSub || '';
    if (el('a4DearLine')) el('a4DearLine').textContent = tab.dearLine || '';
    if (el('a4BodyContent')) el('a4BodyContent').innerHTML = tab.bodyHtml || '<p><br /></p>';
    if (el('a4Recipients')) el('a4Recipients').textContent = tab.recipients || '';
    if (el('a4SignerAuth')) el('a4SignerAuth').textContent = tab.signerAuth || '';
    if (el('a4SignerName')) el('a4SignerName').textContent = tab.signerName || '[Họ và tên người ký]';

    if (docType.isCongVan) {
      if (el('a4NamedHeader')) el('a4NamedHeader').classList.add('hidden');
      if (el('a4CvSubject')) el('a4CvSubject').classList.remove('hidden');
    } else {
      if (el('a4NamedHeader')) el('a4NamedHeader').classList.remove('hidden');
      if (el('a4CvSubject')) el('a4CvSubject').classList.add('hidden');
    }
    renderRoleButtons();
    updateSnapshotUI();
  } finally {
    isApplyingTabToDOM = false;
  }
}

function loadApiSettings() {
  try {
    var saved = JSON.parse(localStorage.getItem('tmv_api_v1'));
    if (saved) APP_STATE.api = Object.assign(APP_STATE.api, saved);
  } catch (e) {}

  if (window.location.hash && window.location.hash.indexOf('#pin=') === 0) {
    var hashPin = decodeURIComponent(window.location.hash.substring(5)).trim();
    if (hashPin) {
      APP_STATE.api.internalPin = hashPin;
      APP_STATE.api.verified = true;
      localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
    }
  }

  populateModelSelect();
  var isVerified = APP_STATE.api.verified === true;
  var hasPersonalKey = isVerified && Boolean(APP_STATE.api.key && APP_STATE.api.key.trim().length > 10);
  var hasPin = isVerified && !hasPersonalKey && Boolean(APP_STATE.api.internalPin && APP_STATE.api.internalPin.trim().length > 0);
  var isConfigured = hasPersonalKey || hasPin;

  if (el('firstUseTipBanner')) el('firstUseTipBanner').classList.toggle('hidden', isConfigured);
  if (el('normalSaveBar')) {
    el('normalSaveBar').classList.toggle('hidden', !isConfigured);
    if (isConfigured) el('normalSaveBar').classList.add('xl:flex');
  }

  if (hasPersonalKey) {
    el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-emerald-400';
    el('apiBtnLabel').textContent = APP_STATE.api.primaryModel;
    el('btnOpenApiModal').className = 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
  } else if (hasPin) {
    el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-sky-400';
    el('apiBtnLabel').textContent = 'Mã nội bộ (Free)';
    el('btnOpenApiModal').className = 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
  } else {
    el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-rose-500';
    el('apiBtnLabel').textContent = 'Nhập Mã / API Key';
    el('btnOpenApiModal').className = 'bg-amber-500/20 hover:bg-amber-500/30 border-2 border-amber-400 text-amber-200 font-bold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
  }
}

function populateModelSelect() {
  var sel = el('selModelPrimary');
  if (!sel) return;
  sel.innerHTML = '';
  var list = (APP_STATE.api.liveModels && APP_STATE.api.liveModels.length > 0) ? APP_STATE.api.liveModels : APP_CONFIG.defaultModels;
  list.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.label;
    sel.appendChild(opt);
  });
  sel.value = list.some(function(m) { return m.id === APP_STATE.api.primaryModel; }) ? APP_STATE.api.primaryModel : list[0].id;
}

function showApiNotice(msg, isOk) {
  var box = el('apiTestResultBox');
  if (!box) return;
  box.classList.remove('hidden');
  box.className = 'rounded-lg p-2.5 border text-xs leading-relaxed ' + (isOk ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900');
  box.textContent = msg;
}

async function detectLiveModelsFromGoogle() {
  var key = getVal('inpApiKey');
  if (!key) return showApiNotice('Hãy dán Gemini API Key cá nhân ở ô trên trước khi cập nhật Model!', false);
  showApiNotice('Đang lấy danh sách Model từ Google AI...', true);
  try {
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
    var data = await res.json();
    if (!res.ok || !data.models) return showApiNotice('Lỗi Key: ' + ((data.error && data.error.message) || 'Không hợp lệ'), false);
    var blocked = ['tts', 'image', 'embedding', 'imagen', 'veo', 'robotics', 'computer-use', 'audio', 'aqa', 'omni', 'pro-preview', 'thinking'];
    var valid = data.models.filter(function(m) {
      var id = (m.name || '').replace('models/', '');
      var canGen = m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
      return canGen && (id.indexOf('gemini-') === 0 || id.indexOf('gemma-') === 0) && !blocked.some(function(w) { return id.indexOf(w) !== -1; });
    }).map(function(m) {
      var id = m.name.replace('models/', '');
      return { id: id, label: id + ' (' + (m.displayName || 'Sẵn sàng') + ')' };
    }).sort(function(a, b) {
      var af = a.id.indexOf('flash') !== -1 ? 1 : 0, bf = b.id.indexOf('flash') !== -1 ? 1 : 0;
      return af !== bf ? bf - af : b.id.localeCompare(a.id);
    });
    APP_STATE.api.liveModels = valid;
    populateModelSelect();
    showApiNotice('Đã nạp ' + valid.length + ' Model khả dụng trên Key cá nhân này.', true);
  } catch (err) { showApiNotice('Lỗi mạng: ' + err.message, false); }
}

async function testFireApiConnection() {
  var key = getVal('inpApiKey');
  var pin = getVal('inpInternalPin');
  if (key) {
    var chosen = getVal('selModelPrimary');
    showApiNotice('Đang kiểm tra Key cá nhân [' + chosen + ']...', true);
    var t0 = Date.now();
    try {
      var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + chosen + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Trả lời 2 từ: Sẵn sàng.' }] }] })
      });
      var data = await res.json();
      if (res.ok && data.candidates && data.candidates[0]) return showApiNotice('Key cá nhân thông suốt [' + chosen + '] (' + (Date.now() - t0) + 'ms)!', true);
      return showApiNotice('Model từ chối: ' + ((data.error && data.error.message) || 'Hãy chọn Model khác.'), false);
    } catch (e) { return showApiNotice('Lỗi mạng: ' + e.message, false); }
  }
  if (pin) {
    if (!APP_CONFIG.proxyWebAppUrl) return showApiNotice('Chưa dán link Web App Trạm Gác (/exec) vào dòng proxyWebAppUrl trong file config.js!', false);
    showApiNotice('Đang kiểm tra Mã nội bộ qua Trạm Gác...', true);
    try {
      var r2 = await fetch(APP_CONFIG.proxyWebAppUrl, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ pin: pin, sysPrompt: 'Trả lời ngắn.', userParts: [{ text: 'Chào 2 từ.' }] })
      });
      var d2 = await r2.json();
      if (d2.success) return showApiNotice('Mã nội bộ chính xác! Đang chạy qua [' + d2.usedModel + '].', true);
      return showApiNotice('Trạm Gác báo: ' + (d2.message || 'Sai Mã nội bộ!'), false);
    } catch (e2) { return showApiNotice('Lỗi nối Trạm Gác: ' + e2.message, false); }
  }
  showApiNotice('Vui lòng nhập Mã nội bộ (Cách 1) hoặc API Key cá nhân (Cách 2) trước!', false);
}

async function pickCabinetFolder() {
  if (window.showDirectoryPicker && window.isSecureContext) {
    try {
      var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      APP_STATE.dirHandle = handle; APP_STATE.dirWritable = true;
      await saveDirHandleToDB(handle);
      await scanDirectoryHandle(handle);
      if (el('diskStatusBadge')) el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> Đã nối ổ cứng';
      writeTabTmvToDisk(captureDOMIntoActiveTab(true), false);
      return;
    } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  el('folderFallbackInput').click();
}

async function scanDirectoryHandle(dirHandle) {
  var collected = [];
  async function walk(handle, prefix, depth) {
    if (depth > 2) return;
    for await (var entry of handle.values()) {
      if (entry.name.charAt(0) === '.' || entry.name === APP_CONFIG.defaultOrg.draftSubfolder) continue;
      if (entry.kind === 'file') collected.push({ file: await entry.getFile(), relPath: prefix + entry.name });
      else if (entry.kind === 'directory') await walk(entry, prefix + entry.name + '/', depth + 1);
    }
  }
  await walk(dirHandle, '', 1);
  processCabinetFiles(collected, dirHandle.name);
}

function processCabinetFiles(rawItems, folderLabel) {
  var allowed = ['docx', 'doc', 'pdf', 'xlsx', 'xls', 'csv', 'txt', 'md'];
  var maxAgeMs = APP_CONFIG.defaultOrg.folderRuleDays * 86400000;
  var now = Date.now(), pinned = [], recent = [];
  rawItems.forEach(function(item) {
    var f = item.file, name = f.name || '';
    if (!name || name.charAt(0) === '~' || name.charAt(0) === '.' || item.relPath.indexOf(APP_CONFIG.defaultOrg.draftSubfolder) !== -1) return;
    var ext = name.indexOf('.') !== -1 ? name.split('.').pop().toLowerCase() : '';
    if (allowed.indexOf(ext) === -1) return;
    var isPin = name.toUpperCase().indexOf(APP_CONFIG.defaultOrg.pinPrefix) === 0;
    var rec = { id: item.relPath, name: name, ext: ext, size: f.size, lastModified: f.lastModified, isPinned: isPin, checked: true, fileObj: f };
    if (isPin) pinned.push(rec); else if ((now - f.lastModified) <= maxAgeMs) recent.push(rec);
  });
  pinned.sort(function(a, b) { return b.lastModified - a.lastModified; });
  recent.sort(function(a, b) { return b.lastModified - a.lastModified; });
  APP_STATE.cabinetFiles = pinned.concat(recent.slice(0, APP_CONFIG.defaultOrg.folderRuleMaxFiles));
  if (el('cabinetCountBadge')) el('cabinetCountBadge').textContent = '(' + APP_STATE.cabinetFiles.length + ')';
  if (el('cabinetSummaryBar')) el('cabinetSummaryBar').innerHTML = '<b>' + folderLabel + '</b> (' + pinned.length + ' ghim, ' + Math.min(recent.length, 10) + ' mới)';
  renderCabinetList();
}

function renderCabinetList() {
  var box = el('cabinetFileList'), list = APP_STATE.cabinetFiles;
  if (!box) return;
  box.innerHTML = '';
  list.forEach(function(item, idx) {
    var icon = item.ext === 'pdf' ? 'fa-file-pdf text-rose-600' : (item.ext.indexOf('xl') === 0 ? 'fa-file-excel text-emerald-600' : 'fa-file-word text-blue-600');
    var row = document.createElement('label');
    row.className = 'flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] cursor-pointer ' + (item.isPinned ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:bg-slate-50');
    row.innerHTML = '<input type="checkbox" ' + (item.checked ? 'checked' : '') + ' class="rounded text-blue-600" />'
      + '<i class="fa-solid ' + icon + ' shrink-0"></i><span class="truncate flex-1 text-slate-800">' + item.name + '</span>';
    row.querySelector('input').addEventListener('change', function(e) { APP_STATE.cabinetFiles[idx].checked = e.target.checked; });
    box.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', async function() {
  loadProfileSettings();
  loadApiSettings();

  el('btnOpenProfile').addEventListener('click', function() {
    setVal('inpStaffName', APP_STATE.profile.staffName);
    setVal('inpStaffField', APP_STATE.profile.staffField);
    setVal('inpLocalFacts', localStorage.getItem('tmv_local_facts_v1') || APP_CONFIG.defaultOrg.localFacts);
    openModalSafe('modalProfile');
  });
  el('btnCloseProfile').addEventListener('click', function() { closeModalSafe('modalProfile'); });
  el('modalProfile').addEventListener('click', function(e) { if (e.target === el('modalProfile')) closeModalSafe('modalProfile'); });
  el('btnResetLocalFacts').addEventListener('click', function() { setVal('inpLocalFacts', APP_CONFIG.defaultOrg.localFacts); });
  el('btnSaveProfile').addEventListener('click', function() {
    APP_STATE.profile = { staffName: getVal('inpStaffName'), staffField: getVal('inpStaffField') || 'Văn hóa - Xã hội' };
    localStorage.setItem('tmv_profile_v1', JSON.stringify(APP_STATE.profile));
    localStorage.setItem('tmv_local_facts_v1', getVal('inpLocalFacts'));
    loadProfileSettings();
    closeModalSafe('modalProfile');
  });

  el('btnOpenApiModal').addEventListener('click', function() {
    setVal('inpInternalPin', APP_STATE.api.internalPin || '');
    setVal('inpApiKey', APP_STATE.api.key || '');
    populateModelSelect();
    openModalSafe('modalApi');
  });
  el('btnCloseApi').addEventListener('click', function() { closeModalSafe('modalApi'); });
  el('modalApi').addEventListener('click', function(e) { if (e.target === el('modalApi')) closeModalSafe('modalApi'); });
  el('btnToggleKeyVis').addEventListener('click', function() {
    var k = el('inpApiKey'), p = el('inpInternalPin');
    var nextType = k.type === 'password' ? 'text' : 'password';
    k.type = nextType; p.type = nextType;
  });
  el('btnDetectModels').addEventListener('click', detectLiveModelsFromGoogle);
  el('btnTestApi').addEventListener('click', testFireApiConnection);
  el('btnSaveApi').addEventListener('click', async function() {
    var pin = getVal('inpInternalPin');
    var key = getVal('inpApiKey');
    var btn = el('btnSaveApi');
    var oldHtml = btn.innerHTML;

    if (!pin && !key) {
      APP_STATE.api.internalPin = '';
      APP_STATE.api.key = '';
      APP_STATE.api.verified = false;
      localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
      loadApiSettings();
      closeModalSafe('modalApi');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang xác thực...';
    try {
      if (key) {
        var rKey = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
        var dKey = await rKey.json();
        if (!rKey.ok || !dKey.models) {
          APP_STATE.api.verified = false;
          localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
          loadApiSettings();
          showApiNotice('API Key cá nhân không hợp lệ! Vui lòng kiểm tra lại hoặc xóa ô Key cá nhân để dùng Mã nội bộ.', false);
          return;
        }
        APP_STATE.api.key = key;
        APP_STATE.api.internalPin = pin;
        APP_STATE.api.primaryModel = getVal('selModelPrimary') || APP_STATE.api.primaryModel;
        APP_STATE.api.verified = true;
        localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
        loadApiSettings();
        closeModalSafe('modalApi');
        return;
      }

      if (!APP_CONFIG.proxyWebAppUrl) {
        showApiNotice('Chưa có link Trạm Gác trong config.js!', false);
        return;
      }
      var rPin = await fetch(APP_CONFIG.proxyWebAppUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'verify_pin', pin: pin })
      });
      var dPin = await rPin.json();
      if (!dPin || !dPin.success) {
        APP_STATE.api.verified = false;
        localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
        loadApiSettings();
        showApiNotice((dPin && dPin.message) ? dPin.message : 'Mã nội bộ không chính xác!', false);
        return;
      }

      APP_STATE.api.internalPin = pin;
      APP_STATE.api.key = '';
      APP_STATE.api.verified = true;
      localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
      loadApiSettings();
      closeModalSafe('modalApi');
    } catch (err) {
      APP_STATE.api.verified = false;
      loadApiSettings();
      showApiNotice('Không kết nối được máy chủ xác thực: ' + err.message, false);
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  });
  el('btnSaveSnapshot').addEventListener('click', function(e) { e.stopPropagation(); pushTabSnapshot('Lưu tay', true); });
  el('btnToggleSnapshots').addEventListener('click', function(e) { e.stopPropagation(); el('snapshotDropdown').classList.toggle('hidden'); });
  el('snapshotDropdown').addEventListener('click', function(e) { e.stopPropagation(); });
  el('btnClearSnapshots').addEventListener('click', function() {
    var cur = getActiveTab();
    if (!cur || !cur.snapshots || !cur.snapshots.length) return;
    if (!confirm('Xóa toàn bộ mốc lưu của văn bản này?')) return;
    cur.snapshots = []; updateSnapshotUI(); persistWorkspacesNow();
  });
  document.addEventListener('click', function() { el('snapshotDropdown').classList.add('hidden'); });

  el('btnToggleCabinetBody').addEventListener('click', function() {
    APP_STATE.cabinetCollapsed = !APP_STATE.cabinetCollapsed;
    el('cabinetBodyWrap').classList.toggle('hidden', APP_STATE.cabinetCollapsed);
    el('cabinetChevronIcon').className = 'fa-solid text-[10px] text-slate-500 ' + (APP_STATE.cabinetCollapsed ? 'fa-chevron-right' : 'fa-chevron-down');
  });

  APP_CONFIG.docTypes.forEach(function(d) {
    var opt = document.createElement('option'); opt.value = d.code; opt.textContent = d.name;
    el('docTypeSelect').appendChild(opt);
  });

  await loadSavedWorkspacesOrInit();
  window.applyActiveTabToDOM();
  renderWorkspaceTabsBar();
  var initTab = getActiveTab();
  if (!initTab || !initTab.chatHistory || initTab.chatHistory.length === 0) {
    setDefaultQuickPromptInInput();
  }

  el('a4Paper').addEventListener('input', scheduleAutoSave);
  el('docTypeSelect').addEventListener('change', function(e) {
    var cur = captureDOMIntoActiveTab(true);
    if (!cur) return;
    cur.docType = e.target.value;
    cur.dearLine = buildDefaultDearLine(cur.roleId, cur.docType);
    applyRoleOrDocTypeChangeToTab(cur, false);
    window.applyActiveTabToDOM();
    renderWorkspaceTabsBar();
    scheduleAutoSave();
  });
  el('fontSizeSelect').addEventListener('change', function(e) { el('a4Paper').setAttribute('data-fontsize', e.target.value); scheduleAutoSave(); });

  el('btnNewTab').addEventListener('click', async function() {
    captureDOMIntoActiveTab(true);
    if (APP_STATE.workspaces.length >= MAX_OPEN_TABS) return alert('Đang mở tối đa ' + MAX_OPEN_TABS + ' văn bản!');
    var nt = createBlankWorkspaceTab('dept_to_ubnd', 'TTr');
    APP_STATE.workspaces.push(nt);
    APP_STATE.activeTabId = nt.id;
    window.applyActiveTabToDOM();
    renderWorkspaceTabsBar();
    setDefaultQuickPromptInInput();
    await persistWorkspacesNow();
  });

  el('btnSaveTmvFile').addEventListener('click', function() { writeTabTmvToDisk(captureDOMIntoActiveTab(true), true); });
  el('btnOpenTmvFile').addEventListener('click', function() { el('tmvFileInput').click(); });
  el('tmvFileInput').addEventListener('change', function(e) { if (e.target.files && e.target.files[0]) importTmvProjectFile(e.target.files[0]); e.target.value = ''; });

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      var tab = captureDOMIntoActiveTab(true); persistWorkspacesNow(); writeTabTmvToDisk(tab, true);
    } else if (e.key === 'Escape') { closeModalSafe('modalProfile'); closeModalSafe('modalApi'); }
  });

  el('btnPickFolder').addEventListener('click', pickCabinetFolder);
  el('btnRefreshFolder').addEventListener('click', async function() {
    if (APP_STATE.dirHandle) {
      var perm = await APP_STATE.dirHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') { APP_STATE.dirWritable = true; await scanDirectoryHandle(APP_STATE.dirHandle); }
    } else pickCabinetFolder();
  });
  el('folderFallbackInput').addEventListener('change', function(e) {
    var files = Array.from(e.target.files || []);
    if (!files.length) return;
    processCabinetFiles(files.map(function(f) { return { file: f, relPath: f.webkitRelativePath || f.name }; }), (files[0].webkitRelativePath || 'Thu_Muc_PC').split('/')[0]);
    e.target.value = '';
  });
  el('btnSelectAllFiles').addEventListener('click', function() { APP_STATE.cabinetFiles.forEach(function(f) { f.checked = true; }); renderCabinetList(); });
  el('btnClearAllFiles').addEventListener('click', function() { APP_STATE.cabinetFiles.forEach(function(f) { f.checked = false; }); renderCabinetList(); });

  var savedHandle = await loadDirHandleFromDB();
  if (savedHandle && window.isSecureContext) {
    APP_STATE.dirHandle = savedHandle;
    if (el('cabinetSummaryBar')) el('cabinetSummaryBar').innerHTML = 'Đã nhớ: <b>' + savedHandle.name + '</b>';
  }
});