// [AI-01] NẠP LƯỜI THƯ VIỆN SIÊU TỐC (LAZY-LOAD) & CÔ LẬP TRẠNG THÁI THEO TỪNG TAB
var LOADED_SCRIPTS_CACHE = {};

function loadScriptOnce(url) {
  if (LOADED_SCRIPTS_CACHE[url]) return LOADED_SCRIPTS_CACHE[url];
  LOADED_SCRIPTS_CACHE[url] = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = function() { resolve(true); };
    s.onerror = function() {
      delete LOADED_SCRIPTS_CACHE[url];
      reject(new Error('Không tải được thư viện: ' + url));
    };
    document.head.appendChild(s);
  });
  return LOADED_SCRIPTS_CACHE[url];
}

async function ensureLibLoaded(urls, checkReadyFn, libLabel) {
  if (checkReadyFn()) return;
  var list = Array.isArray(urls) ? urls : [urls];
  var lastErr = null;
  for (var i = 0; i < list.length; i++) {
    try {
      await loadScriptOnce(list[i]);
      if (checkReadyFn()) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Không thể nạp thư viện ' + libLabel + '. Vui lòng kiểm tra kết nối mạng!');
}

async function ensureMammothLoaded() {
  await ensureLibLoaded(APP_CONFIG.cdnLibs.mammoth, function() { return Boolean(window.mammoth); }, 'đọc Word (.docx)');
  return window.mammoth;
}

async function ensureXlsxLoaded() {
  await ensureLibLoaded(APP_CONFIG.cdnLibs.xlsx, function() { return Boolean(window.XLSX); }, 'đọc Excel (.xlsx)');
  return window.XLSX;
}

async function ensurePdfJsLoaded() {
  await ensureLibLoaded(APP_CONFIG.cdnLibs.pdfMain, function() { return Boolean(window.pdfjsLib); }, 'đọc PDF');
  if (window.location.protocol === 'file:') {
    if (!window.pdfjsWorker) {
      try { await loadScriptOnce(APP_CONFIG.cdnLibs.pdfWorker); } catch (e) {}
    }
  } else {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = APP_CONFIG.cdnLibs.pdfWorker;
  }
  return window.pdfjsLib;
}

async function ensureDocxLibraryLoaded() {
  await ensureLibLoaded(APP_CONFIG.cdnLibs.docx, function() { return Boolean(window.docx); }, 'xuất Word (.docx)');
  return window.docx;
}

// Tách biệt hoàn toàn file đề bài & luồng chạy AI theo từng Tab văn bản (Chống ghi đè chéo Tab 100%)
var TAB_RUNTIME_MAP = {};
var SELECTION_STATE = {
  tabId: '',
  savedRange: null,
  savedSelectedText: '',
  isRunning: false
};

function getTabRuntime(tabId) {
  var id = tabId || APP_STATE.activeTabId;
  if (!TAB_RUNTIME_MAP[id]) {
    TAB_RUNTIME_MAP[id] = { taskFiles: [], abortCtrl: null, userCancelled: false };
  }
  return TAB_RUNTIME_MAP[id];
}

function clearSelectionState() {
  SELECTION_STATE.savedRange = null;
  SELECTION_STATE.savedSelectedText = '';
  SELECTION_STATE.tabId = '';
  if (el('selectionAiBar')) el('selectionAiBar').classList.replace('flex', 'hidden');
}

window.cleanupTabRuntimeState = function(tabId) {
  if (TAB_RUNTIME_MAP[tabId]) {
    if (TAB_RUNTIME_MAP[tabId].abortCtrl) {
      try { TAB_RUNTIME_MAP[tabId].abortCtrl.abort(); } catch (e) {}
    }
    delete TAB_RUNTIME_MAP[tabId];
  }
  if (SELECTION_STATE.tabId === tabId) clearSelectionState();
};

function getSavedLocalFacts() {
  var custom = localStorage.getItem('tmv_local_facts_v1');
  if (custom && custom.trim()) return custom.trim();
  return (APP_CONFIG.defaultOrg && APP_CONFIG.defaultOrg.localFacts) ? APP_CONFIG.defaultOrg.localFacts : '';
}

function openTextCacheDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('TroLyThamMuu_TextCache_DB', 2);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('parsed_files')) db.createObjectStore('parsed_files');
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

async function getCachedFileText(cacheKey) {
  try {
    var db = await openTextCacheDB();
    return await new Promise(function(resolve) {
      var tx = db.transaction('parsed_files', 'readonly');
      var req = tx.objectStore('parsed_files').get(cacheKey);
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { resolve(null); };
      tx.oncomplete = function() { db.close(); };
    });
  } catch (e) { return null; }
}

async function setCachedFileText(cacheKey, textVal) {
  try {
    var db = await openTextCacheDB();
    var tx = db.transaction('parsed_files', 'readwrite');
    tx.objectStore('parsed_files').put(textVal, cacheKey);
    tx.oncomplete = function() { db.close(); };
  } catch (e) {}
}

function compactAdminText(raw, maxChars) {
  if (!raw) return '';
  var s = String(raw)
    .replace(/\r\n/g, '\n')
    .replace(/CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\s*Độc lập\s*-\s*Tự do\s*-\s*Hạnh phúc/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  var truncated = false;
  if (maxChars && s.length > maxChars) {
    s = s.substring(0, maxChars) + '\n...[Đã lược bớt phần cuối do văn bản quá dài]...';
    truncated = true;
  }
  return { text: s, truncated: truncated };
}

function stripDigitalSigBoilerplate(txt) {
  return String(txt || '')
    .replace(/(Ký bởi|Người ký|Cơ quan|Thời gian ký|Ngày ký|Email|Signature|Digitally signed by|Chứng thư số)[^\n]*/gi, '')
    .replace(/\s+/g, '');
}

// [AI-02] BÓC CHỮ GIỮ NGUYÊN DÒNG BẢNG PDF, WORD, EXCEL & NÉN ẢNH SCAN SẮC NÉT
async function openPdfSafeEverywhere(uint8Arr) {
  var pdfjs = await ensurePdfJsLoaded();
  var cMap = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/';
  var isLocalFile = window.location.protocol === 'file:';
  try {
    return await pdfjs.getDocument({ data: uint8Arr.slice(0), disableWorker: isLocalFile, cMapUrl: cMap, cMapPacked: true }).promise;
  } catch (e1) {
    return await pdfjs.getDocument({ data: uint8Arr.slice(0), disableWorker: true }).promise;
  }
}

function reconstructStructuredLinesFromPdfItems(items) {
  if (!items || !items.length) return '';
  var lines = [], curLine = [], lastY = null;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var str = it.str || '';
    var y = (it.transform && it.transform.length >= 6) ? it.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 3.8) {
      if (curLine.length) { lines.push(curLine.join(' ').replace(/\s+/g, ' ').trim()); curLine = []; }
    }
    if (str) curLine.push(str);
    if (it.hasEOL) {
      if (curLine.length) { lines.push(curLine.join(' ').replace(/\s+/g, ' ').trim()); curLine = []; }
      lastY = null;
    } else if (y !== null) {
      lastY = y;
    }
  }
  if (curLine.length) lines.push(curLine.join(' ').replace(/\s+/g, ' ').trim());
  return lines.filter(Boolean).join('\n');
}

async function extractFileForAI(fileObj, allowVisionForScan, maxChars) {
  var name = fileObj.name || 'Tai_lieu';
  var ext = name.indexOf('.') !== -1 ? name.split('.').pop().toLowerCase() : '';
  var cacheKey = 'v4|' + name + '|' + fileObj.size + '|' + fileObj.lastModified;

  if (['png', 'jpg', 'jpeg', 'webp'].indexOf(ext) !== -1) {
    if (!allowVisionForScan) return { text: '', inlineParts: [], isScanOnly: true, badge: 'Ảnh' };
    var imgPart = await compressImageFileToInlinePart(fileObj);
    return { text: '[Ảnh chụp văn bản / chỉ đạo đính kèm: ' + name + ']', inlineParts: [imgPart], isVision: true, badge: 'Ảnh Scan' };
  }

  var cached = await getCachedFileText(cacheKey);
  if (cached) {
    var cObj = compactAdminText(cached, maxChars);
    return {
      text: cObj.text,
      inlineParts: [],
      badge: (cObj.truncated ? 'Cắt gọn ' : 'Đã bóc ') + Math.max(1, Math.round(cached.length / 1024)) + 'KB chữ'
    };
  }

  var rawText = '';
  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    rawText = await fileObj.text();
  } else if (ext === 'docx') {
    var mammoth = await ensureMammothLoaded();
    var bufDocx = await fileObj.arrayBuffer();
    rawText = (await mammoth.extractRawText({ arrayBuffer: bufDocx })).value || '';
  } else if (ext === 'doc') {
    return { text: '[Lưu ý: File ' + name + ' là định dạng .doc Word 2003 cũ, vui lòng mở trong Word và Save As sang .docx hoặc .pdf để đọc nội dung]', inlineParts: [], badge: 'Đổi sang .docx' };
  } else if (ext === 'xlsx' || ext === 'xls') {
    var XLSX = await ensureXlsxLoaded();
    var bufXls = await fileObj.arrayBuffer();
    var wb = XLSX.read(bufXls, { type: 'array' });
    rawText = wb.SheetNames.slice(0, 6).map(function(sName) {
      var csv = XLSX.utils.sheet_to_csv(wb.Sheets[sName], { blankrows: false });
      return (csv && csv.trim()) ? ('--- Bảng Excel [' + sName + '] ---\n' + csv) : '';
    }).filter(Boolean).join('\n\n');
  } else if (ext === 'pdf') {
    return await extractPdfSmart(fileObj, cacheKey, allowVisionForScan, maxChars);
  }

  if (rawText && rawText.trim().length > 5) await setCachedFileText(cacheKey, rawText);
  var out = compactAdminText(rawText, maxChars);
  return {
    text: out.text,
    inlineParts: [],
    badge: (out.truncated ? 'Cắt gọn ' : 'Chữ (') + Math.max(1, Math.round((rawText || '').length / 1024)) + (out.truncated ? 'KB' : 'KB)')
  };
}

async function extractPdfSmart(fileObj, cacheKey, allowVision, maxChars) {
  try {
    var buf = await fileObj.arrayBuffer();
    var pdf = await openPdfSafeEverywhere(new Uint8Array(buf));
    var maxPages = Math.min(pdf.numPages, 25), pageTexts = [], nonSigPerPage = [];

    for (var p = 1; p <= maxPages; p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var structured = reconstructStructuredLinesFromPdfItems(tc.items);
      if (structured) pageTexts.push('--- Trang ' + p + ' ---\n' + structured);
      nonSigPerPage.push(stripDigitalSigBoilerplate(structured).length);
    }

    var totalCleanChars = nonSigPerPage.reduce(function(a, b) { return a + b; }, 0);
    var bodyPagesChars = maxPages > 1 ? nonSigPerPage.slice(1).reduce(function(a, b) { return a + b; }, 0) : totalCleanChars;
    // Nhận diện chính xác cả trường hợp PDF Scan dấu đỏ nhưng có đóng khung chữ ký số ở trang 1
    var hasTrueTextLayer = (totalCleanChars >= Math.min(320, maxPages * 115)) && !(maxPages >= 2 && bodyPagesChars < 60);

    if (hasTrueTextLayer) {
      var joined = pageTexts.join('\n\n');
      await setCachedFileText(cacheKey, joined);
      var out = compactAdminText(joined, maxChars);
      return {
        text: out.text,
        inlineParts: [],
        badge: 'Chữ PDF (' + maxPages + 'tr • ' + Math.max(1, Math.round(joined.length / 1024)) + 'KB)'
      };
    }

    if (allowVision) {
      var visionParts = [], scanPages = Math.min(pdf.numPages, 6), totalImgBytes = 0;
      for (var sp = 1; sp <= scanPages; sp++) {
        var sPage = await pdf.getPage(sp);
        var vp1 = sPage.getViewport({ scale: 1.0 });
        var vp = sPage.getViewport({ scale: Math.min(1.55, 1140 / Math.max(vp1.width, 1)) });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await sPage.render({ canvasContext: ctx, viewport: vp }).promise;
        var b64 = canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
        totalImgBytes += Math.round(b64.length * 0.75);
        visionParts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }
      return {
        text: '[Văn bản PDF Scan dấu đỏ (' + scanPages + '/' + pdf.numPages + ' trang): ' + fileObj.name + ']',
        inlineParts: visionParts,
        isVision: true,
        badge: 'Scan ' + scanPages + 'tr (' + Math.max(1, Math.round(totalImgBytes / 1024)) + 'KB)'
      };
    }

    return { text: '', inlineParts: [], isScanOnly: true, badge: 'PDF Scan' };
  } catch (err) {
    return { text: '[Lỗi đọc PDF ' + fileObj.name + ': ' + err.message + ']', inlineParts: [], badge: 'Lỗi PDF' };
  }
}

function compressImageFileToInlinePart(fileObj) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var scale = img.width > 1280 ? (1280 / img.width) : 1;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ inlineData: { mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.74).split(',')[1] } });
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(fileObj);
  });
}

// [AI-03] CHỌN MODEL TỐI ƯU & SYSTEM PROMPT CHUẨN 9 LOẠI VĂN BẢN NGHỊ ĐỊNH 30
function scoreLiveModelId(id) {
  var low = (id || '').toLowerCase(), s = 0;
  if (low.indexOf('gemini-') === 0) s += 200; else if (low.indexOf('gemma-') === 0) s += 80;
  if (low.indexOf('flash') !== -1) s += 110;
  if (low.indexOf('flash') !== -1 && low.indexOf('lite') === -1) s += 25;
  if (low.indexOf('preview') === -1 && low.indexOf('exp') === -1) s += 20;
  if (low.indexOf('gemini-1.') === 0 || low.indexOf('gemini-2.0') === 0) s -= 90;
  var m = low.match(/(?:gemini|gemma)-(\d+)(?:\.(\d+))?/);
  if (m) s += (parseInt(m[1], 10) || 0) * 14 + (parseInt(m[2] || '0', 10) || 0) * 2;
  return s;
}

async function ensureVerifiedLiveModels(key, hasVisionParts) {
  if (!key) return [];
  var blockedWords = ['tts', 'image', 'embedding', 'imagen', 'veo', 'robotics', 'computer-use', 'audio', 'aqa', 'learnlm', 'omni'];
  if (!APP_STATE.api.liveModels || APP_STATE.api.liveModels.length === 0) {
    try {
      var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
      var data = await res.json();
      if (res.ok && data.models) {
        var valid = data.models.filter(function(m) {
          var id = (m.name || '').replace('models/', '');
          var canGen = m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
          return canGen && (id.indexOf('gemini-') === 0 || id.indexOf('gemma-') === 0) && !blockedWords.some(function(w) { return id.indexOf(w) !== -1; });
        }).map(function(m) {
          var id = m.name.replace('models/', '');
          return { id: id, label: id + ' (' + (m.displayName || 'Sẵn sàng') + ')' };
        }).sort(function(a, b) { return scoreLiveModelId(b.id) - scoreLiveModelId(a.id); });
        if (valid.length > 0) {
          APP_STATE.api.liveModels = valid;
          if (!valid.some(function(v) { return v.id === APP_STATE.api.primaryModel; })) APP_STATE.api.primaryModel = valid[0].id;
          localStorage.setItem('tmv_api_v1', JSON.stringify(APP_STATE.api));
          if (typeof renderApiHeaderBadge === 'function') renderApiHeaderBadge(false);
        }
      }
    } catch (e) {}
  }

  var liveList = (APP_STATE.api.liveModels || []).filter(function(m) { return !blockedWords.some(function(w) { return m.id.indexOf(w) !== -1; }); });
  var chain = [];
  function pushUnique(id) { if (id && chain.indexOf(id) === -1) chain.push(id); }
  if (liveList.length > 0) {
    if (liveList.some(function(v) { return v.id === APP_STATE.api.primaryModel; })) pushUnique(APP_STATE.api.primaryModel);
    var liteFlash = liveList.find(function(v) { return v.id.indexOf('gemini-') === 0 && v.id.indexOf('lite') !== -1; });
    var altFlash = liveList.find(function(v) { return v.id.indexOf('gemini-') === 0 && v.id !== APP_STATE.api.primaryModel; });
    if (liteFlash) pushUnique(liteFlash.id); else if (altFlash) pushUnique(altFlash.id);
    if (!hasVisionParts) {
      var gemmaRescue = liveList.find(function(v) { return v.id.indexOf('gemma-') === 0 && v.id.indexOf('it') !== -1; }) || liveList.find(function(v) { return v.id.indexOf('gemma-') === 0; });
      if (gemmaRescue) pushUnique(gemmaRescue.id);
    }
    liveList.slice(0, 3).forEach(function(v) { if (chain.length < 3) pushUnique(v.id); });
  } else {
    pushUnique(APP_STATE.api.primaryModel || 'gemini-2.5-flash');
    pushUnique('gemini-2.5-flash');
    pushUnique('gemini-2.5-flash-lite');
    if (!hasVisionParts) pushUnique('gemma-3-27b-it');
  }
  return chain.slice(0, 3);
}

function buildDocTypeStructureGuidance(docType, roleId) {
  var code = docType.code;
  if (code === 'KH') {
    return '- ĐÂY LÀ KẾ HOẠCH: Không ghi Kính gửi, trích yếu KHÔNG bắt đầu bằng chữ "Về việc". Bố cục chuẩn: Căn cứ/Thực hiện văn bản cấp trên -> <b>I. MỤC ĐÍCH, YÊU CẦU</b> -> <b>II. NỘI DUNG, THỜI GIAN, ĐỊA ĐIỂM</b> -> <b>III. KINH PHÍ THỰC HIỆN</b> -> <b>IV. TỔ CHỨC THỰC HIỆN</b> (phân công rõ đơn vị chủ trì, phối hợp, sản phẩm, thời hạn cho các phòng ban, đoàn thể và 24 Khu phố thuộc Phường Phú Nhuận). Đoạn cuối kết thúc bằng ./.\n';
  }
  if (code === 'QD') {
    return '- ĐÂY LÀ QUYẾT ĐỊNH: Không ghi Kính gửi, trích yếu bắt đầu bằng "Về việc ...". Mở đầu các dòng <i>Căn cứ...;</i> <i>Theo đề nghị của Trưởng Phòng Văn hóa - Xã hội...;</i> tiếp theo xuất <p style="text-align:center;text-indent:0"><b>QUYẾT ĐỊNH:</b></p> rồi đến <b>Điều 1.</b>, <b>Điều 2.</b>, <b>Điều 3.</b> (kết thúc Điều cuối bằng dấu ./.)\n';
  }
  if (code === 'BC') {
    return '- ĐÂY LÀ BÁO CÁO: Trích yếu viết thẳng tên báo cáo (KHÔNG bắt đầu bằng "Về việc"). Nếu đứng vai UBND Phường thì Kính gửi cấp trên (UBND Thành phố / Sở ngành TP / Thường trực Đảng ủy - HĐND Phường, tuyệt đối KHÔNG kính gửi 24 Khu phố). Bố cục rõ: <b>I. KẾT QUẢ THỰC HIỆN</b> (có số liệu minh chứng) -> <b>II. KHÓ KHĂN, HẠN CHẾ</b> -> <b>III. PHƯƠNG HƯỚNG, KIẾN NGHỊ</b>. Kết thúc bằng ./.\n';
  }
  if (code === 'TTr') {
    return '- ĐÂY LÀ TỜ TRÌNH: Trích yếu bắt đầu bằng "Về việc ...". Kính gửi cơ quan cấp trên có thẩm quyền phê duyệt (' + (roleId === 'dept' ? 'Ủy ban nhân dân Phường Phú Nhuận' : 'Thường trực Đảng ủy Phường / HĐND Phường / UBND Thành phố') + '). Nêu rõ căn cứ pháp lý, sự cần thiết, nội dung trình và kiến nghị xem xét quyết định. Kết thúc bằng ./.\n';
  }
  if (code === 'GM') {
    return '- ĐÂY LÀ GIẤY MỜI: Trích yếu ghi nội dung mời họp/tham dự. Mở đầu trân trọng kính mời, nêu rõ: <b>1. Thành phần tham dự</b>; <b>2. Thời gian</b>; <b>3. Địa điểm</b>; <b>4. Nội dung và chuẩn bị</b>; thông tin đầu mối liên hệ khi cần. Kết thúc bằng ./.\n';
  }
  if (code === 'BB') {
    return '- ĐÂY LÀ BIÊN BẢN: Không ghi Kính gửi, trích yếu ghi tên biên bản (VD: Kiểm tra / Làm việc / Họp...). Mở đầu: Hôm nay, vào lúc ... giờ ... phút, ngày ... tại ..., chúng tôi gồm: <b>I. THÀNH PHẦN</b> -> <b>II. NỘI DUNG</b> -> <b>III. KẾT LUẬN / KIẾN NGHỊ</b> -> Biên bản kết thúc vào lúc ... cùng ngày, được thông qua các thành viên cùng nghe và thống nhất ký tên./.\n';
  }
  if (code === 'CTr') {
    return '- ĐÂY LÀ CHƯƠNG TRÌNH: Không ghi Kính gửi, trích yếu viết thẳng tên Chương trình (không ghi "Về việc"). Trình bày mạch lạc theo mục hoặc bảng tiến độ (Thời gian - Nội dung - Đơn vị thực hiện). Kết thúc bằng ./.\n';
  }
  if (code === 'TB') {
    return '- ĐÂY LÀ THÔNG BÁO: Không ghi Kính gửi, trích yếu bắt đầu bằng "Về việc ..." (hoặc Kết luận của...). Trình bày rõ nội dung thông báo, thời gian, trách nhiệm thực hiện của các đơn vị và 24 Khu phố. Kết thúc bằng ./.\n';
  }
  return '- ĐÂY LÀ CÔNG VĂN HÀNH CHÍNH: Trích yếu bắt đầu bằng "V/v ...". Có dòng Kính gửi chuẩn mực (nếu gửi từ 2 cơ quan trở lên thì viết Kính gửi: xuống dòng gạch đầu dòng - từng cơ quan). Văn phong hành chính công vụ rõ ràng, lịch sự, kết thúc bằng ./.\n';
}

function buildAdminSystemPrompt(tab) {
  var p = APP_STATE.profile || {};
  var def = APP_CONFIG.defaultOrg;
  var role = APP_CONFIG.roles.find(function(r) { return r.id === tab.roleId; }) || APP_CONFIG.roles[0];
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
  var isNoDear = docType.dearPolicy === 'none';
  var localFacts = getSavedLocalFacts();

  return 'Bạn là Chuyên viên Cao cấp Tham mưu Văn bản Hành chính tại ' + def.deptName + ' thuộc ' + def.govParent + ', Thành phố Hồ Chí Minh.\n'
    + 'THỰC TẾ ĐỊA BÀN & TỔ CHỨC BỘ MÁY BẮT BUỘC TUÂN THỦ:\n'
    + localFacts + '\n'
    + '- Mảng chuyên môn phụ trách: ' + (p.staffField || 'Văn hóa - Xã hội') + '.\n'
    + '- VAI THAM MƯU: ' + role.shortName + ' -> ' + role.toneDesc + '\n'
    + '- LOẠI VĂN BẢN: ' + docType.name.toUpperCase() + ' (Tuân thủ nghiêm ngặt Phụ lục I Nghị định 30/2020/NĐ-CP).\n'
    + buildDocTypeStructureGuidance(docType, tab.roleId)
    + 'QUY TẮC BẢO MẬT & XUẤT KẾT QUẢ:\n'
    + '1. Chỉ viết phần thân văn bản trong NOI_DUNG_HTML bằng các thẻ chuẩn <p>...</p>, <b>...</b>, <i>...</i>, và <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table> nếu có bảng biểu (TUYỆT ĐỐI KHÔNG lặp lại Quốc hiệu, Số hiệu, Ngày tháng, Tên loại văn bản, Kính gửi, Nơi nhận, Chữ ký trong phần thân, và KHÔNG tự bịa tên cá nhân người ký).\n'
    + '2. Bám sát trung thực số liệu, mốc thời gian, căn cứ từ tài liệu đề bài; chỗ nào tài liệu chưa có số liệu cụ thể thì để dấu [...] cho cán bộ điền, tuyệt đối không bịa số liệu.\n'
    + '3. BẮT BUỘC XUẤT ĐÚNG 5 NHÃN PHÂN CÁCH SAU:\n'
    + '<<<TRICH_YEU>>>\n'
    + (docType.isCongVan ? 'V/v ...\n' : (docType.hasVeViec ? 'Về việc ...\n' : 'Tên chủ đề ' + docType.name + ' (không lặp lại chữ ' + docType.name.toUpperCase() + ' và không ghi Về việc)\n'))
    + '<<<KINH_GUI>>>\n'
    + (isNoDear ? '\n' : 'Kính gửi: ...\n')
    + '<<<NOI_DUNG_HTML>>>\n'
    + '<p>Nội dung...</p>\n'
    + '<<<NOI_NHAN>>>\n'
    + '- Như trên;\n- Lưu: VT, VHXH.\n'
    + '<<<TOM_TAT>>>\n'
    + 'Tóm tắt ngắn gọn 1-2 câu báo cáo điểm chính vừa tham mưu hoặc lưu ý chỗ [...] cần điền thêm.';
}

// [AI-04] GỌI KÊNH MÃ NỘI BỘ (CÓ ĐỒNG HỒ TIẾN TRÌNH SỐNG & ĐẾM LƯỢT THỬ) HOẶC STREAMING KEY CÁ NHÂN
async function callSharedProxyGateway(pin, userParts, sysPrompt, tabRuntime, onStatusTick) {
  var proxyUrl = (APP_CONFIG.proxyWebAppUrl || '').trim();
  if (!proxyUrl) {
    throw new Error('Chưa cấu hình proxyWebAppUrl trong config.js! Bạn có thể dán Gemini API Key cá nhân vào Cách 2 để dùng ngay.');
  }

  // Kiểm tra hạn mức trải nghiệm Mã nội bộ trên PC để khuyến khích đồng nghiệp tự đăng ký Key riêng
  if (window.getPinTrialStatus) {
    var trialBefore = window.getPinTrialStatus();
    if (trialBefore.totalLeft <= 0) {
      if (window.updatePinTrialModalUI) window.updatePinTrialModalUI();
      openModalSafe('modalApi');
      setTimeout(function() {
        var inp = el('inpApiKey');
        if (inp) { try { inp.focus(); } catch (e) {} }
      }, 80);
      throw new Error('Máy PC này đã dùng hết ' + trialBefore.limit + ' lượt trải nghiệm Mã nội bộ! Bạn hãy bấm nút xanh [Mở trang lấy Key Google] tạo Key riêng miễn phí trong 30 giây để dùng lâu dài không giới hạn (hoặc bấm [+2 lượt chữa cháy hôm nay] trong hộp Kết nối nếu đang gấp deadline).');
    }
  }

  var ctrl = new AbortController();
  tabRuntime.abortCtrl = ctrl;
  var timeoutId = setTimeout(function() { ctrl.abort(); }, 160000);

  var startTs = Date.now();
  var stages = [
    'Đang kết nối Trạm Gác Phòng...',
    'Đang đọc phân tích hồ sơ đề bài...',
    'Đang dựng bố cục chuẩn Nghị định 30...',
    'Đang rà soát đơn vị & 24 Khu phố...',
    'Đang hoàn thiện câu chữ hành chính...'
  ];
  var tickTimer = setInterval(function() {
    var sec = Math.floor((Date.now() - startTs) / 1000);
    var stageIdx = Math.min(stages.length - 1, Math.floor(sec / 6));
    if (onStatusTick) onStatusTick(stages[stageIdx] + ' (' + sec + 's)');
  }, 1000);

  try {
    if (onStatusTick) onStatusTick('Đang gửi yêu cầu qua Mã nội bộ (0s)...');
    var res = await fetch(proxyUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ pin: pin, sysPrompt: sysPrompt, userParts: userParts }),
      signal: ctrl.signal
    });
    var data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) ? data.message : 'Trạm Gác từ chối kết nối!');
    }
    var trialAfter = window.consumePinTrialTurn ? window.consumePinTrialTurn() : null;
    var leftTag = trialAfter ? (' • Còn ' + trialAfter.totalLeft + ' lượt thử') : '';
    return { text: data.text, usedModel: (data.usedModel || 'Model Free') + ' (Mã Phòng' + leftTag + ')' };
  } finally {
    clearInterval(tickTimer);
    clearTimeout(timeoutId);
    tabRuntime.abortCtrl = null;
  }
}

async function callSingleModelStreamOrPost(modelId, key, payload, tabRuntime, onProgress, onStatusTick) {
  var ctrl = new AbortController();
  tabRuntime.abortCtrl = ctrl;
  var timer = null;
  function armTimeout(ms) { if (timer) clearTimeout(timer); timer = setTimeout(function() { ctrl.abort(); }, ms); }

  try {
    armTimeout(150000);
    var streamUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
    var res = await fetch(streamUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    if (!res.ok) {
      var errObj = {}; try { errObj = await res.json(); } catch (e) {}
      throw new Error('HTTP_' + res.status + ': ' + ((errObj.error && errObj.error.message) ? errObj.error.message : ('HTTP ' + res.status)));
    }
    if (res.body && res.body.getReader) {
      var reader = res.body.getReader(), decoder = new TextDecoder('utf-8'), buffer = '', fullText = '', thoughtChars = 0;
      while (true) {
        armTimeout(90000);
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (line.indexOf('data:') !== 0) continue;
          var rawJson = line.substring(5).trim();
          if (!rawJson || rawJson === '[DONE]') continue;
          try {
            var evt = JSON.parse(rawJson);
            var partsArr = evt.candidates && evt.candidates[0] && evt.candidates[0].content && evt.candidates[0].content.parts;
            if (partsArr) {
              partsArr.forEach(function(pt) {
                if (pt.thought && pt.text) thoughtChars += pt.text.length; else if (pt.text) fullText += pt.text;
              });
              if (fullText.length > 0 && onProgress) onProgress(fullText, modelId);
              else if (thoughtChars > 0 && onStatusTick) onStatusTick('AI đang lập dàn ý (' + thoughtChars + ' ký tự)...');
            }
          } catch (pe) {}
        }
      }
      if (fullText.trim().length > 0) return fullText;
    }

    armTimeout(150000);
    var postUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent?key=' + encodeURIComponent(key);
    var res2 = await fetch(postUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    var data2 = await res2.json();
    if (!res2.ok) throw new Error('HTTP_' + res2.status + ': ' + ((data2.error && data2.error.message) || 'Lỗi máy chủ'));
    var parts2 = data2.candidates && data2.candidates[0] && data2.candidates[0].content && data2.candidates[0].content.parts;
    if (parts2) {
      var joined2 = parts2.filter(function(p) { return !p.thought && p.text; }).map(function(p) { return p.text; }).join('');
      if (joined2.trim()) return joined2;
    }
    throw new Error('Model trả về rỗng');
  } finally {
    if (timer) clearTimeout(timer);
    tabRuntime.abortCtrl = null;
  }
}

async function callGeminiStreamWithFallback(userParts, sysPrompt, tabRuntime, onProgress, onStatusTick) {
  var isVerified = APP_STATE.api && APP_STATE.api.verified === true;
  var key = (isVerified && APP_STATE.api.key) ? APP_STATE.api.key.trim() : '';
  var pin = (APP_STATE.api && APP_STATE.api.internalPin) ? APP_STATE.api.internalPin.trim() : '';

  if (!key && pin) {
    return await callSharedProxyGateway(pin, userParts, sysPrompt, tabRuntime, onStatusTick);
  }
  if (!key && !pin) {
    openModalSafe('modalApi');
    throw new Error('Vui lòng nhập Mã nội bộ hoặc Gemini API Key cá nhân ở nút góc trên bên phải trước khi sử dụng!');
  }

  var hasVision = userParts.some(function(pt) { return Boolean(pt.inlineData); });
  var chain = await ensureVerifiedLiveModels(key, hasVision);
  tabRuntime.userCancelled = false;
  var errorLog = [];

  for (var i = 0; i < chain.length; i++) {
    if (tabRuntime.userCancelled) throw new Error('USER_CANCELLED');
    var modelId = chain[i];
    var isGemma = modelId.indexOf('gemma') === 0;
    var payload = isGemma
      ? { contents: [{ role: 'user', parts: [{ text: sysPrompt + '\n\n---\n' }].concat(userParts) }], generationConfig: { temperature: 0.22 } }
      : { systemInstruction: { parts: [{ text: sysPrompt }] }, contents: [{ role: 'user', parts: userParts }], generationConfig: { temperature: 0.22 } };
    try {
      if (onStatusTick) onStatusTick('Đang gọi [' + modelId + ']...');
      var outText = await callSingleModelStreamOrPost(modelId, key, payload, tabRuntime, onProgress, onStatusTick);
      return { text: outText, usedModel: modelId };
    } catch (err) {
      if (tabRuntime.userCancelled || (err && err.message === 'USER_CANCELLED')) throw new Error('USER_CANCELLED');
      var reason = (err && err.name === 'AbortError') ? 'Quá thời gian chờ' : (err.message || String(err));
      errorLog.push('[' + modelId + '] ' + reason);
      if (reason.indexOf('API key not valid') !== -1 || reason.indexOf('API_KEY_INVALID') !== -1) break;
    }
  }
  throw new Error(errorLog.join(' | '));
}

// [AI-05] ĐỔ DỮ LIỆU ĐÚNG TAB ĐÍCH, GIỮ NGUYÊN TRÍ NHỚ ĐỀ BÀI & SỬA BÔI ĐEN AN TOÀN
function parseStreamedSections(rawText) {
  var txt = String(rawText || '');
  if (txt.indexOf('<<<') === -1 && txt.trim().charAt(0) === '{') {
    try {
      var j = JSON.parse(txt.replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
      return { docSubject: j.docSubject || '', dearLine: j.dearLine || '', bodyHtml: j.bodyHtml || '', recipients: j.recipients || '', summaryReply: j.summaryReply || '' };
    } catch (e) {}
  }
  function grab(tagStart, nextTags) {
    var p1 = txt.indexOf(tagStart);
    if (p1 === -1) return null;
    var contentStart = p1 + tagStart.length, endPos = txt.length;
    for (var i = 0; i < nextTags.length; i++) {
      var p2 = txt.indexOf(nextTags[i], contentStart);
      if (p2 !== -1 && p2 < endPos) endPos = p2;
    }
    return txt.substring(contentStart, endPos).trim();
  }
  var sub = grab('<<<TRICH_YEU>>>', ['<<<KINH_GUI>>>', '<<<NOI_DUNG_HTML>>>', '<<<NOI_NHAN>>>', '<<<TOM_TAT>>>']);
  var dear = grab('<<<KINH_GUI>>>', ['<<<NOI_DUNG_HTML>>>', '<<<NOI_NHAN>>>', '<<<TOM_TAT>>>']);
  var body = grab('<<<NOI_DUNG_HTML>>>', ['<<<NOI_NHAN>>>', '<<<TOM_TAT>>>']);
  var rec = grab('<<<NOI_NHAN>>>', ['<<<TOM_TAT>>>']);
  var sum = grab('<<<TOM_TAT>>>', []);
  if (body === null && sub === null && txt.indexOf('<p') !== -1) body = txt;
  return { docSubject: sub, dearLine: dear, bodyHtml: body, recipients: rec, summaryReply: sum };
}

function syncAiButtonUIForActiveTab() {
  var cur = getActiveTab();
  var btnRun = el('btnRunAi'), btnCancel = el('btnCancelAi');
  if (!btnRun || !btnCancel) return;
  if (cur && cur._isBusy) {
    btnRun.disabled = true;
    btnRun.className = 'bg-slate-600 text-white font-bold text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-not-allowed max-w-[225px]';
    btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin shrink-0"></i> <span class="truncate"></span>';
    btnRun.querySelector('span').textContent = cur._busyLabel || 'Đang xử lý...';
    btnCancel.classList.remove('hidden');
  } else {
    btnRun.disabled = false;
    btnRun.className = 'bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-1.5 px-3 rounded-lg shadow flex items-center gap-1.5 transition cursor-pointer';
    btnRun.innerHTML = '<i class="fa-solid fa-bolt"></i> Tham mưu A4';
    btnCancel.classList.add('hidden');
  }
}

function setTabBusyStatus(tabObj, busy, statusText) {
  if (!tabObj) return;
  tabObj._isBusy = busy;
  tabObj._busyLabel = statusText || '';
  renderWorkspaceTabsBar();
  if (APP_STATE.activeTabId === tabObj.id) syncAiButtonUIForActiveTab();
}

function appendChatMessageToTab(tabObj, sender, text, modelTag) {
  if (!tabObj) return;
  tabObj.chatHistory = tabObj.chatHistory || [];
  tabObj.chatHistory.push({ sender: sender, text: text, modelTag: modelTag || '', ts: Date.now() });
  if (tabObj.chatHistory.length > 24) tabObj.chatHistory = tabObj.chatHistory.slice(-24);
  if (APP_STATE.activeTabId === tabObj.id) renderChatHistoryForActiveTab();
  persistWorkspacesNow();
}

function renderChatHistoryForActiveTab() {
  var box = el('aiChatLog'), tab = getActiveTab();
  if (!box || !tab) return;
  var hist = tab.chatHistory || [];
  box.innerHTML = '';
  if (hist.length === 0) {
    var emptyHint = document.createElement('div');
    emptyHint.className = 'text-[11px] text-slate-400 leading-relaxed p-2 text-center';
    emptyHint.innerHTML = '<i class="fa-solid fa-cloud-arrow-up text-purple-400 text-base mb-1 block"></i>'
      + 'Kéo thả file Word / PDF / Excel từ <b>Zalo PC</b> vào đây, dán ảnh chụp màn hình <b>(Ctrl+V)</b> hoặc gõ yêu cầu để AI soạn lên giấy A4.';
    box.appendChild(emptyHint);
    return;
  }
  hist.forEach(function(m) {
    var div = document.createElement('div');
    div.className = 'p-2 text-xs leading-relaxed ' + (m.sender === 'user' ? 'chat-msg-user ml-4' : 'chat-msg-ai mr-3');
    if (m.modelTag) {
      var tagEl = document.createElement('div');
      tagEl.className = 'text-[10px] text-purple-600 font-semibold mb-0.5 flex items-center gap-1';
      tagEl.innerHTML = '<i class="fa-solid fa-microchip"></i><span></span>';
      tagEl.querySelector('span').textContent = m.modelTag;
      div.appendChild(tagEl);
    }
    var bodyEl = document.createElement('div');
    bodyEl.className = 'whitespace-pre-wrap break-words';
    bodyEl.textContent = m.text;
    div.appendChild(bodyEl);
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function prepareTabTaskFiles(tabId) {
  var rt = getTabRuntime(tabId);
  for (var i = 0; i < rt.taskFiles.length; i++) {
    var tf = rt.taskFiles[i];
    if (tf.loaded || tf.loading) continue;
    tf.loading = true; tf.badge = 'Đang đọc...';
    if (APP_STATE.activeTabId === tabId) renderTaskFilesList();
    try {
      var parsed = await extractFileForAI(tf.file, true, 28000);
      tf.extractedText = parsed.text;
      tf.inlineParts = parsed.inlineParts || [];
      tf.isVision = Boolean(parsed.isVision);
      tf.badge = parsed.badge || 'Sẵn sàng';
      tf.loaded = true;
    } catch (e) { tf.badge = 'Lỗi file'; }
    tf.loading = false;
    if (APP_STATE.activeTabId === tabId) renderTaskFilesList();
  }
}

function renderTaskFilesList() {
  var box = el('taskFilesList');
  if (!box) return;
  var activeId = APP_STATE.activeTabId;
  var rt = getTabRuntime(activeId);
  box.innerHTML = '';
  rt.taskFiles.forEach(function(tf, idx) {
    var cls = tf.isVision ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300';
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-1.5 bg-purple-50/80 border border-purple-200 rounded px-2 py-1 text-[11px]';

    var left = document.createElement('div');
    left.className = 'truncate flex-1 font-medium text-slate-700';
    left.innerHTML = '<i class="fa-solid fa-file-lines text-purple-600 mr-1"></i><span></span>';
    left.querySelector('span').textContent = tf.name;
    left.title = tf.name;

    var badge = document.createElement('span');
    badge.className = 'shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold ' + cls;
    badge.textContent = tf.badge || 'Đề bài';

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'shrink-0 text-slate-400 hover:text-rose-600 px-1 cursor-pointer';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.addEventListener('click', function() {
      rt.taskFiles.splice(idx, 1);
      renderTaskFilesList();
    });

    row.appendChild(left);
    row.appendChild(badge);
    row.appendChild(delBtn);
    box.appendChild(row);
  });
}

function addFilesToActiveTabTasks(fileList) {
  var files = Array.from(fileList || []);
  if (!files.length) return;
  var activeId = APP_STATE.activeTabId;
  var rt = getTabRuntime(activeId);
  files.forEach(function(f) {
    rt.taskFiles.push({
      name: f.name,
      file: f,
      loaded: false,
      loading: false,
      extractedText: '',
      inlineParts: [],
      isVision: false,
      badge: 'Đang đọc...',
      visionSentOnce: false
    });
  });
  renderTaskFilesList();
  if (el('chkDeltaMode')) el('chkDeltaMode').checked = false;
  prepareTabTaskFiles(activeId);
}
window.addFilesToActiveTabTasks = addFilesToActiveTabTasks;

function applyParsedSectionsToTargetTab(targetTab, docTypeObj, sec, isFinal) {
  if (!targetTab) return;
  if (sec.docSubject) {
    if (docTypeObj.isCongVan) {
      targetTab.cvSubject = sec.docSubject.indexOf('V/v') === 0 ? sec.docSubject : ('V/v ' + sec.docSubject.replace(/^Về việc\s*/i, ''));
    } else {
      var cleanedSub = sec.docSubject.replace(/^(KẾ HOẠCH|TỜ TRÌNH|BÁO CÁO|THÔNG BÁO|QUYẾT ĐỊNH|GIẤY MỜI|BIÊN BẢN|CHƯƠNG TRÌNH)\s*/i, '').trim();
      if (!docTypeObj.hasVeViec) cleanedSub = cleanedSub.replace(/^Về việc\s*/i, '').trim();
      targetTab.namedSub = cleanedSub;
    }
  }
  if (sec.dearLine !== null) {
    targetTab.dearLine = (docTypeObj.dearPolicy === 'none' && !sec.dearLine.trim()) ? '' : sec.dearLine.trim();
  }
  if (sec.bodyHtml) {
    targetTab.bodyHtml = window.sanitizeAdminHtml(sec.bodyHtml);
  }
  if (isFinal && sec.recipients) {
    targetTab.recipients = sec.recipients.trim();
  }
  targetTab.title = deriveShortTabTitle(targetTab);
  targetTab.updatedAt = Date.now();

  // Chỉ cập nhật DOM giấy A4 nếu người dùng vẫn đang đứng ở đúng Tab này!
  if (APP_STATE.activeTabId === targetTab.id) {
    clearSelectionState();
    if (sec.docSubject) {
      if (docTypeObj.isCongVan && el('a4CvSubject')) el('a4CvSubject').textContent = targetTab.cvSubject;
      else if (el('a4NamedSub')) el('a4NamedSub').textContent = targetTab.namedSub;
    }
    if (sec.dearLine !== null && el('a4DearLine')) {
      el('a4DearLine').textContent = targetTab.dearLine;
      var hideDear = (docTypeObj.dearPolicy === 'none' && !targetTab.dearLine);
      el('a4DearLine').classList.toggle('hidden', hideDear);
      if (window.updateDearLinePresentation) window.updateDearLinePresentation();
    }
    if (sec.bodyHtml && el('a4BodyContent')) {
      el('a4BodyContent').innerHTML = targetTab.bodyHtml;
    }
    if (isFinal && sec.recipients && el('a4Recipients')) {
      el('a4Recipients').textContent = targetTab.recipients;
    }
    if (window.updatePaperZoomAndPageCount) window.updatePaperZoomAndPageCount();
  }
}

async function executeMainAiDrafting() {
  var targetTab = captureDOMIntoActiveTab(true);
  if (!targetTab || targetTab._isBusy) return;
  var targetTabId = targetTab.id;
  var rt = getTabRuntime(targetTabId);

  var promptTxt = el('aiPromptInput').value.trim();
  if (!promptTxt && rt.taskFiles.length === 0) {
    return window.showToast('Hãy nhập yêu cầu tham mưu hoặc kéo thả file đề bài vào cột trái!', 'warn');
  }
  if (!promptTxt) promptTxt = APP_CONFIG.defaultPrompt;

  var useDelta = el('chkDeltaMode').checked && Boolean(targetTab.bodyHtml && targetTab.bodyHtml.trim().length > 20);

  appendChatMessageToTab(targetTab, 'user', promptTxt);
  el('aiPromptInput').value = '';
  el('aiPromptInput').style.height = '';
  setTabBusyStatus(targetTab, true, 'Đang đọc hồ sơ...');

  try {
    await prepareTabTaskFiles(targetTabId);
    var parts = [], contextBlocks = [], skippedScanCabinetNames = [];
    var hasPersonalKey = Boolean(APP_STATE.api && APP_STATE.api.verified && APP_STATE.api.key);

    // Giữ lại văn bản chữ của đề bài kể cả ở chế độ Sửa tiếp nháp (chống quên số liệu nguồn!), chỉ lược bớt gửi lặp lại ảnh nặng
    rt.taskFiles.forEach(function(tf) {
      if (tf.extractedText) {
        var textSlice = useDelta ? tf.extractedText.substring(0, 14000) : tf.extractedText;
        contextBlocks.push('=== TÀI LIỆU ĐỀ BÀI: ' + tf.name + ' ===\n' + textSlice);
      }
      if (tf.inlineParts && tf.inlineParts.length) {
        if (!useDelta || !tf.visionSentOnce) {
          parts = parts.concat(tf.inlineParts);
          tf.visionSentOnce = true;
        }
      }
    });

    // Đọc Tủ hồ sơ PC (cảnh báo minh bạch nếu gặp PDF Scan dấu đỏ)
    var checkedCab = (APP_STATE.cabinetFiles || []).filter(function(f) { return f.checked; });
    var pinnedVisionUsed = 0;
    for (var c = 0; c < checkedCab.length; c++) {
      var cf = checkedCab[c];
      if (useDelta && !cf.isPinned) continue;
      setTabBusyStatus(targetTab, true, 'Đọc tủ PC (' + (c + 1) + '/' + checkedCab.length + ')...');
      var allowPinnedScanVision = Boolean(cf.isPinned && hasPersonalKey && !useDelta && pinnedVisionUsed < 1);
      var parsedC = await extractFileForAI(cf.fileObj, allowPinnedScanVision, cf.isPinned ? 9000 : 5000);
      if (parsedC.isVision && parsedC.inlineParts && parsedC.inlineParts.length) {
        pinnedVisionUsed++;
        parts = parts.concat(parsedC.inlineParts);
        contextBlocks.push('=== [GHIM CỐ ĐỊNH - ẢNH SCAN] ' + cf.name + ' ===\n' + parsedC.text);
      } else if (parsedC.isScanOnly) {
        cf.isScanNotice = true;
        skippedScanCabinetNames.push(cf.name);
      } else if (parsedC.text) {
        contextBlocks.push('=== ' + (cf.isPinned ? '[GHIM CỐ ĐỊNH] ' : '[HỒ SƠ GẦN ĐÂY] ') + cf.name + ' ===\n' + parsedC.text);
      }
    }
    if (skippedScanCabinetNames.length > 0 && window.renderCabinetList) window.renderCabinetList();

    // Kèm lịch sử trao đổi gần nhất để AI hiểu mạch chỉnh sửa liên tục
    var prevChats = (targetTab.chatHistory || []).slice(-5, -1);
    if (prevChats.length > 0) {
      var chatCtx = prevChats.map(function(m) { return (m.sender === 'user' ? 'Cán bộ: ' : 'Trợ lý: ') + m.text; }).join('\n');
      contextBlocks.push('=== LỊCH SỬ TRAO ĐỔI TRƯỚC ĐÓ ===\n' + chatCtx);
    }

    if (useDelta) {
      contextBlocks.push('=== BẢN NHÁP HIỆN TẠI TRÊN GIẤY A4 (HÃY SỬA ĐỔI / BỔ SUNG TRỰC TIẾP TRÊN BẢN NÀY) ===\n'
        + 'Trích yếu: ' + (targetTab.cvSubject || targetTab.namedSub) + '\n'
        + 'Kính gửi: ' + (targetTab.dearLine || '') + '\n'
        + 'Nội dung HTML:\n' + (targetTab.bodyHtml || '') + '\n'
        + 'Nơi nhận:\n' + (targetTab.recipients || ''));
    }

    parts.push({ text: (contextBlocks.length ? contextBlocks.join('\n\n') + '\n\n' : '') + '=== YÊU CẦU HIỆN TẠI CỦA CÁN BỘ ===\n' + promptTxt });
    pushTabSnapshot('Trước khi AI cập nhật', false, targetTab);

    var docTypeObj = APP_CONFIG.docTypes.find(function(d) { return d.code === targetTab.docType; }) || APP_CONFIG.docTypes[0];
    var lastRenderTs = 0;

    var result = await callGeminiStreamWithFallback(
      parts,
      buildAdminSystemPrompt(targetTab),
      rt,
      function(liveText) {
        var now = Date.now();
        if (now - lastRenderTs < 280) return;
        lastRenderTs = now;
        setTabBusyStatus(targetTab, true, 'Đang viết (' + liveText.length + ' ký tự)...');
        applyParsedSectionsToTargetTab(targetTab, docTypeObj, parseStreamedSections(liveText), false);
      },
      function(statusMsg) {
        setTabBusyStatus(targetTab, true, statusMsg);
      }
    );

    var finalSec = parseStreamedSections(result.text);
    applyParsedSectionsToTargetTab(targetTab, docTypeObj, finalSec, true);
    renderWorkspaceTabsBar();
    await persistWorkspacesNow();
    if (APP_STATE.dirHandle && APP_STATE.dirWritable) scheduleAutoDiskWrite(targetTab);

    if (APP_STATE.activeTabId === targetTabId && el('chkDeltaMode')) el('chkDeltaMode').checked = true;

    var replyMsg = finalSec.summaryReply || 'Đã soạn thảo hoàn chỉnh lên trang giấy A4!';
    if (skippedScanCabinetNames.length > 0) {
      replyMsg += '\n\n(Lưu ý: Phát hiện ' + skippedScanCabinetNames.length + ' file PDF Scan ảnh trong Tủ hồ sơ [' + skippedScanCabinetNames.slice(0, 2).join(', ') + ']. Nếu cần AI đọc ảnh dấu đỏ của file đó, hãy bấm nút màu vàng [Đọc Scan] cạnh tên file trong Tủ hồ sơ nhé!)';
    }
    appendChatMessageToTab(targetTab, 'ai', replyMsg, result.usedModel);
    if (APP_STATE.activeTabId !== targetTabId) {
      window.showToast('Đã soạn xong thẻ: ' + targetTab.title, 'ok');
    }
  } catch (err) {
    if (err && err.message === 'USER_CANCELLED') appendChatMessageToTab(targetTab, 'ai', 'Đã dừng viết theo yêu cầu của bạn.');
    else appendChatMessageToTab(targetTab, 'ai', 'Lưu ý: ' + (err.message || String(err)));
  } finally {
    setTabBusyStatus(targetTab, false, '');
  }
}

// Lọc Tủ hồ sơ PC có khử dấu Tiếng Việt & bỏ từ khóa nhiễu (Stopwords)
function normalizeVnSearch(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9\s]/g, ' ');
}

async function autoFilterCabinetByTopic() {
  var list = APP_STATE.cabinetFiles || [];
  if (!list.length) return window.showToast('Chưa có file nào trong Tủ hồ sơ PC để lọc!', 'warn');
  var activeId = APP_STATE.activeTabId;
  await prepareTabTaskFiles(activeId);
  var rt = getTabRuntime(activeId);

  var rawQuery = (el('aiPromptInput').value || '') + ' ' + rt.taskFiles.map(function(t) {
    return t.name + ' ' + (t.extractedText || '').substring(0, 1500);
  }).join(' ');

  var stopWords = ['hay', 'tham', 'muu', 'soan', 'thao', 'day', 'van', 'ban', 'tai', 'lieu', 'dinh', 'kem', 'dung', 'the', 'thuc', 'nghi', 'phuong', 'phu', 'nhuan', 'ubnd', 'phong', 'cua', 'cac', 'trong', 'theo', 'voi'];
  var words = normalizeVnSearch(rawQuery).split(/\s+/).filter(function(w) { return w.length >= 3 && stopWords.indexOf(w) === -1; });
  if (!words.length) return window.showToast('Hãy đính kèm file Đề bài hoặc nhập chủ đề vào ô yêu cầu trước khi lọc tủ!', 'warn');

  var uniqueWords = Array.from(new Set(words)).slice(0, 35);
  var scored = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].isPinned) { list[i].checked = true; continue; }
    var hay = normalizeVnSearch(list[i].name);
    var c = await getCachedFileText('v4|' + list[i].name + '|' + list[i].size + '|' + list[i].lastModified);
    if (c) hay += ' ' + normalizeVnSearch(c.substring(0, 2500));
    var sc = 0;
    uniqueWords.forEach(function(w) { if (hay.indexOf(w) !== -1) sc++; });
    scored.push({ idx: i, sc: sc });
  }
  scored.sort(function(a, b) { return b.sc - a.sc; });
  var matchedCount = 0;
  scored.forEach(function(s, rank) {
    var keep = rank < 4 && s.sc > 0;
    list[s.idx].checked = keep;
    if (keep) matchedCount++;
  });
  renderCabinetList();
  if (matchedCount > 0) {
    window.showToast('Đã lọc giữ ' + matchedCount + ' hồ sơ liên quan sát chủ đề nhất (cùng các file Ghim)!', 'ok');
  } else {
    window.showToast('Không tìm thấy file gần đây trùng từ khóa; chỉ giữ lại các file [GHIM].', 'warn');
  }
}

// Sửa đoạn bôi đen an toàn: giữ nguyên thẻ <p>, <b>, xử lý thông minh khi bôi đen bảng <table> không để sót khung kẻ ô rỗng
function findAncestorTagInBody(node, bodyEl, tagNames) {
  if (!node || !bodyEl) return null;
  var cur = node.nodeType === 1 ? node : node.parentNode;
  while (cur && cur !== bodyEl) {
    if (tagNames.indexOf(cur.tagName) !== -1) return cur;
    cur = cur.parentNode;
  }
  return null;
}

async function executeSelectionRewrite() {
  var bodyEl = el('a4BodyContent');
  if (SELECTION_STATE.isRunning || !SELECTION_STATE.savedRange || !SELECTION_STATE.savedSelectedText || !bodyEl) return;
  if (SELECTION_STATE.tabId !== APP_STATE.activeTabId || !bodyEl.contains(SELECTION_STATE.savedRange.commonAncestorContainer)) {
    clearSelectionState();
    return window.showToast('Vùng bôi đen đã thay đổi, vui lòng quét chọn lại đoạn cần sửa!', 'warn');
  }

  var reqTxt = el('selectionCustomPrompt').value.trim() || 'Viết lại chuẩn văn phong hành chính Nghị định 30, rõ ý, trang trọng và chặt chẽ hơn';
  var tab = captureDOMIntoActiveTab(true);
  if (!tab || tab._isBusy) return;
  var rt = getTabRuntime(tab.id);
  var role = APP_CONFIG.roles.find(function(r) { return r.id === tab.roleId; }) || APP_CONFIG.roles[0];

  var range = SELECTION_STATE.savedRange;
  var startTbl = findAncestorTagInBody(range.startContainer, bodyEl, ['TABLE']);
  var endTbl = findAncestorTagInBody(range.endContainer, bodyEl, ['TABLE']);
  var startCell = findAncestorTagInBody(range.startContainer, bodyEl, ['TD', 'TH']);
  var endCell = findAncestorTagInBody(range.endContainer, bodyEl, ['TD', 'TH']);
  var isSingleCellEdit = Boolean(startCell && startCell === endCell);

  var touchedTables = Array.from(bodyEl.querySelectorAll('table')).filter(function(tbl) {
    if (tbl === startTbl || tbl === endTbl) return true;
    try { return range.intersectsNode(tbl); } catch (e) { return false; }
  });
  var isMultiCellTableSelection = touchedTables.length > 0 && !isSingleCellEdit;
  var isMultiParagraph = isMultiCellTableSelection || SELECTION_STATE.savedSelectedText.indexOf('\n') !== -1;

  var btn = el('btnRunSelectionAi');
  SELECTION_STATE.isRunning = true;
  btn.disabled = true; btn.textContent = 'Đang sửa...';

  try {
    var sys = 'Bạn là Chuyên gia biên tập văn bản hành chính tại Phòng Văn hóa - Xã hội, UBND Phường Phú Nhuận (24 Khu phố), TP.HCM (' + role.shortName + '). '
      + (isMultiCellTableSelection
        ? 'Hãy trả về nội dung đã biên tập lại bằng các thẻ <p>...</p> (có thể dùng <b>...</b>, <i>...</i>) hoặc thẻ <table> chuẩn nếu người dùng yêu cầu giữ/lập bảng; tuyệt đối không giải thích thêm.'
        : (isMultiParagraph
          ? 'Hãy trả về các đoạn văn đã biên tập lại bằng thẻ <p>...</p> (có thể dùng <b>...</b> cho tiêu đề mục), không giải thích thêm.'
          : 'Hãy trả về đúng câu/cụm từ đã biên tập lại (có thể dùng <b>...</b> nếu cần nhấn mạnh), không bọc ngoặc kép, không giải thích thêm.'));

    var res = await callGeminiStreamWithFallback(
      [{ text: 'ĐOẠN GỐC CẦN SỬA:\n' + SELECTION_STATE.savedSelectedText + '\n\nYÊU CẦU BIÊN TẬP:\n' + reqTxt }],
      sys,
      rt,
      null,
      null
    );

    pushTabSnapshot('Trước khi sửa đoạn bôi đen', false, tab);
    var cleanedOut = res.text.trim().replace(/^```html\s*/i, '').replace(/\s*```$/i, '').replace(/^["“]|["”]$/g, '').trim();
    var safeHtml = window.sanitizeAdminHtml(cleanedOut);

    var tpl = document.createElement('template');
    if (isMultiParagraph && safeHtml.indexOf('<p') === -1 && safeHtml.toLowerCase().indexOf('<table') === -1) {
      tpl.innerHTML = cleanedOut.split(/\r?\n/).filter(function(l) { return l.trim(); }).map(function(l) {
        return '<p>' + window.escapeHtml(l.trim()) + '</p>';
      }).join('');
    } else if (!isMultiParagraph) {
      // Nếu sửa 1 cụm câu nằm gọn trong 1 đoạn <p> hoặc 1 ô <td>, gỡ thẻ <p> bọc ngoài để không làm gãy đôi dòng hiện tại
      tpl.innerHTML = safeHtml.replace(/^<p[^>]*>/i, '').replace(/<\/p>$/i, '');
    } else {
      tpl.innerHTML = safeHtml;
    }

    var sharedTbl = (!isSingleCellEdit && startTbl && startTbl === endTbl) ? startTbl : null;
    var selCompactLen = SELECTION_STATE.savedSelectedText.replace(/\s+/g, '').length;
    var sharedTblCompactLen = sharedTbl ? (sharedTbl.textContent || '').replace(/\s+/g, '').length : 0;

    if (sharedTbl && sharedTblCompactLen > 0 && (selCompactLen >= sharedTblCompactLen * 0.65 || safeHtml.toLowerCase().indexOf('<table') !== -1)) {
      // Bôi đen trọn bảng (hoặc >=65% bảng) để đổi sang đoạn văn / bảng mới -> Thay thế nguyên khối <table>, không bao giờ sót vỏ ô kẻ!
      sharedTbl.replaceWith(tpl.content);
    } else {
      range.deleteContents();
      var collapsedTbl = (!isSingleCellEdit) ? findAncestorTagInBody(range.startContainer, bodyEl, ['TABLE']) : null;
      if (collapsedTbl && !(collapsedTbl.textContent || '').replace(/\u00A0/g, '').trim()) {
        // Bôi đen từ ô đầu bảng kéo lố ra ngoài bảng khiến xác <table> trở nên rỗng -> thay thế thẳng xác <table>
        collapsedTbl.replaceWith(tpl.content);
      } else {
        range.insertNode(tpl.content);
      }
      // Dọn sạch mọi dòng <tr> rỗng hoặc vỏ <table> rỗng sinh ra do xóa vùng chọn cắt ngang bảng
      if (!isSingleCellEdit && touchedTables.length > 0) {
        touchedTables.forEach(function(tbl) {
          if (!bodyEl.contains(tbl)) return;
          Array.from(tbl.querySelectorAll('tr')).forEach(function(tr) {
            if (!(tr.textContent || '').replace(/\u00A0/g, '').trim()) tr.remove();
          });
        });
      }
    }

    if (window.purgeEmptyTablesInLiveBody) window.purgeEmptyTablesInLiveBody();
    clearSelectionState();
    scheduleAutoSave();
    appendChatMessageToTab(tab, 'ai', 'Đã biên tập lại đoạn bôi đen trên trang giấy A4!', res.usedModel);
  } catch (e) {
    window.showToast('Lỗi sửa đoạn bôi đen: ' + e.message, 'error');
  } finally {
    SELECTION_STATE.isRunning = false;
    btn.disabled = false; btn.textContent = 'Sửa ngay';
  }
}

// [AI-06] LÒ ĐÚC FILE WORD (.DOCX) CHUẨN MỰC PHỤ LỤC I NGHỊ ĐỊNH 30/2020/NĐ-CP
function collectRunsFromDomNode(node, D, fontHalfPt, styleState) {
  var runs = [];
  if (node.nodeType === 3) {
    var txt = node.nodeValue.replace(/\s+/g, ' ');
    if (txt) {
      runs.push(new D.TextRun({
        text: txt, font: 'Times New Roman', size: fontHalfPt,
        bold: Boolean(styleState.bold), italics: Boolean(styleState.italic),
        underline: styleState.underline ? { type: D.UnderlineType.SINGLE } : undefined
      }));
    }
    return runs;
  }
  if (node.nodeType !== 1) return runs;
  var tag = node.tagName.toUpperCase();
  if (tag === 'BR') {
    runs.push(new D.TextRun({ text: '', break: 1, font: 'Times New Roman', size: fontHalfPt }));
    return runs;
  }
  var isHeading = ['H1', 'H2', 'H3', 'H4'].indexOf(tag) !== -1;
  var nextStyle = {
    bold: styleState.bold || isHeading || tag === 'B' || tag === 'STRONG' || tag === 'TH' || (node.style && (node.style.fontWeight === 'bold' || parseInt(node.style.fontWeight, 10) >= 600)),
    italic: styleState.italic || tag === 'I' || tag === 'EM' || (node.style && node.style.fontStyle === 'italic'),
    underline: styleState.underline || tag === 'U' || (node.style && node.style.textDecoration && node.style.textDecoration.indexOf('underline') !== -1)
  };
  Array.from(node.childNodes).forEach(function(ch) { runs = runs.concat(collectRunsFromDomNode(ch, D, fontHalfPt, nextStyle)); });
  return runs;
}

// Tính độ rộng cột thông minh theo nội dung (cột STT tự thu nhỏ ~7%, cột Nội dung tự mở rộng)
function computeSmartDocxColumnWidths(trEls, totalWidthDxa) {
  var maxCols = 1;
  trEls.forEach(function(tr) {
    var cSum = 0;
    Array.from(tr.children).forEach(function(td) { cSum += Math.max(1, parseInt(td.getAttribute('colspan') || '1', 10)); });
    if (cSum > maxCols) maxCols = cSum;
  });
  if (maxCols <= 1) return [totalWidthDxa];

  var weights = Array(maxCols).fill(10);
  var firstRowCells = Array.from(trEls[0].children);

  for (var col = 0; col < maxCols; col++) {
    var headerTxt = (firstRowCells[col] ? firstRowCells[col].textContent : '').trim().toLowerCase();
    var maxLen = 0;
    trEls.forEach(function(r) {
      if (r.children.length === maxCols && r.children[col]) {
        maxLen = Math.max(maxLen, r.children[col].textContent.trim().length);
      }
    });

    if (/^(stt|tt|số tt)$/.test(headerTxt) || (col === 0 && maxLen <= 4)) {
      weights[col] = 6.5;
    } else if (/^(thời gian|thời hạn|tiến độ|ghi chú|đơn vị tính|số lượng)$/.test(headerTxt) || maxLen <= 14) {
      weights[col] = 14;
    } else if (/^(nội dung|nhiệm vụ|công việc|giải pháp|hoạt động)/.test(headerTxt) || maxLen >= 55) {
      weights[col] = 36;
    } else {
      weights[col] = Math.min(30, Math.max(14, Math.sqrt(maxLen) * 3.6));
    }
  }

  var sumW = weights.reduce(function(a, b) { return a + b; }, 0);
  var widths = weights.map(function(w) { return Math.max(560, Math.floor((w / sumW) * totalWidthDxa)); });
  var diff = totalWidthDxa - widths.reduce(function(a, b) { return a + b; }, 0);
  widths[widths.length - 1] += diff;
  return widths;
}

function convertHtmlBodyToDocxBlocks(containerEl, D, bodyHalfPt, dataBorders) {
  var blocks = [];
  var lastParagraphOptsRef = null;

  function pushParagraphFromEl(elNode, prefixTxt) {
    var tag = elNode.tagName ? elNode.tagName.toUpperCase() : 'P';
    var isHeading = ['H1', 'H2', 'H3', 'H4'].indexOf(tag) !== -1;
    var alignStyle = (elNode.style && elNode.style.textAlign) ? elNode.style.textAlign.toLowerCase() : '';
    var isCenter = alignStyle === 'center';
    var isRight = alignStyle === 'right';
    var noIndent = isCenter || isRight || (elNode.style && (elNode.style.textIndent === '0' || elNode.style.textIndent === '0px' || elNode.style.textIndent === '0pt'));

    var runs = collectRunsFromDomNode(elNode, D, bodyHalfPt, { bold: isHeading, italic: false, underline: false });
    if (prefixTxt) runs.unshift(new D.TextRun({ text: prefixTxt, font: 'Times New Roman', size: bodyHalfPt }));
    if (!runs.length) return;

    var pOpts = {
      alignment: isCenter ? D.AlignmentType.CENTER : (isRight ? D.AlignmentType.RIGHT : D.AlignmentType.JUSTIFIED),
      indent: noIndent ? undefined : { firstLine: 720 }, // 720 twips = 1.27 cm chuẩn NĐ30
      spacing: { before: 60, after: 120, line: 312 },
      keepNext: isHeading ? true : false,
      children: runs
    };
    lastParagraphOptsRef = pOpts;
    blocks.push({ kind: 'p', opts: pOpts });
  }

  Array.from(containerEl.childNodes).forEach(function(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue.trim();
      if (t) {
        var tOpts = {
          alignment: D.AlignmentType.JUSTIFIED,
          indent: { firstLine: 720 },
          spacing: { before: 60, after: 120, line: 312 },
          children: [new D.TextRun({ text: t, font: 'Times New Roman', size: bodyHalfPt })]
        };
        lastParagraphOptsRef = tOpts;
        blocks.push({ kind: 'p', opts: tOpts });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toUpperCase();
    if (tag === 'TABLE') {
      var trEls = Array.from(node.querySelectorAll('tr'));
      if (!trEls.length) return;
      var colWidths = computeSmartDocxColumnWidths(trEls, 9355);
      var tRows = trEls.map(function(trEl, rIdx) {
        var colCursor = 0;
        var allTh = Array.from(trEl.children).every(function(c) { return c.tagName.toUpperCase() === 'TH'; });
        var isHeaderRow = (rIdx === 0 && (allTh || (trEl.parentElement && trEl.parentElement.tagName.toUpperCase() === 'THEAD')));
        var cells = Array.from(trEl.children).map(function(tdEl) {
          var isTh = tdEl.tagName.toUpperCase() === 'TH' || isHeaderRow;
          var cSpan = Math.max(1, parseInt(tdEl.getAttribute('colspan') || '1', 10));
          var rSpan = Math.max(1, parseInt(tdEl.getAttribute('rowspan') || '1', 10));
          var cellW = 0;
          for (var k = 0; k < cSpan; k++) cellW += (colWidths[colCursor + k] || Math.floor(9355 / colWidths.length));
          colCursor += cSpan;

          var cRuns = collectRunsFromDomNode(tdEl, D, 26, { bold: isTh, italic: false, underline: false });
          var cellAlign = isTh ? D.AlignmentType.CENTER : (tdEl.style && tdEl.style.textAlign === 'center' ? D.AlignmentType.CENTER : D.AlignmentType.LEFT);
          return new D.TableCell({
            width: { size: cellW, type: D.WidthType.DXA },
            columnSpan: cSpan > 1 ? cSpan : undefined,
            rowSpan: rSpan > 1 ? rSpan : undefined,
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            children: [new D.Paragraph({
              alignment: cellAlign,
              spacing: { before: 20, after: 20, line: 276 },
              children: cRuns.length ? cRuns : [new D.TextRun({ text: '', font: 'Times New Roman', size: 26 })]
            })]
          });
        });
        return new D.TableRow({ tableHeader: isHeaderRow, cantSplit: true, children: cells });
      });
      lastParagraphOptsRef = null;
      blocks.push({ kind: 'raw', node: new D.Table({ width: { size: 9355, type: D.WidthType.DXA }, columnWidths: colWidths, borders: dataBorders, rows: tRows }) });
      blocks.push({ kind: 'raw', node: new D.Paragraph({ spacing: { before: 40, after: 60 }, children: [] }) });
    } else if (tag === 'UL' || tag === 'OL') {
      Array.from(node.children).forEach(function(li, idx) {
        if (li.tagName && li.tagName.toUpperCase() === 'LI') pushParagraphFromEl(li, tag === 'OL' ? ((idx + 1) + '. ') : '- ');
      });
    } else {
      pushParagraphFromEl(node, '');
    }
  });

  // Giữ đoạn kết thúc văn bản (./.) luôn dính liền với cụm Chữ ký phía dưới, chống rớt trang trắng!
  if (lastParagraphOptsRef) {
    lastParagraphOptsRef.keepNext = true;
  }

  return blocks.map(function(b) { return b.kind === 'p' ? new D.Paragraph(b.opts) : b.node; });
}

async function exportCurrentPaperToDocx() {
  var btn = el('btnExportDocxStub'), oldHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đúc Word...'; }
  try {
    var D = await ensureDocxLibraryLoaded();
    var tab = captureDOMIntoActiveTab(true);
    if (!tab) return;
    var docTypeObj = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
    var bodyHalfPt = (tab.fontSize === '13pt') ? 26 : ((tab.fontSize === '13.5pt') ? 27 : 28);

    var B_NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    var NO_BORDERS = { top: B_NONE, bottom: B_NONE, left: B_NONE, right: B_NONE, insideHorizontal: B_NONE, insideVertical: B_NONE };
    var B_SOLID = { style: D.BorderStyle.SINGLE, size: 6, color: '000000' };
    var DATA_BORDERS = { top: B_SOLID, bottom: B_SOLID, left: B_SOLID, right: B_SOLID, insideHorizontal: B_SOLID, insideVertical: B_SOLID };

    // Ô trái: Cơ quan chủ quản (12pt), Cơ quan ban hành (12pt đậm), đường kẻ ngang cân đối, Số ký hiệu (13pt)
    var leftHeader = [
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 20, line: 260 }, children: [new D.TextRun({ text: (tab.orgLine1 || '').toUpperCase(), font: 'Times New Roman', size: 24 })] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 0, line: 260 }, children: [new D.TextRun({ text: (tab.orgLine2 || '').toUpperCase(), font: 'Times New Roman', size: 24, bold: true })] }),
      new D.Paragraph({ indent: { left: 1180, right: 1180 }, border: { bottom: B_SOLID }, spacing: { before: 20, after: 110, line: 40 }, children: [] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 40, after: 60 }, children: [new D.TextRun({ text: tab.docNumber || '', font: 'Times New Roman', size: 26 })] })
    ];
    if (docTypeObj.isCongVan && tab.cvSubject) {
      leftHeader.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 30, after: 60, line: 260 }, children: [new D.TextRun({ text: tab.cvSubject, font: 'Times New Roman', size: 24 })] }));
    }

    // Ô phải: Quốc hiệu (12.5pt đậm) - Tiêu ngữ (13.5pt đậm) cân xứng độ dài theo chuẩn Phụ lục I NĐ30
    var rightHeader = [
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 20, line: 260 }, children: [new D.TextRun({ text: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', font: 'Times New Roman', size: 25, bold: true })] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 0, line: 260 }, children: [new D.TextRun({ text: 'Độc lập - Tự do - Hạnh phúc', font: 'Times New Roman', size: 27, bold: true })] }),
      new D.Paragraph({ indent: { left: 1060, right: 1060 }, border: { bottom: B_SOLID }, spacing: { before: 20, after: 110, line: 40 }, children: [] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 40, after: 60 }, children: [new D.TextRun({ text: tab.dateLine || '', font: 'Times New Roman', size: 26, italics: true })] })
    ];

    var docChildren = [new D.Table({
      width: { size: 9355, type: D.WidthType.DXA },
      columnWidths: [3930, 5425],
      borders: NO_BORDERS,
      rows: [new D.TableRow({
        cantSplit: true,
        children: [
          new D.TableCell({ width: { size: 3930, type: D.WidthType.DXA }, children: leftHeader }),
          new D.TableCell({ width: { size: 5425, type: D.WidthType.DXA }, children: rightHeader })
        ]
      })]
    })];

    // Tên loại & Trích yếu văn bản
    if (!docTypeObj.isCongVan) {
      docChildren.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 40 }, children: [new D.TextRun({ text: (tab.docTypeName || docTypeObj.name).toUpperCase(), font: 'Times New Roman', size: 28, bold: true })] }));
      if (tab.namedSub && tab.namedSub.trim()) {
        docChildren.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, keepNext: true, spacing: { before: 0, after: 10, line: 280 }, children: [new D.TextRun({ text: tab.namedSub.trim(), font: 'Times New Roman', size: 27, bold: true })] }));
      }
      docChildren.push(new D.Paragraph({ indent: { left: 3200, right: 3200 }, keepNext: true, border: { bottom: B_SOLID }, spacing: { before: 20, after: 180, line: 40 }, children: [] }));
    } else {
      docChildren.push(new D.Paragraph({ spacing: { before: 100, after: 40 }, children: [] }));
    }

    // Kính gửi chuẩn Phụ lục I Nghị định 30: Kiểu chữ đứng, tự tách 1 dòng hoặc nhiều dòng gạch đầu dòng
    var dearTrimmed = (tab.dearLine || '').trim();
    if (!el('a4DearLine').classList.contains('hidden') && dearTrimmed) {
      var dearLines = dearTrimmed.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
      if (dearLines.length <= 1) {
        docChildren.push(new D.Paragraph({
          alignment: D.AlignmentType.CENTER,
          spacing: { before: 80, after: 160, line: 300 },
          children: [new D.TextRun({ text: dearLines[0], font: 'Times New Roman', size: bodyHalfPt })]
        }));
      } else {
        dearLines.forEach(function(dl, dIdx) {
          docChildren.push(new D.Paragraph({
            alignment: D.AlignmentType.LEFT,
            indent: { left: dIdx === 0 ? 2100 : 2500 },
            spacing: { before: dIdx === 0 ? 80 : 20, after: dIdx === dearLines.length - 1 ? 160 : 20, line: 290 },
            children: [new D.TextRun({ text: dl, font: 'Times New Roman', size: bodyHalfPt })]
          }));
        });
      }
    }

    // Thân văn bản
    docChildren = docChildren.concat(convertHtmlBodyToDocxBlocks(el('a4BodyContent'), D, bodyHalfPt, DATA_BORDERS));

    // Nơi nhận chuẩn Điểm 9b Phụ lục I Nghị định 30: "Nơi nhận:" 12pt nghiêng đậm (KHÔNG gạch chân), liệt kê 11pt đứng
    var recLines = (tab.recipients || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var leftFooter = [new D.Paragraph({
      spacing: { before: 80, after: 30 },
      children: [new D.TextRun({ text: 'Nơi nhận:', font: 'Times New Roman', size: 24, bold: true, italics: true })]
    })];
    recLines.forEach(function(rl) {
      leftFooter.push(new D.Paragraph({ spacing: { after: 25, line: 250 }, children: [new D.TextRun({ text: rl, font: 'Times New Roman', size: 22 })] }));
    });

    // Quyền hạn, chức vụ & Họ tên người ký (cantSplit: true bảo vệ không gãy đôi chữ ký giữa 2 trang)
    var authLines = (tab.signerAuth || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean), rightFooter = [];
    authLines.forEach(function(al, idx) {
      rightFooter.push(new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { before: idx === 0 ? 80 : 0, after: 20, line: 260 },
        children: [new D.TextRun({ text: al.toUpperCase(), font: 'Times New Roman', size: bodyHalfPt, bold: true })]
      }));
    });
    rightFooter.push(new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { before: 1350, after: 60 },
      children: [new D.TextRun({ text: tab.signerName || '[Họ và tên người ký]', font: 'Times New Roman', size: bodyHalfPt, bold: true })]
    }));

    docChildren.push(new D.Table({
      width: { size: 9355, type: D.WidthType.DXA },
      columnWidths: [4210, 5145],
      borders: NO_BORDERS,
      rows: [new D.TableRow({
        cantSplit: true,
        children: [
          new D.TableCell({ width: { size: 4210, type: D.WidthType.DXA }, children: leftFooter }),
          new D.TableCell({ width: { size: 5145, type: D.WidthType.DXA }, children: rightFooter })
        ]
      })]
    }));

    var wordDoc = new D.Document({
      sections: [{
        properties: {
          titlePage: true,
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 850, bottom: 1134, left: 1701, header: 567 } }
        },
        headers: {
          first: new D.Header({ children: [new D.Paragraph({ children: [] })] }),
          default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], font: 'Times New Roman', size: 26 })] })] })
        },
        children: docChildren
      }]
    });

    var blob = await D.Packer.toBlob(wordDoc);
    var dNow = new Date(), dTag = String(dNow.getDate()).padStart(2, '0') + String(dNow.getMonth() + 1).padStart(2, '0') + dNow.getFullYear();
    var outName = tab.docType + '_' + slugifyFileName(docTypeObj.isCongVan ? tab.cvSubject : tab.namedSub) + '_' + dTag + '.docx';
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = outName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    window.showToast('Đã xuất file Word: ' + outName, 'ok');
  } catch (err) {
    window.showToast('Lỗi xuất Word: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
  }
}

// [AI-07] KẾT NỐI KÉO THẢ FILE ZALO PC, DÁN ẢNH CTRL+V & BẮT VÙNG BÔI ĐEN TRONG THÂN VĂN BẢN
document.addEventListener('DOMContentLoaded', function() {
  if (APP_STATE.api && APP_STATE.api.verified && APP_STATE.api.key) {
    ensureVerifiedLiveModels(APP_STATE.api.key, false);
  }

  var origApply = window.applyActiveTabToDOM;
  if (typeof origApply === 'function') {
    window.applyActiveTabToDOM = function() {
      origApply();
      clearSelectionState();
      renderTaskFilesList();
      renderChatHistoryForActiveTab();
      syncAiButtonUIForActiveTab();
      var cur = getActiveTab();
      var hasDraft = Boolean(cur && cur.bodyHtml && cur.bodyHtml.trim().length > 20);
      if (el('chkDeltaMode')) el('chkDeltaMode').checked = hasDraft;
    };
    window.applyActiveTabToDOM();
  }

  // Chỉ bắt vệt bôi đen nằm gọn bên trong #a4BodyContent (bảo vệ tuyệt đối khung Quốc hiệu & Chữ ký)
  document.addEventListener('selectionchange', function() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var txt = sel.toString().trim();
    var bodyEl = el('a4BodyContent');
    if (txt.length >= 2 && bodyEl && bodyEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      SELECTION_STATE.savedRange = sel.getRangeAt(0).cloneRange();
      SELECTION_STATE.savedSelectedText = txt;
      SELECTION_STATE.tabId = APP_STATE.activeTabId;
    }
  });

  el('btnOpenSelectionAi').addEventListener('mousedown', function(e) { e.preventDefault(); });
  el('btnOpenSelectionAi').addEventListener('click', function() {
    var sel = window.getSelection();
    var bodyEl = el('a4BodyContent');
    var liveTxt = (sel && sel.rangeCount && bodyEl && bodyEl.contains(sel.getRangeAt(0).commonAncestorContainer)) ? sel.toString().trim() : '';
    if (liveTxt.length >= 2) {
      SELECTION_STATE.savedRange = sel.getRangeAt(0).cloneRange();
      SELECTION_STATE.savedSelectedText = liveTxt;
      SELECTION_STATE.tabId = APP_STATE.activeTabId;
    }
    if (!SELECTION_STATE.savedRange || !SELECTION_STATE.savedSelectedText || SELECTION_STATE.tabId !== APP_STATE.activeTabId) {
      return window.showToast('Hãy quét chuột bôi đen câu/đoạn chữ trong phần nội dung giấy A4 trước rồi bấm nút này!', 'warn');
    }
    var t = SELECTION_STATE.savedSelectedText.replace(/\s+/g, ' ');
    el('selectionPreviewTxt').textContent = '"' + (t.length > 48 ? t.substring(0, 48) + '...' : t) + '"';
    el('selectionAiBar').classList.replace('hidden', 'flex');
    el('selectionCustomPrompt').focus();
  });

  el('btnRunSelectionAi').addEventListener('click', executeSelectionRewrite);
  el('selectionCustomPrompt').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); executeSelectionRewrite(); } });
  el('btnCloseSelectionAi').addEventListener('click', clearSelectionState);

  // Đính kèm file truyền thống
  el('btnPickTaskFiles').addEventListener('click', function() { el('taskFilesInput').click(); });
  el('taskFilesInput').addEventListener('change', function(e) {
    addFilesToActiveTabTasks(e.target.files);
    e.target.value = '';
  });

  // Kéo - Thả (Drag & Drop) trực tiếp file từ Zalo PC / Windows Explorer vào Cột trái
  var sidebarDrop = el('leftSidebar'), dropSection = el('aiDropZoneSection');
  if (sidebarDrop) {
    var dragDepth = 0;
    sidebarDrop.addEventListener('dragenter', function(e) {
      e.preventDefault();
      dragDepth++;
      if (dropSection) dropSection.classList.add('dropzone-active');
    });
    sidebarDrop.addEventListener('dragover', function(e) { e.preventDefault(); });
    sidebarDrop.addEventListener('dragleave', function() {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 && dropSection) dropSection.classList.remove('dropzone-active');
    });
    sidebarDrop.addEventListener('drop', function(e) {
      e.preventDefault();
      dragDepth = 0;
      if (dropSection) dropSection.classList.remove('dropzone-active');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFilesToActiveTabTasks(e.dataTransfer.files);
        window.showToast('Đã nhận ' + e.dataTransfer.files.length + ' file đề bài!', 'ok');
      }
    });
  }

  // Ctrl + V dán trực tiếp ảnh chụp màn hình công văn / bút phê Zalo vào ô nhập lệnh AI
  if (el('aiPromptInput')) {
    el('aiPromptInput').addEventListener('paste', function(e) {
      var cd = e.clipboardData || window.clipboardData;
      if (!cd || !cd.items) return;
      var imgFiles = [];
      for (var i = 0; i < cd.items.length; i++) {
        var it = cd.items[i];
        if (it.kind === 'file' && it.type.indexOf('image/') === 0) {
          var blob = it.getAsFile();
          if (blob) {
            var ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
            var namedImg = new File([blob], 'Anh_Zalo_' + formatTimeHHMMSS().replace(/:/g, '') + '.' + ext, { type: blob.type });
            imgFiles.push(namedImg);
          }
        }
      }
      if (imgFiles.length > 0) {
        addFilesToActiveTabTasks(imgFiles);
        window.showToast('Đã dán ảnh chụp màn hình vào Đề bài AI!', 'ok');
      }
    });
  }

  el('btnAutoFilterCabinet').addEventListener('click', autoFilterCabinetByTopic);
  el('btnRunAi').addEventListener('click', executeMainAiDrafting);
  el('btnCancelAi').addEventListener('click', function() {
    var cur = getActiveTab();
    if (!cur) return;
    var rt = getTabRuntime(cur.id);
    rt.userCancelled = true;
    if (rt.abortCtrl) rt.abortCtrl.abort();
  });
  function autoFitPromptTextarea() {
    var inp = el('aiPromptInput');
    if (!inp) return;
    inp.style.height = 'auto';
    var nextH = Math.min(220, Math.max(118, inp.scrollHeight || 118));
    inp.style.height = nextH + 'px';
  }
  el('aiPromptInput').addEventListener('input', autoFitPromptTextarea);
  el('aiPromptInput').addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); executeMainAiDrafting(); } });

  document.querySelectorAll('.quick-prompt-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.quick-prompt-btn').forEach(function(b) {
        b.className = 'quick-prompt-btn h-9 bg-white hover:bg-purple-50 border border-slate-300 text-slate-700 font-medium text-[10.5px] leading-tight rounded-md flex items-center justify-center text-center px-1 transition cursor-pointer';
      });
      btn.className = 'quick-prompt-btn h-9 bg-purple-100 border border-purple-400 text-purple-900 font-semibold text-[10.5px] leading-tight rounded-md flex items-center justify-center text-center px-1 transition cursor-pointer';
      el('aiPromptInput').value = btn.getAttribute('data-quick');
      autoFitPromptTextarea();
      el('aiPromptInput').focus();
    });
  });

  el('btnExportDocxStub').addEventListener('click', exportCurrentPaperToDocx);
});
