// [STR-01] TRẠNG THÁI HỆ THỐNG, BỘ LỌC BẢO MẬT XSS & TIỆN ÍCH CỐT LÕI PC
window.APP_STATE = {
  profile: null,
  api: { key: '', internalPin: '', primaryModel: 'gemini-3.5-flash', liveModels: [], verified: false },
  workspaces: [],
  activeTabId: '',
  dirHandle: null,
  dirWritable: false,
  cabinetCollapsed: true,
  cabinetFiles: [],
  sidebarCollapsed: false,
  zoomMode: 'fit'
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

function escapeHtml(str) {
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

function showToast(msg, type) {
  var box = el('toastContainer');
  if (!box) return;
  var item = document.createElement('div');
  var cls = type === 'error'
    ? 'bg-rose-700 text-white border-rose-500'
    : (type === 'warn' ? 'bg-amber-500 text-slate-950 border-amber-300' : 'bg-slate-900 text-white border-slate-700');
  item.className = 'pointer-events-auto px-3.5 py-2 rounded-xl shadow-xl border text-xs font-medium flex items-center gap-2 transition-all duration-200 max-w-sm ' + cls;
  var icon = type === 'error' ? 'fa-circle-exclamation' : (type === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check text-emerald-400');
  item.innerHTML = '<i class="fa-solid ' + icon + ' shrink-0"></i><span></span>';
  item.querySelector('span').textContent = msg;
  box.appendChild(item);
  setTimeout(function() {
    item.style.opacity = '0';
    item.style.transform = 'translateY(6px)';
    setTimeout(function() { if (item.parentNode) item.parentNode.removeChild(item); }, 220);
  }, 3200);
}
window.showToast = showToast;

// Bộ lọc HTML an toàn tuyệt đối qua thẻ <template> trơ (chặn 100% DOM XSS từ file .tmv & AI)
function sanitizeAdminHtml(rawHtml) {
  var cleaned = String(rawHtml || '').replace(/^```html\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!cleaned) return '';
  var tpl = document.createElement('template');
  tpl.innerHTML = cleaned;

  var DROP_TAGS = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'];
  var ALLOW_TAGS = ['P', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'H1', 'H2', 'H3', 'H4'];

  function cleanNode(root) {
    Array.from(root.childNodes).forEach(function(node) {
      if (node.nodeType === 8) { node.remove(); return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toUpperCase();
      if (DROP_TAGS.indexOf(tag) !== -1) { node.remove(); return; }

      cleanNode(node);

      if (ALLOW_TAGS.indexOf(tag) === -1) {
        while (node.firstChild) root.insertBefore(node.firstChild, node);
        node.remove();
        return;
      }

      var safeStyle = [];
      if (node.getAttribute('align')) {
        var alAttr = node.getAttribute('align').toLowerCase();
        if (['center', 'left', 'right', 'justify'].indexOf(alAttr) !== -1) safeStyle.push('text-align:' + alAttr);
      }
      if (node.style) {
        var ta = (node.style.textAlign || '').toLowerCase();
        if (['center', 'left', 'right', 'justify'].indexOf(ta) !== -1) safeStyle.push('text-align:' + ta);
        if (ta === 'center' || ta === 'right') safeStyle.push('text-indent:0');
        var fw = (node.style.fontWeight || '').toLowerCase();
        if (fw === 'bold' || parseInt(fw, 10) >= 600) safeStyle.push('font-weight:bold');
        var fs = (node.style.fontStyle || '').toLowerCase();
        if (fs === 'italic') safeStyle.push('font-style:italic');
      }

      var colspan = (tag === 'TD' || tag === 'TH') ? parseInt(node.getAttribute('colspan') || '0', 10) : 0;
      var rowspan = (tag === 'TD' || tag === 'TH') ? parseInt(node.getAttribute('rowspan') || '0', 10) : 0;

      Array.from(node.attributes).forEach(function(attr) { node.removeAttribute(attr.name); });
      if (colspan > 1 && colspan <= 20) node.setAttribute('colspan', String(colspan));
      if (rowspan > 1 && rowspan <= 50) node.setAttribute('rowspan', String(rowspan));
      if (safeStyle.length > 0) node.setAttribute('style', safeStyle.join(';'));
    });
  }

  cleanNode(tpl.content);
  // Tự động dọn sạch các khung bảng <table> rỗng không có chữ (xác bảng sót lại như lỗi bôi đen bảng)
  if (tpl.content && tpl.content.querySelectorAll) {
    Array.from(tpl.content.querySelectorAll('table')).forEach(function(tbl) {
      var txt = (tbl.textContent || '').replace(/\u00A0/g, '').trim();
      if (!txt) tbl.remove();
    });
  }
  var res = tpl.innerHTML.trim();
  return res;
}
window.sanitizeAdminHtml = sanitizeAdminHtml;

function purgeEmptyTablesInLiveBody() {
  var bodyEl = el('a4BodyContent');
  if (!bodyEl) return 0;
  var removed = 0;
  Array.from(bodyEl.querySelectorAll('table')).forEach(function(tbl) {
    var txt = (tbl.textContent || '').replace(/\u00A0/g, '').trim();
    if (!txt) { tbl.remove(); removed++; }
  });
  return removed;
}
window.purgeEmptyTablesInLiveBody = purgeEmptyTablesInLiveBody;

function formatTimeHHMMSS(ts) {
  var d = new Date(ts || Date.now());
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

function slugifyFileName(str) {
  var s = (str || 'Du_thao').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'Du_thao').substring(0, 42);
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

// [STR-02] THU PHÓNG TỜ GIẤY A4 VỪA KHUNG PC & ƯỚC LƯỢNG SỐ TRANG TRỰC QUAN
function updatePaperZoomAndPageCount() {
  var desk = el('a4ScrollDesk'), stage = el('a4ZoomStage'), paper = el('a4Paper');
  if (!desk || !stage || !paper) return;

  var scale = 1;
  if (APP_STATE.zoomMode === 'fit') {
    var availW = Math.max(320, desk.clientWidth - 36);
    var naturalW = paper.offsetWidth || 794;
    scale = Math.min(1, Math.max(0.55, availW / naturalW));
  } else {
    scale = parseFloat(APP_STATE.zoomMode) || 1;
  }

  paper.style.setProperty('--a4-scale', scale.toFixed(3));
  var naturalH = paper.offsetHeight || 1123;
  stage.style.height = Math.ceil(naturalH * scale + 12) + 'px';

  // Tính số trang A4 (297mm ~ 1122.5px ở 96 DPI)
  var onePagePx = 1122.5;
  var ratio = naturalH / onePagePx;
  var pages = Math.max(1, Math.ceil(ratio - 0.02));
  var remainder = ratio - Math.floor(ratio);
  var badge = el('pageCountBadge');
  if (badge) {
    if (pages >= 2 && remainder > 0.02 && remainder <= 0.16) {
      badge.className = 'text-[11px] bg-amber-100 border border-amber-300 text-amber-900 font-semibold px-2 py-0.5 rounded';
      badge.textContent = '~' + pages + ' trang (Lố ít dòng)';
      badge.title = 'Văn bản vừa tràn nhẹ sang trang ' + pages + '. Có thể bấm nút [Rút gọn vừa trang] hoặc đổi cỡ chữ 13.5pt để tránh rớt lẻ chữ ký!';
    } else {
      badge.className = 'text-[11px] bg-slate-100 border border-slate-200 text-slate-700 font-medium px-2 py-0.5 rounded';
      badge.textContent = '~' + pages + ' trang A4';
      badge.title = 'Chiều dài ước tính: ' + pages + ' trang A4 (Vạch xanh nét đứt trên giấy báo ranh giới ngắt trang)';
    }
  }
}
window.updatePaperZoomAndPageCount = updatePaperZoomAndPageCount;

function updateDearLinePresentation() {
  var dearEl = el('a4DearLine');
  if (!dearEl) return;
  var txt = (dearEl.innerText || '').trim();
  var isMulti = txt.indexOf('\n') !== -1;
  dearEl.classList.toggle('multi-line', isMulti);
}
window.updateDearLinePresentation = updateDearLinePresentation;

// [STR-03] CHỤP NỘI DUNG GIẤY A4 & LƯU TỰ ĐỘNG 3 TẦNG (KHÔNG XẢ RÁC FILE .TMV)
function getActiveTab() {
  return APP_STATE.workspaces.find(function(t) { return t.id === APP_STATE.activeTabId; }) || APP_STATE.workspaces[0] || null;
}

function getTabById(tabId) {
  return APP_STATE.workspaces.find(function(t) { return t.id === tabId; }) || null;
}
window.getTabById = getTabById;

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

  if (el('a4OrgLine1')) tab.orgLine1 = el('a4OrgLine1').textContent.trim();
  if (el('a4OrgLine2')) tab.orgLine2 = el('a4OrgLine2').textContent.trim();
  if (el('a4DocNumber')) tab.docNumber = el('a4DocNumber').textContent;
  if (el('a4CvSubject')) tab.cvSubject = el('a4CvSubject').textContent.trim();
  if (el('a4DateLine')) tab.dateLine = el('a4DateLine').textContent.trim();
  if (el('a4DocTypeName')) tab.docTypeName = el('a4DocTypeName').textContent.trim();
  if (el('a4NamedSub')) tab.namedSub = el('a4NamedSub').textContent.trim();
  if (el('a4DearLine')) tab.dearLine = (el('a4DearLine').innerText || '').trim();
  if (el('a4BodyContent')) {
    var rawBody = el('a4BodyContent').innerHTML.trim();
    tab.bodyHtml = (rawBody === '<br>' || rawBody === '<p><br></p>' || rawBody === '<p></p>') ? '' : rawBody;
  }
  if (el('a4Recipients')) tab.recipients = (el('a4Recipients').innerText || '').trim();
  if (el('a4SignerAuth')) tab.signerAuth = (el('a4SignerAuth').innerText || '').trim();
  if (el('a4SignerName')) tab.signerName = el('a4SignerName').textContent.trim();
  if (el('fontSizeSelect')) tab.fontSize = el('fontSizeSelect').value || '14pt';

  tab.updatedAt = Date.now();
  tab.title = deriveShortTabTitle(tab);
  return tab;
}

function setSaveBadgeStatus(mode, text) {
  var badge = el('saveStatusBadge');
  if (!badge) return;
  badge.className = (mode === 'saving' ? 'text-amber-300' : 'text-emerald-400') + ' flex items-center gap-1 font-medium';
  badge.innerHTML = (mode === 'saving' ? '<i class="fa-solid fa-spinner fa-spin"></i> ' : '<i class="fa-solid fa-shield-halved"></i> ') + '<span></span>';
  badge.querySelector('span').textContent = text;
}

async function persistWorkspacesNow() {
  // Chỉ lưu dữ liệu bền vững (bỏ qua các thuộc tính runtime tạm thời như busyStatus)
  var cleanWorkspaces = APP_STATE.workspaces.map(function(w) {
    var copy = Object.assign({}, w);
    delete copy._isBusy;
    delete copy._busyLabel;
    return copy;
  });
  var payload = { activeTabId: APP_STATE.activeTabId, workspaces: cleanWorkspaces, savedAt: Date.now() };
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
  updateDearLinePresentation();
  updatePaperZoomAndPageCount();
  setSaveBadgeStatus('saving', 'Đang lưu...');
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async function() {
    autoSaveTimer = null;
    var tab = captureDOMIntoActiveTab(false);
    renderWorkspaceTabsBar();
    await persistWorkspacesNow();
    if (tab && APP_STATE.dirHandle && APP_STATE.dirWritable) scheduleAutoDiskWrite(tab);
  }, 450);
}

function scheduleAutoDiskWrite(tab) {
  if (autoDiskTimer) clearTimeout(autoDiskTimer);
  autoDiskTimer = setTimeout(function() { autoDiskTimer = null; writeTabTmvToDisk(tab, false); }, 2000);
}

async function writeTabTmvToDisk(tab, allowBrowserDownload) {
  if (!tab) return;
  var cleanTab = Object.assign({}, tab);
  delete cleanTab._isBusy;
  delete cleanTab._busyLabel;

  var fileName = 'DangSoan_' + tab.docType + '_' + slugifyFileName(tab.namedSub || tab.cvSubject) + '_' + tab.id.slice(-4) + '.tmv';
  var contentStr = JSON.stringify({ app: 'TroLyThamMuu_VHXH', version: '2.0', exportedAt: new Date().toISOString(), tab: cleanTab }, null, 2);

  if (APP_STATE.dirHandle && APP_STATE.dirWritable) {
    try {
      var subDir = await APP_STATE.dirHandle.getDirectoryHandle(APP_CONFIG.defaultOrg.draftSubfolder, { create: true });
      // Dọn dẹp file nháp cũ của cùng Tab nếu người dùng vừa đổi Trích yếu / Loại văn bản (Chống xả rác ổ cứng)
      if (tab.lastDiskFileName && tab.lastDiskFileName !== fileName) {
        try { await subDir.removeEntry(tab.lastDiskFileName); } catch (rmErr) {}
      }
      var fileHandle = await subDir.getFileHandle(fileName, { create: true });
      var writable = await fileHandle.createWritable();
      await writable.write(contentStr);
      await writable.close();
      tab.lastDiskFileName = fileName;
      if (el('diskStatusBadge')) {
        el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> <span></span>';
        el('diskStatusBadge').querySelector('span').textContent = 'Ổ cứng (' + formatTimeHHMMSS() + ')';
      }
      if (allowBrowserDownload) showToast('Đã lưu [' + fileName + '] vào thư mục ' + APP_CONFIG.defaultOrg.draftSubfolder, 'ok');
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
    if (el('diskStatusBadge')) {
      el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> <span></span>';
      el('diskStatusBadge').querySelector('span').textContent = 'Đã tải .tmv (' + formatTimeHHMMSS() + ')';
    }
    showToast('Đã tải xuống file dự án ' + fileName, 'ok');
  }
}

function importTmvProjectFile(fileObj) {
  if (!fileObj) return;
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var parsed = JSON.parse(e.target.result);
      var importedTab = parsed.tab || parsed;
      if (!importedTab || !importedTab.docType) return showToast('File .tmv không đúng định dạng!', 'error');
      captureDOMIntoActiveTab(true);
      if (APP_STATE.workspaces.length >= MAX_OPEN_TABS) return showToast('Đang mở tối đa ' + MAX_OPEN_TABS + ' thẻ văn bản!', 'warn');

      importedTab.id = 'tab_' + Date.now() + '_' + Math.floor(Math.random() * 900 + 100);
      importedTab.roleId = normalizeRoleId(importedTab.roleId);
      importedTab.bodyHtml = sanitizeAdminHtml(importedTab.bodyHtml || '');
      importedTab.snapshots = Array.isArray(importedTab.snapshots) ? importedTab.snapshots.map(function(s) {
        s.bodyHtml = sanitizeAdminHtml(s.bodyHtml || '');
        return s;
      }) : [];
      importedTab.chatHistory = Array.isArray(importedTab.chatHistory) ? importedTab.chatHistory : [];
      delete importedTab.lastDiskFileName;
      importedTab.title = deriveShortTabTitle(importedTab);

      APP_STATE.workspaces.push(importedTab);
      APP_STATE.activeTabId = importedTab.id;
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      await persistWorkspacesNow();
      showToast('Đã mở dự án: ' + importedTab.title, 'ok');
    } catch (err) { showToast('Lỗi đọc file .tmv: ' + err.message, 'error'); }
  };
  reader.readAsText(fileObj, 'utf-8');
}

// [STR-04] CHUẨN HÓA MA TRẬN (VAI KÝ × LOẠI VĂN BẢN) ĐÚNG NGHIỆP VỤ NGHỊ ĐỊNH 30
function normalizeRoleId(roleId) {
  if (roleId === 'dept' || roleId === 'dept_to_ubnd') return 'dept';
  return 'ubnd';
}

function getPreferredLocalSignerName(roleId) {
  var p = APP_STATE.profile || {};
  var r = normalizeRoleId(roleId);
  if (r === 'dept' && p.localDeptSigner && p.localDeptSigner.trim()) return p.localDeptSigner.trim();
  if (r === 'ubnd' && p.localUbndSigner && p.localUbndSigner.trim()) return p.localUbndSigner.trim();
  return '[Họ và tên người ký]';
}

function buildDefaultDearLine(roleId, docTypeCode) {
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === docTypeCode; }) || APP_CONFIG.docTypes[0];
  if (docType.dearPolicy === 'none') return '';
  var rId = normalizeRoleId(roleId);
  if (rId === 'dept') {
    if (docTypeCode === 'TTr' || docTypeCode === 'BC') return 'Kính gửi: Ủy ban nhân dân Phường Phú Nhuận.';
    return '';
  }
  // Đứng vai UBND Phường: Báo cáo / Tờ trình phải gửi cấp trên, tuyệt đối không gửi Khu phố!
  if (docTypeCode === 'TTr') return 'Kính gửi: Thường trực Đảng ủy Phường Phú Nhuận.';
  if (docTypeCode === 'BC') return 'Kính gửi: Ủy ban nhân dân Thành phố Hồ Chí Minh.';
  return '';
}

function buildDefaultRecipients(roleId, docTypeCode) {
  var rId = normalizeRoleId(roleId);
  if (rId === 'dept') {
    return '- Như trên;\n- Trưởng phòng, các PTP VH-XH;\n- Lưu: VT, VHXH.';
  }
  if (docTypeCode === 'TTr' || docTypeCode === 'BC') {
    return '- Như trên;\n- TT. Đảng ủy, TT. HĐND Phường (để b/c);\n- CT, các PCT UBND Phường;\n- Lưu: VT, VHXH.';
  }
  return '- Như trên;\n- TT. Đảng ủy, TT. HĐND Phường (để b/c);\n- CT, các PCT UBND Phường;\n- Ủy ban MTTQ và các đoàn thể Phường;\n- Ban Điều hành 24 Khu phố;\n- Lưu: VT, VHXH.';
}

function extractDocNumberValue(docNumStr) {
  var m = String(docNumStr || '').match(/Số:\s*([0-9A-Za-z\-]+)\s*\//i);
  return m ? m[1].trim() : '';
}

function buildFormattedDocNumber(existingNumberPart, isDept, docType) {
  var suffix = isDept ? docType.suffixDept : docType.suffixUbnd;
  if (existingNumberPart) return 'Số: ' + existingNumberPart + '/' + suffix;
  return 'Số:\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0/' + suffix;
}

function createBlankWorkspaceTab(roleId, docTypeCode) {
  var def = APP_CONFIG.defaultOrg;
  var rId = normalizeRoleId(roleId || 'ubnd');
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
    docNumber: buildFormattedDocNumber('', isDept, docType),
    cvSubject: '',
    dateLine: dateStr,
    docTypeName: docType.name.toUpperCase(),
    namedSub: '',
    dearLine: buildDefaultDearLine(rId, dCode),
    bodyHtml: '',
    recipients: buildDefaultRecipients(rId, dCode),
    signerAuth: isDept ? def.deptSignerTitle : def.ubndSignerTitle,
    signerName: getPreferredLocalSignerName(rId),
    snapshots: [],
    chatHistory: [],
    updatedAt: Date.now()
  };
  tab.title = deriveShortTabTitle(tab);
  return tab;
}

function cleanLegacyAutoArtifactsOnTab(w) {
  w.roleId = normalizeRoleId(w.roleId);
  w.snapshots = Array.isArray(w.snapshots) ? w.snapshots : [];
  w.chatHistory = Array.isArray(w.chatHistory) ? w.chatHistory : [];
  w.bodyHtml = sanitizeAdminHtml(w.bodyHtml || '');
  if (w.bodyHtml === '<p><br></p>' || w.bodyHtml === '<p><br /></p>' || w.bodyHtml === '<p></p>') w.bodyHtml = '';

  // Dọn các giá trị mặc định sai từ phiên bản cũ nếu người dùng chưa gõ nội dung thật
  if (w.namedSub === 'Về việc' || w.namedSub === 'Về việc ') w.namedSub = '';
  if (w.cvSubject === 'V/v' || w.cvSubject === 'V/v ') w.cvSubject = '';
  if (w.roleId === 'ubnd' && (w.docType === 'TTr' || w.docType === 'BC') && (w.dearLine || '').indexOf('24 Khu phố') !== -1) {
    w.dearLine = buildDefaultDearLine('ubnd', w.docType);
  }
  if (!w.signerName || !w.signerName.trim()) w.signerName = getPreferredLocalSignerName(w.roleId);
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
    bundle.workspaces.forEach(cleanLegacyAutoArtifactsOnTab);
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

// [STR-05] MỐC HOÀN TÁC ĐẦY ĐỦ 100% TRƯỜNG THỂ THỨC & QUẢN LÝ ĐA TAB
function pushTabSnapshot(labelNote, showVisualFeedback, targetTabObj) {
  var tab = targetTabObj || captureDOMIntoActiveTab(true);
  if (!tab) return;
  tab.snapshots = Array.isArray(tab.snapshots) ? tab.snapshots : [];
  var nowTs = Date.now();
  tab.snapshots.unshift({
    savedAt: nowTs,
    note: labelNote || 'Lưu mốc thủ công',
    docType: tab.docType,
    roleId: tab.roleId,
    fontSize: tab.fontSize,
    orgLine1: tab.orgLine1,
    orgLine2: tab.orgLine2,
    docNumber: tab.docNumber,
    dateLine: tab.dateLine,
    docTypeName: tab.docTypeName,
    cvSubject: tab.cvSubject,
    namedSub: tab.namedSub,
    dearLine: tab.dearLine,
    bodyHtml: tab.bodyHtml,
    recipients: tab.recipients,
    signerAuth: tab.signerAuth,
    signerName: tab.signerName
  });
  if (tab.snapshots.length > MAX_SNAPSHOTS) tab.snapshots = tab.snapshots.slice(0, MAX_SNAPSHOTS);
  if (tab.id === APP_STATE.activeTabId) updateSnapshotUI();
  persistWorkspacesNow();

  if (showVisualFeedback) {
    var btn = el('btnSaveSnapshot');
    if (btn) {
      if (snapshotFlashTimer) clearTimeout(snapshotFlashTimer);
      btn.className = 'bg-emerald-600 text-white px-2.5 py-1 rounded flex items-center gap-1 border border-emerald-400 font-bold transition cursor-pointer';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Đã lưu ' + formatTimeHHMMSS(nowTs) + '</span>';
      snapshotFlashTimer = setTimeout(function() {
        btn.className = 'bg-slate-700 hover:bg-slate-600 text-amber-300 px-2.5 py-1 rounded flex items-center gap-1 border border-slate-600 transition cursor-pointer';
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
    restoreBtn.className = 'flex-1 text-left min-w-0 cursor-pointer';

    var line1 = document.createElement('div');
    line1.className = 'text-xs font-semibold text-blue-800 truncate';
    line1.textContent = '#' + (snaps.length - idx) + ' • ' + formatTimeHHMMSS(s.savedAt) + ' - ' + (s.note || 'Mốc lưu');

    var line2 = document.createElement('div');
    line2.className = 'text-[10.5px] text-slate-500 truncate';
    line2.textContent = '[' + (s.docType || '') + '] ' + (s.namedSub || s.cvSubject || 'Bản dự thảo');

    restoreBtn.appendChild(line1);
    restoreBtn.appendChild(line2);

    restoreBtn.addEventListener('click', function() {
      var cur = getActiveTab();
      if (!cur) return;
      cur.roleId = normalizeRoleId(s.roleId || cur.roleId);
      cur.docType = s.docType || cur.docType;
      cur.fontSize = s.fontSize || cur.fontSize || '14pt';
      if (s.orgLine1 !== undefined) cur.orgLine1 = s.orgLine1;
      if (s.orgLine2 !== undefined) cur.orgLine2 = s.orgLine2;
      if (s.docNumber !== undefined) cur.docNumber = s.docNumber;
      if (s.dateLine !== undefined) cur.dateLine = s.dateLine;
      if (s.docTypeName !== undefined) cur.docTypeName = s.docTypeName;
      cur.cvSubject = s.cvSubject || '';
      cur.namedSub = s.namedSub || '';
      cur.dearLine = s.dearLine || '';
      cur.bodyHtml = sanitizeAdminHtml(s.bodyHtml || '');
      cur.recipients = s.recipients || '';
      if (s.signerAuth !== undefined) cur.signerAuth = s.signerAuth;
      if (s.signerName !== undefined) cur.signerName = s.signerName;
      // Nếu mốc lưu cũ thiếu orgLine1/signerAuth thì tự đồng bộ lại theo Role
      if (!s.orgLine1 || !s.signerAuth) applyRoleOrDocTypeChangeToTab(cur, true, true);
      cur.title = deriveShortTabTitle(cur);
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      el('snapshotDropdown').classList.add('hidden');
      scheduleAutoSave();
      showToast('Đã khôi phục mốc #' + (snaps.length - idx), 'ok');
    });

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'text-slate-400 hover:text-rose-600 px-1.5 py-1 text-xs shrink-0 cursor-pointer';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var cur = getActiveTab();
      if (!cur) return;
      cur.snapshots.splice(idx, 1);
      updateSnapshotUI();
      persistWorkspacesNow();
    });

    row.appendChild(restoreBtn);
    row.appendChild(delBtn);
    box.appendChild(row);
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

    if (tab._isBusy) {
      var spin = document.createElement('i');
      spin.className = 'fa-solid fa-spinner fa-spin text-purple-500 text-[10px]';
      item.appendChild(spin);
    }

    var span = document.createElement('span');
    span.className = 'max-w-[170px] truncate';
    span.textContent = tab.title || deriveShortTabTitle(tab);
    item.addEventListener('click', function() {
      if (tab.id === APP_STATE.activeTabId) return;
      captureDOMIntoActiveTab(true);
      APP_STATE.activeTabId = tab.id;
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      persistWorkspacesNow();
    });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Đóng thẻ này';
    closeBtn.className = 'ml-0.5 w-4 h-4 rounded hover:bg-rose-500 hover:text-white flex items-center justify-center text-[10px] opacity-75 hover:opacity-100 cursor-pointer';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (tab._isBusy) return showToast('Thẻ này đang chạy AI tham mưu, hãy bấm Dừng trước khi đóng!', 'warn');
      if (!confirm('Đóng văn bản "' + (tab.title || '') + '"?')) return;
      if (window.cleanupTabRuntimeState) window.cleanupTabRuntimeState(tab.id);
      APP_STATE.workspaces = APP_STATE.workspaces.filter(function(w) { return w.id !== tab.id; });
      if (APP_STATE.workspaces.length === 0) APP_STATE.workspaces = [createBlankWorkspaceTab('ubnd', 'KH')];
      if (APP_STATE.activeTabId === tab.id) APP_STATE.activeTabId = APP_STATE.workspaces[0].id;
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      await persistWorkspacesNow();
    });

    item.appendChild(span);
    item.appendChild(closeBtn);
    bar.appendChild(item);
  });
}

// [STR-06] HỒ SƠ MÁY CÁ NHÂN, CHỌN KIỂU KÝ 1 CHẠM & ĐỒNG BỘ GIẤY A4
function loadProfileSettings() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tmv_profile_v1')); } catch (e) {}
  APP_STATE.profile = {
    staffName: (saved && saved.staffName) ? saved.staffName : '',
    staffField: (saved && saved.staffField) ? saved.staffField : 'Văn hóa - Xã hội',
    localUbndSigner: (saved && saved.localUbndSigner) ? saved.localUbndSigner : '',
    localDeptSigner: (saved && saved.localDeptSigner) ? saved.localDeptSigner : ''
  };
  if (el('profileBtnLabel')) {
    el('profileBtnLabel').textContent = APP_STATE.profile.staffName ? APP_STATE.profile.staffName : 'Ghi chú máy';
  }
}

function populateSignerPresetDropdown(tab) {
  var sel = el('signerPresetSelect');
  if (!sel || !tab) return;
  var rId = normalizeRoleId(tab.roleId);
  var presets = (APP_CONFIG.signerPresets && APP_CONFIG.signerPresets[rId]) || [];
  sel.innerHTML = '';

  var placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = 'Kiểu ký: Chọn nhanh...';
  sel.appendChild(placeholderOpt);

  var currentNorm = (tab.signerAuth || '').replace(/\r\n/g, '\n').trim();
  var matchedVal = '';
  presets.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    if (p.text === currentNorm) matchedVal = p.id;
    sel.appendChild(opt);
  });
  sel.value = matchedVal;
}

function renderRoleButtons() {
  var tab = getActiveTab();
  var activeRoleId = tab ? normalizeRoleId(tab.roleId) : 'ubnd';
  var wrap = el('roleButtonsContainer');
  if (!wrap) return;
  wrap.innerHTML = '';
  APP_CONFIG.roles.forEach(function(r) {
    var isActive = r.id === activeRoleId;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.title = r.toneDesc;
    btn.className = 'role-card min-h-[42px] rounded-lg px-2.5 py-1.5 flex items-center justify-center gap-2 '
      + (isActive ? 'active text-blue-900' : 'text-slate-700');
    btn.innerHTML = '<i class="' + escapeHtml(r.icon) + ' ' + (isActive ? 'text-blue-700' : 'text-blue-600/80') + ' text-xs shrink-0"></i>'
      + '<span class="flex flex-col items-center leading-[1.22] text-center">'
      + '<span class="role-l1 text-[10.5px] font-medium opacity-85"></span>'
      + '<span class="role-l2 text-[11.5px] font-bold whitespace-nowrap"></span>'
      + '</span>';
    btn.querySelector('.role-l1').textContent = r.line1 || 'Tham mưu';
    btn.querySelector('.role-l2').textContent = r.line2 || r.shortName;
    btn.addEventListener('click', function() {
      var cur = captureDOMIntoActiveTab(true);
      if (!cur || cur.roleId === r.id) return;
      cur.roleId = r.id;
      applyRoleOrDocTypeChangeToTab(cur, true, false);
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      scheduleAutoSave();
    });
    wrap.appendChild(btn);
  });
}

function applyRoleOrDocTypeChangeToTab(tab, roleChanged, keepBodyAndCustomFields) {
  var def = APP_CONFIG.defaultOrg;
  var rId = normalizeRoleId(tab.roleId);
  tab.roleId = rId;
  var role = APP_CONFIG.roles.find(function(r) { return r.id === rId; }) || APP_CONFIG.roles[0];
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
  var isDept = role.orgMode === 'dept';

  tab.orgLine1 = isDept ? def.govParent : def.ubndLine1;
  tab.orgLine2 = isDept ? def.deptName : def.ubndLine2;

  // Giữ lại con số văn bản nếu cán bộ đã điền (VD: Số: 125/KH-UBND -> Số: 125/BC-UBND)
  var existingNum = extractDocNumberValue(tab.docNumber);
  tab.docNumber = buildFormattedDocNumber(existingNum, isDept, docType);
  tab.docTypeName = docType.name.toUpperCase();

  // Đồng bộ trích yếu qua lại nếu đổi giữa Công văn <-> Văn bản có tên loại
  if (docType.isCongVan && !tab.cvSubject && tab.namedSub) {
    var cleanSub = tab.namedSub.replace(/^Về việc\s*/i, '').trim();
    if (cleanSub) tab.cvSubject = 'V/v ' + cleanSub.charAt(0).toLowerCase() + cleanSub.slice(1);
  } else if (!docType.isCongVan && !tab.namedSub && tab.cvSubject) {
    var cleanCv = tab.cvSubject.replace(/^V\/v\s*/i, '').trim();
    if (cleanCv) tab.namedSub = (docType.hasVeViec ? 'Về việc ' : '') + (docType.hasVeViec ? cleanCv : (cleanCv.charAt(0).toUpperCase() + cleanCv.slice(1)));
  }

  if (!keepBodyAndCustomFields) {
    tab.dearLine = buildDefaultDearLine(rId, tab.docType);
    tab.recipients = buildDefaultRecipients(rId, tab.docType);
  }

  if (roleChanged) {
    // Quyết định cá biệt hoặc văn bản thông thường tự chọn chức danh ký chuẩn
    if (!isDept && tab.docType === 'GM') {
      tab.signerAuth = def.ubndSignerTitle;
    } else {
      tab.signerAuth = isDept ? def.deptSignerTitle : def.ubndSignerTitle;
    }
    var prevDefaultUbnd = getPreferredLocalSignerName('ubnd');
    var prevDefaultDept = getPreferredLocalSignerName('dept');
    if (!tab.signerName || tab.signerName === '[Họ và tên người ký]' || tab.signerName === prevDefaultUbnd || tab.signerName === prevDefaultDept) {
      tab.signerName = getPreferredLocalSignerName(rId);
    }
  }
  tab.title = deriveShortTabTitle(tab);
}

function updatePlaceholdersForDocType(docType) {
  var subEl = el('a4NamedSub');
  if (subEl) {
    subEl.setAttribute('data-placeholder', docType.hasVeViec
      ? 'Về việc nhập trích yếu nội dung ' + docType.name.toLowerCase() + '...'
      : 'Nhập tên / chủ đề ' + docType.name + ' (không ghi chữ Về việc)...');
  }
  var dearEl = el('a4DearLine');
  if (dearEl) {
    if (docType.dearPolicy === 'none') {
      dearEl.setAttribute('data-placeholder', '');
    } else {
      dearEl.setAttribute('data-placeholder', 'Kính gửi: ... (Để trống sẽ tự ẩn khi in & xuất Word)');
    }
  }
}

function applyActiveTabToDOM() {
  var tab = getActiveTab();
  if (!tab) return;
  isApplyingTabToDOM = true;
  try {
    var role = APP_CONFIG.roles.find(function(r) { return r.id === normalizeRoleId(tab.roleId); }) || APP_CONFIG.roles[0];
    var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];

    setVal('docTypeSelect', tab.docType);
    setVal('fontSizeSelect', tab.fontSize || '14pt');
    if (el('a4Paper')) el('a4Paper').setAttribute('data-fontsize', tab.fontSize || '14pt');
    if (el('activeRoleBadge')) el('activeRoleBadge').textContent = role.shortName;

    updatePlaceholdersForDocType(docType);

    if (el('a4OrgLine1')) el('a4OrgLine1').textContent = tab.orgLine1 || '';
    if (el('a4OrgLine2')) el('a4OrgLine2').textContent = tab.orgLine2 || '';
    if (el('a4DocNumber')) el('a4DocNumber').textContent = tab.docNumber || '';
    if (el('a4CvSubject')) el('a4CvSubject').textContent = tab.cvSubject || '';
    if (el('a4DateLine')) el('a4DateLine').textContent = tab.dateLine || '';
    if (el('a4DocTypeName')) el('a4DocTypeName').textContent = tab.docTypeName || '';
    if (el('a4NamedSub')) el('a4NamedSub').textContent = tab.namedSub || '';
    if (el('a4DearLine')) {
      el('a4DearLine').textContent = tab.dearLine || '';
      // Chỉ ẩn hoàn toàn Kính gửi ở các loại văn bản không có Kính gửi (KH, QD, TB, CTr, BB) khi rỗng
      var hideDear = (docType.dearPolicy === 'none' && !(tab.dearLine && tab.dearLine.trim()));
      el('a4DearLine').classList.toggle('hidden', hideDear);
    }
    if (el('a4BodyContent')) el('a4BodyContent').innerHTML = sanitizeAdminHtml(tab.bodyHtml || '');
    if (el('a4Recipients')) el('a4Recipients').textContent = tab.recipients || '';
    if (el('a4SignerAuth')) el('a4SignerAuth').textContent = tab.signerAuth || '';
    if (el('a4SignerName')) el('a4SignerName').textContent = tab.signerName || getPreferredLocalSignerName(tab.roleId);

    if (docType.isCongVan) {
      if (el('a4NamedHeader')) el('a4NamedHeader').classList.add('hidden');
      if (el('a4CvSubject')) el('a4CvSubject').classList.remove('hidden');
    } else {
      if (el('a4NamedHeader')) el('a4NamedHeader').classList.remove('hidden');
      if (el('a4CvSubject')) el('a4CvSubject').classList.add('hidden');
    }

    populateSignerPresetDropdown(tab);
    renderRoleButtons();
    updateSnapshotUI();
    updateDearLinePresentation();
    requestAnimationFrame(updatePaperZoomAndPageCount);
  } finally {
    isApplyingTabToDOM = false;
  }
}
window.applyActiveTabToDOM = applyActiveTabToDOM;

// [STR-07] XÁC THỰC MÃ NỘI BỘ, ĐẾM LƯỢT TRẢI NGHIỆM & QUẢN LÝ GEMINI API KEY RIÊNG
function getTodayIsoStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getPinTrialStatus() {
  var limit = (APP_CONFIG && typeof APP_CONFIG.internalPinTrialLimit === 'number') ? APP_CONFIG.internalPinTrialLimit : 5;
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('tmv_pin_trial_v1')); } catch (e) {}
  var used = (saved && typeof saved.used === 'number' && saved.used >= 0) ? saved.used : 0;
  var today = getTodayIsoStr();
  var bonusDate = (saved && saved.bonusDate) ? String(saved.bonusDate) : '';
  var bonusLeft = (bonusDate === today && saved && typeof saved.bonusLeft === 'number' && saved.bonusLeft > 0) ? saved.bonusLeft : 0;
  var baseLeft = Math.max(0, limit - used);
  var totalLeft = baseLeft + bonusLeft;
  var canClaimBonusToday = (totalLeft === 0 && bonusDate !== today);
  return {
    used: used,
    limit: limit,
    baseLeft: baseLeft,
    bonusLeft: bonusLeft,
    bonusDate: bonusDate,
    totalLeft: totalLeft,
    canClaimBonusToday: canClaimBonusToday
  };
}
window.getPinTrialStatus = getPinTrialStatus;

function consumePinTrialTurn() {
  var st = getPinTrialStatus();
  var nextUsed = st.used;
  var nextBonusLeft = st.bonusLeft;
  var nextBonusDate = st.bonusDate;
  if (st.baseLeft > 0) {
    nextUsed = st.used + 1;
  } else if (st.bonusLeft > 0) {
    nextBonusLeft = st.bonusLeft - 1;
    nextBonusDate = getTodayIsoStr();
  }
  localStorage.setItem('tmv_pin_trial_v1', JSON.stringify({
    used: nextUsed,
    bonusDate: nextBonusDate,
    bonusLeft: nextBonusLeft
  }));
  renderApiHeaderBadge(false);
  updatePinTrialModalUI();
  return getPinTrialStatus();
}
window.consumePinTrialTurn = consumePinTrialTurn;

function claimEmergencyPinBonus() {
  var st = getPinTrialStatus();
  var bonusAmount = (APP_CONFIG && typeof APP_CONFIG.internalPinEmergencyBonusPerDay === 'number') ? APP_CONFIG.internalPinEmergencyBonusPerDay : 2;
  var today = getTodayIsoStr();
  if (st.bonusDate === today) {
    showApiNotice('Hôm nay máy này đã nhận +' + bonusAmount + ' lượt chữa cháy rồi! Bạn hãy bấm nút xanh [Mở trang lấy Key Google] tạo Key riêng chỉ mất 30 giây để dùng thoải mái nhé.', false);
    return false;
  }
  localStorage.setItem('tmv_pin_trial_v1', JSON.stringify({
    used: Math.max(st.used, st.limit),
    bonusDate: today,
    bonusLeft: bonusAmount
  }));
  renderApiHeaderBadge(false);
  updatePinTrialModalUI();
  showApiNotice('Đã cấp thêm +' + bonusAmount + ' lượt chữa cháy khẩn cấp cho hôm nay! Sau khi xong việc gấp, bạn nhớ tạo Key riêng ở Cách 2 nhé.', true);
  return true;
}

function updatePinTrialModalUI() {
  var st = getPinTrialStatus();
  var badge = el('pinTrialStatusBadge');
  var bonusRow = el('emergencyBonusRow');
  var hasPersonalKey = Boolean(APP_STATE.api && APP_STATE.api.verified && APP_STATE.api.key && APP_STATE.api.key.trim().length > 10);

  if (badge) {
    if (hasPersonalKey) {
      badge.textContent = 'Đã dùng Key riêng (Không giới hạn)';
      badge.className = 'text-[10.5px] bg-emerald-100 text-emerald-900 font-bold px-2 py-0.5 rounded-full';
    } else if (st.totalLeft > 0) {
      badge.textContent = st.bonusLeft > 0
        ? ('Chữa cháy hôm nay: còn ' + st.totalLeft + ' lượt')
        : ('Trải nghiệm: còn ' + st.baseLeft + '/' + st.limit + ' lượt');
      badge.className = 'text-[10.5px] bg-amber-200/80 text-amber-950 font-bold px-2 py-0.5 rounded-full';
    } else {
      badge.textContent = 'Đã hết ' + st.limit + '/' + st.limit + ' lượt thử';
      badge.className = 'text-[10.5px] bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-full';
    }
  }

  if (bonusRow) {
    var showEmergency = !hasPersonalKey && st.totalLeft === 0 && st.canClaimBonusToday;
    bonusRow.classList.toggle('hidden', !showEmergency);
  }
}
window.updatePinTrialModalUI = updatePinTrialModalUI;

function renderApiHeaderBadge(pendingCheck) {
  var isVerified = APP_STATE.api.verified === true;
  var hasPersonalKey = isVerified && Boolean(APP_STATE.api.key && APP_STATE.api.key.trim().length > 10);
  var hasPin = isVerified && !hasPersonalKey && Boolean(APP_STATE.api.internalPin && APP_STATE.api.internalPin.trim().length > 0);
  var isConfigured = hasPersonalKey || hasPin || Boolean(pendingCheck);

  if (el('firstUseTipBanner')) el('firstUseTipBanner').classList.toggle('hidden', isConfigured);
  if (el('normalSaveBar')) el('normalSaveBar').classList.toggle('hidden', !isConfigured);

  if (pendingCheck) {
    el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-amber-400 animate-pulse';
    el('apiBtnLabel').textContent = 'Đang xác thực Mã...';
    el('btnOpenApiModal').className = 'bg-slate-800 hover:bg-slate-700 border border-amber-400/70 text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
  } else if (hasPersonalKey) {
    el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-emerald-400';
    el('apiBtnLabel').textContent = APP_STATE.api.primaryModel;
    el('btnOpenApiModal').className = 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
  } else if (hasPin) {
    var st = getPinTrialStatus();
    if (st.totalLeft > 0) {
      el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-sky-400';
      el('apiBtnLabel').textContent = 'Mã Phòng (Còn ' + st.totalLeft + ' lượt thử)';
      el('btnOpenApiModal').className = 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
    } else {
      el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-amber-400 animate-pulse';
      el('apiBtnLabel').textContent = 'Hết lượt thử • Lấy Key riêng';
      el('btnOpenApiModal').className = 'bg-amber-500/20 hover:bg-amber-500/30 border-2 border-amber-400 text-amber-200 font-bold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
    }
  } else {
    el('apiStatusDot').className = 'w-2 h-2 rounded-full inline-block bg-rose-500';
    el('apiBtnLabel').textContent = 'Nhập Mã / API Key';
    el('btnOpenApiModal').className = 'bg-amber-500/20 hover:bg-amber-500/30 border-2 border-amber-400 text-amber-200 font-bold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer';
  }
}

async function verifyHashPinInBackground(hashPin) {
  if (!APP_CONFIG.proxyWebAppUrl) return;
  renderApiHeaderBadge(true);
  try {
    var rPin = await fetch(APP_CONFIG.proxyWebAppUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'verify_pin', pin: hashPin })
    });
    var dPin = await rPin.json();
    if (dPin && dPin.success) {
      APP_STATE.api.internalPin = hashPin;
      APP_STATE.api.verified = true;
      localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
      renderApiHeaderBadge(false);
    } else {
      APP_STATE.api.verified = false;
      localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
      renderApiHeaderBadge(false);
      setVal('inpInternalPin', hashPin);
      updatePinTrialModalUI();
      openModalSafe('modalApi');
      showApiNotice((dPin && dPin.message) ? dPin.message : 'Mã nội bộ trên đường dẫn không chính xác hoặc đã đổi mới!', false);
    }
  } catch (e) {
    // Mạng chập chờn tạm thời vẫn giữ PIN để thử lại khi gọi thực tế
    APP_STATE.api.verified = true;
    renderApiHeaderBadge(false);
  }
}

function loadApiSettings() {
  try {
    var saved = JSON.parse(localStorage.getItem('tmv_api_v1'));
    if (saved) APP_STATE.api = Object.assign(APP_STATE.api, saved);
  } catch (e) {}

  var pendingHashPin = '';
  if (window.location.hash && window.location.hash.indexOf('#pin=') === 0) {
    pendingHashPin = decodeURIComponent(window.location.hash.substring(5)).trim();
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
    if (pendingHashPin) {
      if (!APP_STATE.api.verified) APP_STATE.api.key = '';
      APP_STATE.api.internalPin = pendingHashPin;
    }
  }

  populateModelSelect();
  updatePinTrialModalUI();
  if (pendingHashPin && !(APP_STATE.api.verified && APP_STATE.api.key)) {
    verifyHashPinInBackground(pendingHashPin);
  } else {
    renderApiHeaderBadge(false);
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
  if (!key) return showApiNotice('Hãy dán Gemini API Key cá nhân ở ô trên trước khi quét danh sách Model!', false);
  showApiNotice('Đang quét danh sách Model khả dụng từ Google AI...', true);
  try {
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
    var data = await res.json();
    if (!res.ok || !data.models) return showApiNotice('Lỗi Key: ' + ((data.error && data.error.message) || 'Không hợp lệ'), false);
    var blocked = ['tts', 'image', 'embedding', 'imagen', 'veo', 'robotics', 'computer-use', 'audio', 'aqa', 'omni', 'learnlm'];
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
    var chosen = getVal('selModelPrimary') || 'gemini-2.5-flash';
    showApiNotice('Đang kiểm tra tốc độ Key cá nhân [' + chosen + ']...', true);
    var t0 = Date.now();
    try {
      var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + chosen + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Trả lời 2 từ: Sẵn sàng.' }] }] })
      });
      var data = await res.json();
      if (res.ok && data.candidates && data.candidates[0]) return showApiNotice('Key cá nhân thông suốt [' + chosen + '] — Phản hồi cực nhanh ' + (Date.now() - t0) + 'ms!', true);
      return showApiNotice('Model từ chối: ' + ((data.error && data.error.message) || 'Hãy bấm Quét danh sách Model rồi chọn Model khác.'), false);
    } catch (e) { return showApiNotice('Lỗi mạng: ' + e.message, false); }
  }
  if (pin) {
    if (!APP_CONFIG.proxyWebAppUrl) return showApiNotice('Chưa cấu hình proxyWebAppUrl trong config.js!', false);
    showApiNotice('Đang kiểm tra Mã nội bộ qua Trạm Gác...', true);
    var tp0 = Date.now();
    try {
      var r2 = await fetch(APP_CONFIG.proxyWebAppUrl, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'verify_pin', pin: pin })
      });
      var d2 = await r2.json();
      if (d2 && d2.success) return showApiNotice('Mã nội bộ chính xác (' + (Date.now() - tp0) + 'ms)! Sẵn sàng sử dụng.', true);
      return showApiNotice('Trạm Gác báo: ' + ((d2 && d2.message) || 'Sai Mã nội bộ!'), false);
    } catch (e2) { return showApiNotice('Lỗi nối Trạm Gác: ' + e2.message, false); }
  }
  showApiNotice('Vui lòng nhập Mã nội bộ (Cách 1) hoặc API Key cá nhân (Cách 2) trước!', false);
}

// [STR-08] TỦ HỒ SƠ PC THÔNG MINH (HIỂN THỊ RÕ TRẠNG THÁI PDF SCAN & TỰ MỞ RỘNG)
function setCabinetExpanded(expanded) {
  APP_STATE.cabinetCollapsed = !expanded;
  if (el('cabinetBodyWrap')) el('cabinetBodyWrap').classList.toggle('hidden', APP_STATE.cabinetCollapsed);
  if (el('cabinetChevronIcon')) {
    el('cabinetChevronIcon').className = 'fa-solid text-[10px] text-slate-500 ' + (APP_STATE.cabinetCollapsed ? 'fa-chevron-right' : 'fa-chevron-down');
  }
}

async function pickCabinetFolder() {
  if (window.showDirectoryPicker && window.isSecureContext) {
    try {
      var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      APP_STATE.dirHandle = handle; APP_STATE.dirWritable = true;
      await saveDirHandleToDB(handle);
      await scanDirectoryHandle(handle);
      setCabinetExpanded(true);
      if (el('diskStatusBadge')) {
        el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> <span>Đã nối ổ cứng PC</span>';
      }
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
    var rec = { id: item.relPath, name: name, ext: ext, size: f.size, lastModified: f.lastModified, isPinned: isPin, isScanNotice: false, checked: true, fileObj: f };
    if (isPin) pinned.push(rec); else if ((now - f.lastModified) <= maxAgeMs) recent.push(rec);
  });
  pinned.sort(function(a, b) { return b.lastModified - a.lastModified; });
  recent.sort(function(a, b) { return b.lastModified - a.lastModified; });
  APP_STATE.cabinetFiles = pinned.concat(recent.slice(0, APP_CONFIG.defaultOrg.folderRuleMaxFiles));
  if (el('cabinetCountBadge')) el('cabinetCountBadge').textContent = '(' + APP_STATE.cabinetFiles.length + ')';
  if (el('cabinetSummaryBar')) {
    el('cabinetSummaryBar').innerHTML = '<b></b> <span></span>';
    el('cabinetSummaryBar').querySelector('b').textContent = folderLabel;
    el('cabinetSummaryBar').querySelector('span').textContent = '(' + pinned.length + ' ghim, ' + Math.min(recent.length, APP_CONFIG.defaultOrg.folderRuleMaxFiles) + ' mới)';
  }
  setCabinetExpanded(true);
  renderCabinetList();
}

function renderCabinetList() {
  var box = el('cabinetFileList'), list = APP_STATE.cabinetFiles;
  if (!box) return;
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="text-[11px] text-slate-400 py-1.5 text-center">Không có file mới trong ' + APP_CONFIG.defaultOrg.folderRuleDays + ' ngày qua.</div>';
    return;
  }
  list.forEach(function(item, idx) {
    var icon = item.ext === 'pdf' ? 'fa-file-pdf text-rose-600' : (item.ext.indexOf('xl') === 0 ? 'fa-file-excel text-emerald-600' : 'fa-file-word text-blue-600');
    var row = document.createElement('div');
    row.className = 'flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] ' + (item.isPinned ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:bg-slate-50');

    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = Boolean(item.checked);
    chk.className = 'rounded text-blue-600 cursor-pointer shrink-0';
    chk.addEventListener('change', function(e) { APP_STATE.cabinetFiles[idx].checked = e.target.checked; });

    var ic = document.createElement('i');
    ic.className = 'fa-solid ' + icon + ' shrink-0';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'truncate flex-1 text-slate-800 cursor-pointer';
    nameSpan.textContent = item.name;
    nameSpan.title = item.name;
    nameSpan.addEventListener('click', function() { chk.checked = !chk.checked; APP_STATE.cabinetFiles[idx].checked = chk.checked; });

    row.appendChild(chk);
    row.appendChild(ic);
    row.appendChild(nameSpan);

    // Nếu phát hiện là PDF Scan không lớp chữ: hiện nút 1 chạm chuyển sang Đính kèm đề bài để đọc ảnh Vision
    if (item.isScanNotice) {
      var promoteBtn = document.createElement('button');
      promoteBtn.type = 'button';
      promoteBtn.title = 'File PDF Scan dấu đỏ: Bấm để chuyển lên Đính kèm đề bài cho AI đọc ảnh trực tiếp';
      promoteBtn.className = 'shrink-0 bg-amber-200 hover:bg-amber-300 text-amber-950 text-[9.5px] font-bold px-1.5 py-0.5 rounded cursor-pointer';
      promoteBtn.textContent = 'Đọc Scan';
      promoteBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (window.addFilesToActiveTabTasks) {
          window.addFilesToActiveTabTasks([item.fileObj]);
          item.checked = false;
          renderCabinetList();
          showToast('Đã đưa [' + item.name + '] lên mục Đề bài để đọc ảnh Scan!', 'ok');
        }
      });
      row.appendChild(promoteBtn);
    }

    box.appendChild(row);
  });
}
window.renderCabinetList = renderCabinetList;

// [STR-09] KHỞI TẠO SỰ KIỆN GIAO DIỆN PC, CLEAN PASTE & THANH ĐỊNH DẠNG NHANH
function setupCleanPasteOnPaper() {
  var bodyEl = el('a4BodyContent');
  if (bodyEl) {
    bodyEl.addEventListener('paste', function(e) {
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      e.preventDefault();
      var html = cd.getData('text/html');
      var plain = cd.getData('text/plain') || '';
      var cleanInsert = '';
      if (html && html.trim()) {
        cleanInsert = sanitizeAdminHtml(html);
      } else if (plain) {
        cleanInsert = plain.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; }).map(function(l) {
          return '<p>' + escapeHtml(l.trim()) + '</p>';
        }).join('');
      }
      if (cleanInsert) {
        document.execCommand('insertHTML', false, cleanInsert);
        scheduleAutoSave();
      }
    });
  }

  // Các ô tiêu đề / kính gửi / nơi nhận / chữ ký chỉ nhận văn bản thuần khi Ctrl+V để không vỡ phông chữ
  ['a4OrgLine1', 'a4OrgLine2', 'a4DocNumber', 'a4CvSubject', 'a4DateLine', 'a4DocTypeName', 'a4NamedSub', 'a4DearLine', 'a4Recipients', 'a4SignerAuth', 'a4SignerName'].forEach(function(id) {
    var node = el(id);
    if (!node) return;
    node.addEventListener('paste', function(e) {
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      e.preventDefault();
      var txt = cd.getData('text/plain') || '';
      document.execCommand('insertText', false, txt);
      scheduleAutoSave();
    });
  });
}

function setupPaperFormattingToolbar() {
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

  function bindFmtBtn(id, cmd) {
    var b = el(id);
    if (!b) return;
    b.addEventListener('mousedown', function(e) { e.preventDefault(); });
    b.addEventListener('click', function() {
      document.execCommand(cmd, false, null);
      scheduleAutoSave();
    });
  }
  bindFmtBtn('btnFmtBold', 'bold');
  bindFmtBtn('btnFmtItalic', 'italic');
  bindFmtBtn('btnFmtUnderline', 'underline');

  if (el('btnFmtCenter')) {
    el('btnFmtCenter').addEventListener('mousedown', function(e) { e.preventDefault(); });
    el('btnFmtCenter').addEventListener('click', function() {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var node = sel.anchorNode;
      while (node && node !== el('a4BodyContent') && node.nodeType !== 1) node = node.parentNode;
      while (node && node !== el('a4BodyContent') && ['P', 'DIV', 'H1', 'H2', 'H3', 'H4'].indexOf(node.tagName) === -1) node = node.parentNode;
      if (node && node !== el('a4BodyContent')) {
        var isCentered = node.style.textAlign === 'center';
        node.style.textAlign = isCentered ? 'justify' : 'center';
        node.style.textIndent = isCentered ? '' : '0';
        scheduleAutoSave();
      }
    });
  }

  // Nút Xóa khung/bảng & tự xóa khung bảng rỗng bằng phím Backspace/Delete trực tiếp trên trang A4
  function findTableInsideBody(startNode) {
    var bodyEl = el('a4BodyContent');
    if (!bodyEl || !startNode || !bodyEl.contains(startNode)) return null;
    var cur = startNode.nodeType === 1 ? startNode : startNode.parentNode;
    while (cur && cur !== bodyEl) {
      if (cur.tagName === 'TABLE') return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function removeTableSafelyFromBody(tbl) {
    var bodyEl = el('a4BodyContent');
    if (!tbl || !bodyEl || !bodyEl.contains(tbl)) return;
    var nextFocus = tbl.nextElementSibling || tbl.previousElementSibling;
    tbl.remove();
    if (!bodyEl.children.length && !(bodyEl.textContent || '').trim()) {
      var p = document.createElement('p');
      p.innerHTML = '<br>';
      bodyEl.appendChild(p);
      nextFocus = p;
    }
    if (nextFocus) {
      try {
        var r = document.createRange();
        r.selectNodeContents(nextFocus);
        r.collapse(true);
        var s = window.getSelection();
        if (s) { s.removeAllRanges(); s.addRange(r); }
      } catch (e) {}
    }
    scheduleAutoSave();
  }

  if (el('btnRemoveTable')) {
    el('btnRemoveTable').addEventListener('mousedown', function(e) { e.preventDefault(); });
    el('btnRemoveTable').addEventListener('click', function() {
      var sel = window.getSelection();
      var activeTbl = (sel && sel.rangeCount) ? findTableInsideBody(sel.anchorNode) : null;
      if (activeTbl) {
        var hasText = (activeTbl.textContent || '').replace(/\u00A0/g, '').trim().length > 0;
        if (hasText && !confirm('Xóa toàn bộ bảng biểu đang đặt con trỏ? (Hệ thống vẫn tự chụp 1 Mốc lưu để bạn hoàn tác nếu cần)')) return;
        if (hasText) pushTabSnapshot('Trước khi xóa bảng biểu', false);
        removeTableSafelyFromBody(activeTbl);
        showToast(hasText ? 'Đã xóa bảng biểu khỏi trang giấy A4!' : 'Đã xóa khung kẻ ô rỗng!', 'ok');
        return;
      }
      var swept = purgeEmptyTablesInLiveBody();
      if (swept > 0) {
        scheduleAutoSave();
        showToast('Đã dọn sạch ' + swept + ' khung kẻ ô rỗng còn sót trên trang A4!', 'ok');
      } else {
        showToast('Hãy bấm con trỏ vào bên trong bảng cần xóa rồi bấm lại nút [Xóa khung/bảng]!', 'warn');
      }
    });
  }

  if (el('a4BodyContent')) {
    el('a4BodyContent').addEventListener('keydown', function(e) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      var bodyEl = el('a4BodyContent');

      // Trường hợp 1: Con trỏ đang nằm bên trong một khung <table> rỗng chữ
      var tbl = findTableInsideBody(sel.anchorNode);
      if (tbl) {
        var txt = (tbl.textContent || '').replace(/\u00A0/g, '').trim();
        if (!txt) {
          e.preventDefault();
          removeTableSafelyFromBody(tbl);
          return;
        }
      }

      // Trường hợp 2: Đặt con trỏ ở đầu đoạn văn ngay dưới một khung <table> rỗng rồi bấm Backspace
      if (e.key === 'Backspace' && sel.anchorOffset === 0) {
        var blk = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode);
        while (blk && blk.parentNode !== bodyEl) blk = blk.parentNode;
        if (blk && blk.previousElementSibling && blk.previousElementSibling.tagName === 'TABLE') {
          var prevTbl = blk.previousElementSibling;
          if (!(prevTbl.textContent || '').replace(/\u00A0/g, '').trim()) {
            e.preventDefault();
            prevTbl.remove();
            scheduleAutoSave();
          }
        }
      }
    });
  }

  if (el('signerPresetSelect')) {
    el('signerPresetSelect').addEventListener('change', function(e) {
      var val = e.target.value;
      if (!val) return;
      var cur = captureDOMIntoActiveTab(true);
      if (!cur) return;
      var presets = (APP_CONFIG.signerPresets && APP_CONFIG.signerPresets[normalizeRoleId(cur.roleId)]) || [];
      var found = presets.find(function(p) { return p.id === val; });
      if (found) {
        cur.signerAuth = found.text;
        if (el('a4SignerAuth')) el('a4SignerAuth').textContent = found.text;
        scheduleAutoSave();
        showToast('Đã đổi kiểu ký: ' + found.label, 'ok');
      }
    });
  }

  if (el('btnCopyCleanText')) {
    el('btnCopyCleanText').addEventListener('click', async function() {
      var tab = captureDOMIntoActiveTab(true);
      if (!tab) return;
      var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
      var headerTitle = docType.isCongVan ? tab.cvSubject : (tab.docTypeName + (tab.namedSub ? ('\n' + tab.namedSub) : ''));
      var bodyPlain = el('a4BodyContent') ? el('a4BodyContent').innerText.trim() : '';
      var full = [headerTitle, tab.dearLine, bodyPlain, 'Nơi nhận:\n' + (tab.recipients || ''), (tab.signerAuth || '') + '\n\n' + (tab.signerName || '')].filter(Boolean).join('\n\n');
      try {
        await navigator.clipboard.writeText(full);
        showToast('Đã sao chép toàn bộ nội dung văn bản vào Clipboard!', 'ok');
      } catch (err) {
        showToast('Không thể truy cập Clipboard tự động trên trình duyệt này.', 'warn');
      }
    });
  }

  if (el('btnPrintPdf')) {
    el('btnPrintPdf').addEventListener('click', function() {
      captureDOMIntoActiveTab(true);
      window.print();
    });
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  loadProfileSettings();
  loadApiSettings();

  // Thu phóng & thu gọn cột trái tối ưu cho Chia đôi màn hình PC
  function toggleSidebarCollapse() {
    APP_STATE.sidebarCollapsed = !APP_STATE.sidebarCollapsed;
    if (el('leftSidebar')) el('leftSidebar').classList.toggle('sidebar-collapsed', APP_STATE.sidebarCollapsed);
    setTimeout(updatePaperZoomAndPageCount, 170);
  }
  if (el('btnToggleSidebar')) el('btnToggleSidebar').addEventListener('click', toggleSidebarCollapse);

  if (el('zoomSelect')) {
    el('zoomSelect').addEventListener('change', function(e) {
      APP_STATE.zoomMode = e.target.value || 'fit';
      updatePaperZoomAndPageCount();
    });
  }
  if (window.ResizeObserver && el('a4ScrollDesk')) {
    new ResizeObserver(function() { updatePaperZoomAndPageCount(); }).observe(el('a4ScrollDesk'));
  } else {
    window.addEventListener('resize', updatePaperZoomAndPageCount);
  }

  // Hộp Ghi chú máy & Chữ ký cục bộ PC
  el('btnOpenProfile').addEventListener('click', function() {
    setVal('inpStaffName', APP_STATE.profile.staffName);
    setVal('inpStaffField', APP_STATE.profile.staffField);
    setVal('inpLocalUbndSigner', APP_STATE.profile.localUbndSigner);
    setVal('inpLocalDeptSigner', APP_STATE.profile.localDeptSigner);
    setVal('inpLocalFacts', localStorage.getItem('tmv_local_facts_v1') || APP_CONFIG.defaultOrg.localFacts);
    openModalSafe('modalProfile');
  });
  el('btnCloseProfile').addEventListener('click', function() { closeModalSafe('modalProfile'); });
  el('modalProfile').addEventListener('click', function(e) { if (e.target === el('modalProfile')) closeModalSafe('modalProfile'); });
  el('btnResetLocalFacts').addEventListener('click', function() { setVal('inpLocalFacts', APP_CONFIG.defaultOrg.localFacts); });
  el('btnSaveProfile').addEventListener('click', function() {
    APP_STATE.profile = {
      staffName: getVal('inpStaffName'),
      staffField: getVal('inpStaffField') || 'Văn hóa - Xã hội',
      localUbndSigner: getVal('inpLocalUbndSigner'),
      localDeptSigner: getVal('inpLocalDeptSigner')
    };
    localStorage.setItem('tmv_profile_v1', JSON.stringify(APP_STATE.profile));
    localStorage.setItem('tmv_local_facts_v1', getVal('inpLocalFacts'));
    loadProfileSettings();
    // Cập nhật ngay trên trang hiện tại nếu đang để mặc định [Họ và tên người ký]
    var cur = captureDOMIntoActiveTab(true);
    if (cur && (!cur.signerName || cur.signerName === '[Họ và tên người ký]')) {
      cur.signerName = getPreferredLocalSignerName(cur.roleId);
      window.applyActiveTabToDOM();
      scheduleAutoSave();
    }
    closeModalSafe('modalProfile');
    showToast('Đã lưu thiết lập bàn làm việc trên máy này!', 'ok');
  });

  // Hộp Kết nối AI (Tách riêng nút con mắt, đếm lượt dùng thử & nút Xóa Key lưu trên máy)
  el('btnOpenApiModal').addEventListener('click', function() {
    if (el('inpInternalPin')) el('inpInternalPin').type = 'password';
    if (el('inpApiKey')) el('inpApiKey').type = 'password';
    if (el('apiTestResultBox')) el('apiTestResultBox').classList.add('hidden');
    setVal('inpInternalPin', APP_STATE.api.internalPin || '');
    setVal('inpApiKey', APP_STATE.api.key || '');
    populateModelSelect();
    updatePinTrialModalUI();
    openModalSafe('modalApi');
  });
  el('btnCloseApi').addEventListener('click', function() { closeModalSafe('modalApi'); });
  el('modalApi').addEventListener('click', function(e) { if (e.target === el('modalApi')) closeModalSafe('modalApi'); });

  if (el('btnTogglePinVis')) {
    el('btnTogglePinVis').addEventListener('click', function() {
      var p = el('inpInternalPin');
      if (p) p.type = p.type === 'password' ? 'text' : 'password';
    });
  }
  el('btnToggleKeyVis').addEventListener('click', function() {
    var k = el('inpApiKey');
    if (k) k.type = k.type === 'password' ? 'text' : 'password';
  });

  if (el('btnClaimEmergencyBonus')) {
    el('btnClaimEmergencyBonus').addEventListener('click', function() {
      claimEmergencyPinBonus();
    });
  }

  if (el('btnClearSavedKeys')) {
    el('btnClearSavedKeys').addEventListener('click', function() {
      if (!confirm('Xóa sạch API Key và Mã nội bộ đang nhớ trong trình duyệt máy này?')) return;
      APP_STATE.api = {
        internalPin: '',
        key: '',
        primaryModel: 'gemini-3.5-flash',
        liveModels: [],
        verified: false
      };
      localStorage.removeItem('tmv_api_v1');
      setVal('inpInternalPin', '');
      setVal('inpApiKey', '');
      populateModelSelect();
      renderApiHeaderBadge(false);
      updatePinTrialModalUI();
      showApiNotice('Đã xóa sạch Key và Mã nhớ trong cache trình duyệt máy này!', true);
    });
  }

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
      renderApiHeaderBadge(false);
      updatePinTrialModalUI();
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
          renderApiHeaderBadge(false);
          updatePinTrialModalUI();
          showApiNotice('API Key cá nhân không hợp lệ! Vui lòng kiểm tra lại hoặc bấm [Xóa Key máy này] nếu muốn dùng thử Mã nội bộ.', false);
          return;
        }
        APP_STATE.api.key = key;
        APP_STATE.api.internalPin = pin;
        APP_STATE.api.primaryModel = getVal('selModelPrimary') || 'gemini-3.5-flash';
        APP_STATE.api.verified = true;
        localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
        renderApiHeaderBadge(false);
        updatePinTrialModalUI();
        closeModalSafe('modalApi');
        showToast('Đã kích hoạt Gemini API Key cá nhân (Dùng không giới hạn)!', 'ok');
        return;
      }

      if (!APP_CONFIG.proxyWebAppUrl) {
        showApiNotice('Chưa cấu hình proxyWebAppUrl trong config.js!', false);
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
        renderApiHeaderBadge(false);
        updatePinTrialModalUI();
        showApiNotice((dPin && dPin.message) ? dPin.message : 'Mã nội bộ không chính xác!', false);
        return;
      }

      APP_STATE.api.internalPin = pin;
      APP_STATE.api.key = '';
      APP_STATE.api.verified = true;
      localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
      renderApiHeaderBadge(false);
      updatePinTrialModalUI();
      closeModalSafe('modalApi');
      var stNow = getPinTrialStatus();
      showToast('Đã kích hoạt Mã nội bộ (Còn ' + stNow.totalLeft + ' lượt dùng thử trên máy này)!', 'ok');
    } catch (err) {
      APP_STATE.api.verified = false;
      renderApiHeaderBadge(false);
      showApiNotice('Không kết nối được máy chủ xác thực: ' + err.message, false);
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  });

  // Mốc hoàn tác
  el('btnSaveSnapshot').addEventListener('click', function(e) { e.stopPropagation(); pushTabSnapshot('Lưu tay', true); });
  el('btnToggleSnapshots').addEventListener('click', function(e) { e.stopPropagation(); el('snapshotDropdown').classList.toggle('hidden'); });
  el('snapshotDropdown').addEventListener('click', function(e) { e.stopPropagation(); });
  el('btnClearSnapshots').addEventListener('click', function() {
    var cur = getActiveTab();
    if (!cur || !cur.snapshots || !cur.snapshots.length) return;
    if (!confirm('Xóa toàn bộ mốc hoàn tác của văn bản này?')) return;
    cur.snapshots = []; updateSnapshotUI(); persistWorkspacesNow();
  });
  document.addEventListener('click', function() { if (el('snapshotDropdown')) el('snapshotDropdown').classList.add('hidden'); });

  // Tủ hồ sơ PC
  el('btnToggleCabinetBody').addEventListener('click', function() { setCabinetExpanded(APP_STATE.cabinetCollapsed); });

  // Nạp danh mục 9 loại văn bản Nghị định 30
  APP_CONFIG.docTypes.forEach(function(d) {
    var opt = document.createElement('option'); opt.value = d.code; opt.textContent = d.name;
    el('docTypeSelect').appendChild(opt);
  });

  await loadSavedWorkspacesOrInit();
  window.applyActiveTabToDOM();
  renderWorkspaceTabsBar();

  setupCleanPasteOnPaper();
  setupPaperFormattingToolbar();

  el('a4Paper').addEventListener('input', scheduleAutoSave);
  el('docTypeSelect').addEventListener('change', function(e) {
    var cur = captureDOMIntoActiveTab(true);
    if (!cur) return;
    var hadCustomBody = Boolean(cur.bodyHtml && cur.bodyHtml.trim().length > 10);
    cur.docType = e.target.value;
    applyRoleOrDocTypeChangeToTab(cur, false, hadCustomBody);
    if (!hadCustomBody) {
      cur.dearLine = buildDefaultDearLine(cur.roleId, cur.docType);
      cur.recipients = buildDefaultRecipients(cur.roleId, cur.docType);
    }
    window.applyActiveTabToDOM();
    renderWorkspaceTabsBar();
    scheduleAutoSave();
  });
  el('fontSizeSelect').addEventListener('change', function(e) {
    el('a4Paper').setAttribute('data-fontsize', e.target.value);
    scheduleAutoSave();
  });

  // Nút "+ Soạn mới": Kế thừa vai đang chọn (hoặc mặc định chuẩn Tờ trình Phòng trình UBND khi tạo tab mới)
  el('btnNewTab').addEventListener('click', async function() {
    var cur = captureDOMIntoActiveTab(true);
    if (APP_STATE.workspaces.length >= MAX_OPEN_TABS) return showToast('Đang mở tối đa ' + MAX_OPEN_TABS + ' văn bản!', 'warn');
    var nextRole = cur ? normalizeRoleId(cur.roleId) : 'dept';
    var nextType = nextRole === 'dept' ? 'TTr' : 'CV';
    var nt = createBlankWorkspaceTab(nextRole, nextType);
    APP_STATE.workspaces.push(nt);
    APP_STATE.activeTabId = nt.id;
    window.applyActiveTabToDOM();
    renderWorkspaceTabsBar();
    if (el('aiPromptInput')) el('aiPromptInput').value = '';
    await persistWorkspacesNow();
  });

  // Nút "Làm trắng trang": Dọn sạch nháp cũ trên thẻ hiện tại (vẫn tự chụp 1 Mốc lưu phòng hờ bấm nhầm!)
  if (el('btnResetBlankPage')) {
    el('btnResetBlankPage').addEventListener('click', async function() {
      var cur = captureDOMIntoActiveTab(true);
      if (!cur) return;
      if (cur._isBusy) return showToast('Văn bản này đang chạy AI, hãy dừng trước khi làm trắng!', 'warn');
      if ((cur.bodyHtml && cur.bodyHtml.length > 15) || cur.namedSub || cur.cvSubject) {
        if (!confirm('Làm trắng nội dung văn bản hiện tại về mẫu khung mới? (Hệ thống vẫn tự giữ 1 Mốc lưu để bạn hoàn tác nếu cần)')) return;
        pushTabSnapshot('Trước khi làm trắng trang', false, cur);
      }
      var fresh = createBlankWorkspaceTab(cur.roleId, cur.docType);
      cur.orgLine1 = fresh.orgLine1;
      cur.orgLine2 = fresh.orgLine2;
      cur.docNumber = fresh.docNumber;
      cur.cvSubject = '';
      cur.dateLine = fresh.dateLine;
      cur.docTypeName = fresh.docTypeName;
      cur.namedSub = '';
      cur.dearLine = fresh.dearLine;
      cur.bodyHtml = '';
      cur.recipients = fresh.recipients;
      cur.signerAuth = fresh.signerAuth;
      cur.signerName = fresh.signerName;
      cur.chatHistory = [];
      cur.title = deriveShortTabTitle(cur);
      if (window.cleanupTabRuntimeState) window.cleanupTabRuntimeState(cur.id);
      window.applyActiveTabToDOM();
      renderWorkspaceTabsBar();
      await persistWorkspacesNow();
      showToast('Đã làm mới trang giấy chuẩn Nghị định 30!', 'ok');
    });
  }

  el('btnSaveTmvFile').addEventListener('click', function() { writeTabTmvToDisk(captureDOMIntoActiveTab(true), true); });
  el('btnOpenTmvFile').addEventListener('click', function() { el('tmvFileInput').click(); });
  el('tmvFileInput').addEventListener('change', function(e) { if (e.target.files && e.target.files[0]) importTmvProjectFile(e.target.files[0]); e.target.value = ''; });

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      var tab = captureDOMIntoActiveTab(true); persistWorkspacesNow(); writeTabTmvToDisk(tab, true);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      // Nếu không đang đặt con trỏ trong vùng gõ chữ A4 thì Ctrl+B dùng để đóng/mở nhanh cột trái PC
      var act = document.activeElement;
      if (!act || !act.isContentEditable) {
        e.preventDefault();
        toggleSidebarCollapse();
      }
    } else if (e.key === 'Escape') {
      closeModalSafe('modalProfile');
      closeModalSafe('modalApi');
      if (el('snapshotDropdown')) el('snapshotDropdown').classList.add('hidden');
    }
  });

  el('btnPickFolder').addEventListener('click', pickCabinetFolder);
  el('btnRefreshFolder').addEventListener('click', async function() {
    if (APP_STATE.dirHandle) {
      try {
        var perm = await APP_STATE.dirHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          APP_STATE.dirWritable = true;
          await scanDirectoryHandle(APP_STATE.dirHandle);
          if (el('diskStatusBadge')) el('diskStatusBadge').innerHTML = '<i class="fa-solid fa-hard-drive text-emerald-400"></i> <span>Đã nối ổ cứng PC</span>';
          showToast('Đã làm mới Tủ hồ sơ PC!', 'ok');
        }
      } catch (err) { pickCabinetFolder(); }
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
    if (el('cabinetSummaryBar')) {
      el('cabinetSummaryBar').innerHTML = 'Đã nhớ: <b></b> (Bấm <i class="fa-solid fa-arrows-rotate"></i> để nạp)';
      el('cabinetSummaryBar').querySelector('b').textContent = savedHandle.name;
    }
  }
});
