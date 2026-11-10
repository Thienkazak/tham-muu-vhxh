// [AI-01] NHÂN ĐỌC PDF, BỘ ĐỆM INDEXEDDB & BIẾN GIỮ VỆT BÔI ĐEN TRÊN GIẤY A4
if (window.pdfjsLib && window.location.protocol !== 'file:') {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

var AI_RUNTIME = {
  taskFiles: [],
  abortCtrl: null,
  userCancelled: false,
  isBusy: false,
  savedRange: null,
  savedSelectedText: ''
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
  if (maxChars && s.length > maxChars) s = s.substring(0, maxChars) + '\n...[Đã lược bớt phần phụ lục cuối]...';
  return s;
}

function stripDigitalSigBoilerplate(txt) {
  return String(txt || '').replace(/(Ký bởi|Người ký|Cơ quan|Thời gian ký|Ngày ký|Email|Signature|Digitally signed by)[^\n]*/gi, '').replace(/\s+/g, '');
}

// [AI-02] BÓC CHỮ FILE WORD, EXCEL, PDF KÝ SỐ & NÉN ẢNH SCAN
async function openPdfSafeEverywhere(uint8Arr) {
  var cMap = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/';
  var isLocalFile = window.location.protocol === 'file:';
  try {
    return await window.pdfjsLib.getDocument({ data: uint8Arr.slice(0), disableWorker: isLocalFile, cMapUrl: cMap, cMapPacked: true }).promise;
  } catch (e1) {
    return await window.pdfjsLib.getDocument({ data: uint8Arr.slice(0), disableWorker: true }).promise;
  }
}

async function extractFileForAI(fileObj, allowVisionForScan, maxChars) {
  var name = fileObj.name || 'Tai_lieu';
  var ext = name.indexOf('.') !== -1 ? name.split('.').pop().toLowerCase() : '';
  var cacheKey = 'v3|' + name + '|' + fileObj.size + '|' + fileObj.lastModified;

  if (['png', 'jpg', 'jpeg', 'webp'].indexOf(ext) !== -1) {
    if (!allowVisionForScan) return { text: '', inlineParts: [], badge: 'Ảnh' };
    var imgPart = await compressImageFileToInlinePart(fileObj);
    return { text: '[Ảnh văn bản đính kèm: ' + name + ']', inlineParts: [imgPart], isVision: true, badge: 'Ảnh Scan' };
  }

  var cached = await getCachedFileText(cacheKey);
  if (cached) return { text: compactAdminText(cached, maxChars), inlineParts: [], badge: 'Đã bóc ' + Math.max(1, Math.round(cached.length / 1024)) + 'KB chữ' };

  var rawText = '';
  if (ext === 'txt' || ext === 'md' || ext === 'csv') rawText = await fileObj.text();
  else if (ext === 'docx') {
    var bufDocx = await fileObj.arrayBuffer();
    if (window.mammoth) rawText = (await window.mammoth.extractRawText({ arrayBuffer: bufDocx })).value || '';
  } else if (ext === 'doc') {
    return { text: '[File ' + name + ' là .doc Word 2003 cũ. Nên lưu sang .docx hoặc .pdf]', inlineParts: [], badge: 'Đổi sang .docx' };
  } else if (ext === 'xlsx' || ext === 'xls') {
    var bufXls = await fileObj.arrayBuffer();
    if (window.XLSX) {
      var wb = window.XLSX.read(bufXls, { type: 'array' });
      rawText = wb.SheetNames.slice(0, 5).map(function(sName) {
        var csv = window.XLSX.utils.sheet_to_csv(wb.Sheets[sName], { blankrows: false });
        return (csv && csv.trim()) ? ('--- Sheet: ' + sName + ' ---\n' + csv) : '';
      }).filter(Boolean).join('\n\n');
    }
  } else if (ext === 'pdf') return await extractPdfSmart(fileObj, cacheKey, allowVisionForScan, maxChars);

  if (rawText && rawText.trim().length > 5) await setCachedFileText(cacheKey, rawText);
  return { text: compactAdminText(rawText, maxChars), inlineParts: [], badge: 'Chữ (' + Math.max(1, Math.round((rawText || '').length / 1024)) + 'KB)' };
}

async function extractPdfSmart(fileObj, cacheKey, allowVision, maxChars) {
  if (!window.pdfjsLib) return { text: '[Thiếu PDF.js]', inlineParts: [], badge: 'Thiếu PDF.js' };
  try {
    var buf = await fileObj.arrayBuffer();
    var pdf = await openPdfSafeEverywhere(new Uint8Array(buf));
    var maxPages = Math.min(pdf.numPages, 25), pageTexts = [];
    for (var p = 1; p <= maxPages; p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var line = tc.items.map(function(it) { return it.str; }).join(' ');
      if (line.trim()) pageTexts.push(line);
    }
    var joined = pageTexts.join('\n');
    if (stripDigitalSigBoilerplate(joined).length >= Math.min(220, maxPages * 85)) {
      await setCachedFileText(cacheKey, joined);
      return { text: compactAdminText(joined, maxChars), inlineParts: [], badge: 'Chữ PDF (' + maxPages + 'tr • ' + Math.max(1, Math.round(joined.length / 1024)) + 'KB)' };
    }
    if (allowVision) {
      var visionParts = [], scanPages = Math.min(pdf.numPages, 6), totalImgBytes = 0;
      for (var sp = 1; sp <= scanPages; sp++) {
        var sPage = await pdf.getPage(sp);
        var vp1 = sPage.getViewport({ scale: 1.0 });
        var vp = sPage.getViewport({ scale: Math.min(1.5, 1080 / Math.max(vp1.width, 1)) });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await sPage.render({ canvasContext: ctx, viewport: vp }).promise;
        var b64 = canvas.toDataURL('image/jpeg', 0.62).split(',')[1];
        totalImgBytes += Math.round(b64.length * 0.75);
        visionParts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }
      return { text: '[Văn bản PDF Scan dấu đỏ (' + scanPages + '/' + pdf.numPages + ' trang): ' + fileObj.name + ']', inlineParts: visionParts, isVision: true, badge: 'Scan ' + scanPages + 'tr (' + Math.max(1, Math.round(totalImgBytes / 1024)) + 'KB)' };
    }
    return { text: '', inlineParts: [], badge: 'PDF Scan' };
  } catch (err) {
    return { text: '[Lỗi đọc PDF: ' + err.message + ']', inlineParts: [], badge: 'Lỗi PDF' };
  }
}

function compressImageFileToInlinePart(fileObj) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var scale = img.width > 1200 ? (1200 / img.width) : 1;
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ inlineData: { mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.72).split(',')[1] } });
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(fileObj);
  });
}
// [AI-03] CHỌN MODEL SỐNG, ĐỊA BÀN 24 KHU PHỐ (KHÔNG ĐƯA TÊN CÁ NHÂN VÀO PROMPT)
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
  var blockedWords = ['tts', 'image', 'embedding', 'imagen', 'veo', 'robotics', 'computer-use', 'audio', 'aqa', 'learnlm', 'thinking', 'omni', 'pro-preview'];
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
          if (typeof loadApiSettings === 'function') loadApiSettings();
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
    pushUnique(APP_STATE.api.primaryModel); pushUnique('gemini-2.5-flash');
    if (!hasVisionParts) pushUnique('gemma-3-27b-it');
  }
  return chain.slice(0, 3);
}

function syncDearLineVisibility(docTypeCode, dearText) {
  var dearEl = el('a4DearLine');
  if (!dearEl) return;
  if ((['KH', 'QD', 'TB'].indexOf(docTypeCode) !== -1 && !dearText) || !dearText || !dearText.trim()) {
    dearEl.textContent = ''; dearEl.classList.add('hidden');
  } else {
    dearEl.textContent = dearText.trim(); dearEl.classList.remove('hidden');
  }
}

function buildAdminSystemPrompt(tab) {
  var p = APP_STATE.profile || {};
  var def = APP_CONFIG.defaultOrg;
  var role = APP_CONFIG.roles.find(function(r) { return r.id === tab.roleId; }) || APP_CONFIG.roles[0];
  var docType = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
  var isNoDear = ['KH', 'QD', 'TB'].indexOf(docType.code) !== -1;
  var localFacts = getSavedLocalFacts();

  var structureRule = '';
  if (docType.code === 'KH') {
    structureRule = '- ĐÂY LÀ KẾ HOẠCH: Không ghi Kính gửi. Bố cục chuẩn: Căn cứ/Thực hiện văn bản cấp trên -> <b>I. MỤC ĐÍCH, YÊU CẦU</b> -> <b>II. NỘI DUNG, THỜI GIAN, ĐỊA ĐIỂM</b> -> <b>III. KINH PHÍ THỰC HIỆN</b> -> <b>IV. TỔ CHỨC THỰC HIỆN</b> (giao rõ đơn vị chủ trì, phối hợp, sản phẩm, thời hạn theo đúng tên các đơn vị và 24 Khu phố của Phường Phú Nhuận). Kết thúc bằng ./.\n';
  } else if (docType.code === 'QD') {
    structureRule = '- ĐÂY LÀ QUYẾT ĐỊNH: Không ghi Kính gửi. Mở đầu Căn cứ..., Theo đề nghị của Trưởng Phòng Văn hóa - Xã hội..., tiếp theo <p style="text-align:center;text-indent:0"><b>QUYẾT ĐỊNH:</b></p> rồi đến <b>Điều 1.</b>, <b>Điều 2.</b>, <b>Điều 3.</b>\n';
  }

  return 'Bạn là Chuyên gia Tham mưu Văn bản Hành chính tại ' + def.deptName + ' thuộc ' + def.govParent + ', Thành phố Hồ Chí Minh.\n'
    + 'THỰC TẾ ĐỊA BÀN & TỔ CHỨC BỘ MÁY BẮT BUỘC TUÂN THỦ:\n'
    + localFacts + '\n'
    + '- Mảng chuyên môn đang phụ trách: ' + (p.staffField || 'Văn hóa - Xã hội') + '.\n'
    + '- VAI THAM MƯU: ' + role.shortName + ' -> ' + role.toneDesc + '\n'
    + '- LOẠI VĂN BẢN: ' + docType.name.toUpperCase() + ' (Phụ lục I Nghị định 30/2020/NĐ-CP).\n'
    + structureRule
    + 'QUY TẮC XUẤT KẾT QUẢ:\n'
    + '1. Chỉ viết phần thân trong NOI_DUNG_HTML bằng thẻ <p>...</p>, <b>...</b>, và <table> nếu có bảng (KHÔNG lặp lại Quốc hiệu, Số hiệu, Ngày tháng, Tên loại văn bản, Chữ ký, và KHÔNG tự điền tên người ký).\n'
    + '2. BẮT BUỘC XUẤT ĐÚNG 5 NHÃN PHÂN CÁCH SAU:\n'
    + '<<<TRICH_YEU>>>\n'
    + (docType.isCongVan ? 'V/v ...\n' : 'Về việc ... (hoặc tên Kế hoạch/Báo cáo không lặp lại chữ KẾ HOẠCH)\n')
    + '<<<KINH_GUI>>>\n'
    + (isNoDear ? '\n' : 'Kính gửi: ...\n')
    + '<<<NOI_DUNG_HTML>>>\n'
    + '<p>Nội dung...</p>\n'
    + '<<<NOI_NHAN>>>\n'
    + '- Như trên;\n- Lưu: VT, VHXH.\n'
    + '<<<TOM_TAT>>>\n'
    + 'Tóm tắt 1-2 câu báo cáo điểm chính vừa tham mưu.';
}

// [AI-04] GỌI TRẠM GÁC ẨN KEY (MÃ NỘI BỘ) HOẶC GỌI TRỰC TIẾP KEY CÁ NHÂN
async function callSharedProxyGateway(pin, userParts, sysPrompt) {
  var proxyUrl = (APP_CONFIG.proxyWebAppUrl || '').trim();
  if (!proxyUrl) {
    throw new Error('Chưa cấu hình link Trạm Gác trong config.js! Bạn có thể dán Gemini API Key cá nhân vào Cách 2 để dùng ngay.');
  }
  var ctrl = new AbortController();
  AI_RUNTIME.abortCtrl = ctrl;
  var timer = setTimeout(function() { ctrl.abort(); }, 150000);
  try {
    setAiBusyUI(true, 'Đang tham mưu qua Kênh Mã nội bộ...');
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
    return { text: data.text, usedModel: (data.usedModel || 'Model Free') + ' (Mã nội bộ)' };
  } finally {
    clearTimeout(timer);
    AI_RUNTIME.abortCtrl = null;
  }
}

async function callSingleModelStreamOrPost(modelId, key, payload, onProgress) {
  var ctrl = new AbortController();
  AI_RUNTIME.abortCtrl = ctrl;
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
              else if (thoughtChars > 0) setAiBusyUI(true, 'AI đang suy luận dàn ý (' + thoughtChars + ' ký tự)...');
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
    AI_RUNTIME.abortCtrl = null;
  }
}

async function callGeminiStreamWithFallback(userParts, sysPrompt, onProgress) {
  var key = (APP_STATE.api && APP_STATE.api.key) ? APP_STATE.api.key.trim() : '';
  var pin = (APP_STATE.api && APP_STATE.api.internalPin) ? APP_STATE.api.internalPin.trim() : '';

  if (!key && pin) {
    return await callSharedProxyGateway(pin, userParts, sysPrompt);
  }
  if (!key && !pin) {
    openModalSafe('modalApi');
    throw new Error('Vui lòng nhập Mã nội bộ hoặc Gemini API Key cá nhân ở hộp góc trên bên phải trước khi sử dụng!');
  }

  var hasVision = userParts.some(function(pt) { return Boolean(pt.inlineData); });
  var chain = await ensureVerifiedLiveModels(key, hasVision);
  AI_RUNTIME.userCancelled = false;
  var errorLog = [];

  for (var i = 0; i < chain.length; i++) {
    if (AI_RUNTIME.userCancelled) throw new Error('USER_CANCELLED');
    var modelId = chain[i];
    var isGemma = modelId.indexOf('gemma') === 0;
    var payload = isGemma
      ? { contents: [{ role: 'user', parts: [{ text: sysPrompt + '\n\n---\n' }].concat(userParts) }], generationConfig: { temperature: 0.25 } }
      : { systemInstruction: { parts: [{ text: sysPrompt }] }, contents: [{ role: 'user', parts: userParts }], generationConfig: { temperature: 0.25 } };
    try {
      setAiBusyUI(true, 'Đang gọi [' + modelId + ']...');
      var outText = await callSingleModelStreamOrPost(modelId, key, payload, onProgress);
      return { text: outText, usedModel: modelId };
    } catch (err) {
      if (AI_RUNTIME.userCancelled || (err && err.message === 'USER_CANCELLED')) throw new Error('USER_CANCELLED');
      var reason = (err && err.name === 'AbortError') ? 'Quá 150s chờ' : (err.message || String(err));
      errorLog.push('[' + modelId + '] ' + reason);
      if (reason.indexOf('API key not valid') !== -1 || reason.indexOf('API_KEY_INVALID') !== -1) break;
    }
  }
  throw new Error(errorLog.join(' | '));
}
// [AI-05] ĐỔ CHỮ LÊN GIẤY A4, SỬA ĐOẠN BÔI ĐEN KHÔNG BAO GIỜ TUỘT CHỌN & LỌC TỦ
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

function sanitizeAdminHtml(html) {
  var temp = document.createElement('div');
  temp.innerHTML = (html || '').replace(/^```html\s*/i, '').replace(/\s*```$/i, '');
  temp.querySelectorAll('script, iframe, object, embed, style, link').forEach(function(n) { n.remove(); });
  temp.querySelectorAll('*').forEach(function(node) {
    Array.from(node.attributes).forEach(function(attr) {
      if (attr.name.toLowerCase().indexOf('on') === 0) node.removeAttribute(attr.name);
    });
  });
  return temp.innerHTML.trim() || '<p></p>';
}

function setAiBusyUI(busy, statusText) {
  AI_RUNTIME.isBusy = busy;
  var btnRun = el('btnRunAi'), btnCancel = el('btnCancelAi');
  if (busy) {
    btnRun.disabled = true;
    btnRun.className = 'bg-slate-600 text-white font-bold text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 cursor-not-allowed';
    btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (statusText || 'Đang xử lý...');
    btnCancel.classList.remove('hidden');
  } else {
    btnRun.disabled = false;
    btnRun.className = 'bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs py-1.5 px-3 rounded-lg shadow flex items-center gap-1.5 transition';
    btnRun.innerHTML = '<i class="fa-solid fa-bolt"></i> Tham mưu A4';
    btnCancel.classList.add('hidden');
  }
}

function appendChatMessage(sender, text, modelTag) {
  var tab = getActiveTab();
  if (!tab) return;
  tab.chatHistory = tab.chatHistory || [];
  tab.chatHistory.push({ sender: sender, text: text, modelTag: modelTag || '', ts: Date.now() });
  if (tab.chatHistory.length > 20) tab.chatHistory = tab.chatHistory.slice(-20);
  renderChatHistoryForActiveTab();
  scheduleAutoSave();
}

function renderChatHistoryForActiveTab() {
  var box = el('aiChatLog'), tab = getActiveTab();
  if (!box || !tab) return;
  var hist = tab.chatHistory || [];
  box.innerHTML = '';
  hist.forEach(function(m) {
    var div = document.createElement('div');
    div.className = 'p-2 text-xs leading-relaxed ' + (m.sender === 'user' ? 'chat-msg-user ml-4' : 'chat-msg-ai mr-3');
    var tag = m.modelTag ? '<div class="text-[10px] text-purple-600 font-semibold mb-0.5"><i class="fa-solid fa-microchip"></i> ' + m.modelTag + '</div>' : '';
    div.innerHTML = tag + '<div class="whitespace-pre-wrap break-words"></div>';
    div.lastChild.textContent = m.text;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function prepareAddedTaskFiles() {
  for (var i = 0; i < AI_RUNTIME.taskFiles.length; i++) {
    var tf = AI_RUNTIME.taskFiles[i];
    if (tf.loaded || tf.loading) continue;
    tf.loading = true; tf.badge = 'Đang bóc...'; renderTaskFilesList();
    try {
      var parsed = await extractFileForAI(tf.file, true, 26000);
      tf.extractedText = parsed.text; tf.inlineParts = parsed.inlineParts || [];
      tf.isVision = Boolean(parsed.isVision); tf.badge = parsed.badge || 'Sẵn sàng'; tf.loaded = true;
    } catch (e) { tf.badge = 'Lỗi file'; }
    tf.loading = false; renderTaskFilesList();
  }
}

async function executeMainAiDrafting() {
  if (AI_RUNTIME.isBusy) return;
  var promptTxt = el('aiPromptInput').value.trim();
  if (!promptTxt && AI_RUNTIME.taskFiles.length === 0) return alert('Hãy nhập yêu cầu hoặc đính kèm file đề bài nhé!');
  if (!promptTxt) promptTxt = APP_CONFIG.defaultPrompt;

  var tab = captureDOMIntoActiveTab(true);
  if (!tab) return;
  var useDelta = el('chkDeltaMode').checked;

  appendChatMessage('user', promptTxt);
  el('aiPromptInput').value = '';
  setAiBusyUI(true, 'Đang đọc hồ sơ...');

  try {
    await prepareAddedTaskFiles();
    var parts = [], contextBlocks = [];
    AI_RUNTIME.taskFiles.forEach(function(tf) {
      if (!useDelta || tf.sendOnce !== true) {
        if (tf.extractedText) contextBlocks.push('=== VĂN BẢN ĐỀ BÀI CẤP TRÊN: ' + tf.name + ' ===\n' + tf.extractedText);
        if (tf.inlineParts && tf.inlineParts.length) parts = parts.concat(tf.inlineParts);
        tf.sendOnce = true;
      }
    });

    var checkedCab = (APP_STATE.cabinetFiles || []).filter(function(f) { return f.checked; });
    for (var c = 0; c < checkedCab.length; c++) {
      var cf = checkedCab[c];
      if (useDelta && !cf.isPinned) continue;
      setAiBusyUI(true, 'Đọc tủ PC (' + (c + 1) + '/' + checkedCab.length + ')...');
      var parsedC = await extractFileForAI(cf.fileObj, false, cf.isPinned ? 8000 : 5000);
      if (parsedC.text) contextBlocks.push('=== ' + (cf.isPinned ? '[GHIM CỐ ĐỊNH] ' : '[HỒ SƠ 15 NGÀY] ') + cf.name + ' ===\n' + parsedC.text);
    }

    if (useDelta) {
      contextBlocks.push('=== BẢN NHÁP HIỆN TẠI TRÊN GIẤY A4 (HÃY SỬA/BỔ SUNG DỰA TRÊN BẢN NÀY) ===\n'
        + 'Trích yếu: ' + (tab.cvSubject || tab.namedSub) + '\nKính gửi: ' + (tab.dearLine || '') + '\nNội dung HTML:\n' + (tab.bodyHtml || '') + '\nNơi nhận:\n' + (tab.recipients || ''));
    }

    parts.push({ text: (contextBlocks.length ? contextBlocks.join('\n\n') + '\n\n' : '') + '=== YÊU CẦU CỦA CÁN BỘ ===\n' + promptTxt });
    pushTabSnapshot('Trước khi AI cập nhật', false);

    var docTypeObj = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
    var lastRenderTs = 0;

    function applyParsedToPaper(sec, isFinal) {
      if (sec.docSubject) {
        if (docTypeObj.isCongVan) el('a4CvSubject').textContent = sec.docSubject.indexOf('V/v') === 0 ? sec.docSubject : ('V/v ' + sec.docSubject.replace(/^Về việc\s*/i, ''));
        else el('a4NamedSub').textContent = sec.docSubject.replace(/^(KẾ HOẠCH|TỜ TRÌNH|BÁO CÁO|THÔNG BÁO|QUYẾT ĐỊNH)\s*/i, '');
      }
      if (sec.dearLine !== null) syncDearLineVisibility(docTypeObj.code, sec.dearLine);
      if (sec.bodyHtml) el('a4BodyContent').innerHTML = sanitizeAdminHtml(sec.bodyHtml);
      if (isFinal && sec.recipients) el('a4Recipients').textContent = sec.recipients;
    }

    var result = await callGeminiStreamWithFallback(parts, buildAdminSystemPrompt(tab), function(liveText) {
      var now = Date.now();
      if (now - lastRenderTs < 300) return;
      lastRenderTs = now;
      setAiBusyUI(true, 'Đang viết (' + liveText.length + ' ký tự)...');
      applyParsedToPaper(parseStreamedSections(liveText), false);
    });

    var finalSec = parseStreamedSections(result.text);
    applyParsedToPaper(finalSec, true);
    captureDOMIntoActiveTab(true); renderWorkspaceTabsBar(); scheduleAutoSave();
    el('chkDeltaMode').checked = true;
    appendChatMessage('ai', finalSec.summaryReply || 'Đã soạn thảo hoàn chỉnh lên giấy A4!', result.usedModel);
  } catch (err) {
    if (err && err.message === 'USER_CANCELLED') appendChatMessage('ai', 'Đã dừng viết theo yêu cầu.');
    else appendChatMessage('ai', 'Lưu ý: ' + (err.message || String(err)));
  } finally {
    setAiBusyUI(false);
  }
}

async function autoFilterCabinetByTopic() {
  var list = APP_STATE.cabinetFiles || [];
  if (!list.length) return alert('Chưa có file nào trong Tủ hồ sơ PC để lọc!');
  await prepareAddedTaskFiles();
  var q = ((el('aiPromptInput').value || '') + ' ' + AI_RUNTIME.taskFiles.map(function(t) { return t.name + ' ' + (t.extractedText || '').substring(0, 1500); }).join(' ')).toLowerCase();
  var words = q.replace(/[^a-zA-Z0-9À-ỹ\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length >= 3; });
  if (!words.length) return alert('Hãy chọn file Đề bài hoặc gõ từ khóa trước để lọc nhé!');
  var scored = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].isPinned) { list[i].checked = true; continue; }
    var hay = list[i].name.toLowerCase();
    var c = await getCachedFileText('v3|' + list[i].name + '|' + list[i].size + '|' + list[i].lastModified);
    if (c) hay += ' ' + c.substring(0, 2000).toLowerCase();
    var sc = 0; words.forEach(function(w) { if (hay.indexOf(w) !== -1) sc++; });
    scored.push({ idx: i, sc: sc });
  }
  scored.sort(function(a, b) { return b.sc - a.sc; });
  scored.forEach(function(s, rank) { list[s.idx].checked = (rank < 4 && s.sc > 0) || (scored[0].sc === 0 && rank < 3); });
  renderCabinetList();
  appendChatMessage('ai', 'Đã lọc giữ các file sát chủ đề đề bài nhất!');
}

async function executeSelectionRewrite() {
  if (AI_RUNTIME.isBusy || !AI_RUNTIME.savedRange || !AI_RUNTIME.savedSelectedText) return;
  var reqTxt = el('selectionCustomPrompt').value.trim() || 'Viết lại chuẩn văn phong hành chính Nghị định 30, rõ ý và chặt chẽ hơn';
  var tab = captureDOMIntoActiveTab(true);
  var role = APP_CONFIG.roles.find(function(r) { return r.id === tab.roleId; }) || APP_CONFIG.roles[0];
  var btn = el('btnRunSelectionAi');
  btn.disabled = true; btn.textContent = 'Đang sửa...';
  try {
    var sys = 'Chuyên gia biên tập văn bản hành chính Phòng Văn hóa - Xã hội, UBND Phường Phú Nhuận (có 24 Khu phố), TP.HCM (' + role.shortName + '). Chỉ trả về đúng đoạn văn đã biên tập lại, không giải thích, không ngoặc kép.';
    var res = await callGeminiStreamWithFallback([{ text: 'ĐOẠN GỐC:\n' + AI_RUNTIME.savedSelectedText + '\n\nYÊU CẦU:\n' + reqTxt }], sys, null);
    pushTabSnapshot('Trước khi sửa đoạn bôi đen', false);
    AI_RUNTIME.savedRange.deleteContents();
    AI_RUNTIME.savedRange.insertNode(document.createTextNode(res.text.trim().replace(/^["“]|["”]$/g, '')));
    AI_RUNTIME.savedRange = null; AI_RUNTIME.savedSelectedText = '';
    el('selectionAiBar').classList.replace('flex', 'hidden');
    scheduleAutoSave();
    appendChatMessage('ai', 'Đã chuốt lại đoạn bôi đen trên giấy A4!', res.usedModel);
  } catch (e) { alert('Lỗi sửa đoạn: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Sửa ngay'; }
}

function renderTaskFilesList() {
  var box = el('taskFilesList');
  box.innerHTML = '';
  AI_RUNTIME.taskFiles.forEach(function(tf, idx) {
    var cls = tf.isVision ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300';
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-1.5 bg-purple-50/70 border border-purple-200 rounded px-2 py-1 text-[11px]';
    row.innerHTML = '<div class="truncate flex-1 font-medium text-slate-700"><i class="fa-solid fa-file-lines text-purple-600 mr-1"></i>' + tf.name + '</div>'
      + '<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold ' + cls + '">' + (tf.badge || 'Đề bài') + '</span>'
      + '<button type="button" class="shrink-0 text-slate-400 hover:text-rose-600 px-1"><i class="fa-solid fa-trash-can"></i></button>';
    row.querySelector('button').addEventListener('click', function() { AI_RUNTIME.taskFiles.splice(idx, 1); renderTaskFilesList(); });
    box.appendChild(row);
  });
}
// [AI-06] LÒ ĐÚC FILE WORD (.DOCX) CHUẨN A4 CÓ ĐÁNH SỐ TRANG NGHỊ ĐỊNH 30
async function ensureDocxLibraryLoaded() {
  if (window.docx) return window.docx;
  await new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/docx@8.5.0/build/index.umd.js';
    s.onload = resolve; s.onerror = function() { reject(new Error('Không tải được thư viện xuất Word!')); };
    document.head.appendChild(s);
  });
  return window.docx;
}

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
  if (tag === 'BR') { runs.push(new D.TextRun({ text: '', break: 1, font: 'Times New Roman', size: fontHalfPt })); return runs; }
  var nextStyle = {
    bold: styleState.bold || tag === 'B' || tag === 'STRONG' || tag === 'TH' || (node.style && (node.style.fontWeight === 'bold' || parseInt(node.style.fontWeight, 10) >= 600)),
    italic: styleState.italic || tag === 'I' || tag === 'EM' || (node.style && node.style.fontStyle === 'italic'),
    underline: styleState.underline || tag === 'U' || (node.style && node.style.textDecoration && node.style.textDecoration.indexOf('underline') !== -1)
  };
  Array.from(node.childNodes).forEach(function(ch) { runs = runs.concat(collectRunsFromDomNode(ch, D, fontHalfPt, nextStyle)); });
  return runs;
}

function convertHtmlBodyToDocxBlocks(containerEl, D, bodyHalfPt, dataBorders) {
  var blocks = [];
  function pushParagraphFromEl(elNode, prefixTxt) {
    var isCenter = elNode.style && elNode.style.textAlign === 'center';
    var runs = collectRunsFromDomNode(elNode, D, bodyHalfPt, { bold: false, italic: false, underline: false });
    if (prefixTxt) runs.unshift(new D.TextRun({ text: prefixTxt, font: 'Times New Roman', size: bodyHalfPt }));
    if (!runs.length) return;
    blocks.push(new D.Paragraph({
      alignment: isCenter ? D.AlignmentType.CENTER : D.AlignmentType.JUSTIFIED,
      indent: isCenter ? undefined : { firstLine: 720 },
      spacing: { before: 0, after: 120, line: 312 },
      children: runs
    }));
  }
  Array.from(containerEl.childNodes).forEach(function(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue.trim();
      if (t) blocks.push(new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, indent: { firstLine: 720 }, spacing: { before: 0, after: 120, line: 312 }, children: [new D.TextRun({ text: t, font: 'Times New Roman', size: bodyHalfPt })] }));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toUpperCase();
    if (tag === 'TABLE') {
      var trEls = Array.from(node.querySelectorAll('tr'));
      if (!trEls.length) return;
      var maxCols = 1; trEls.forEach(function(r) { maxCols = Math.max(maxCols, r.children.length || 1); });
      var colW = Math.floor(9355 / maxCols), colWidths = Array(maxCols).fill(colW);
      var tRows = trEls.map(function(trEl) {
        var cells = Array.from(trEl.children).map(function(tdEl) {
          var isTh = tdEl.tagName.toUpperCase() === 'TH';
          var cRuns = collectRunsFromDomNode(tdEl, D, 26, { bold: isTh, italic: false, underline: false });
          return new D.TableCell({
            width: { size: colW, type: D.WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 },
            children: [new D.Paragraph({ alignment: isTh ? D.AlignmentType.CENTER : D.AlignmentType.LEFT, spacing: { before: 20, after: 20, line: 276 }, children: cRuns.length ? cRuns : [new D.TextRun({ text: '', font: 'Times New Roman', size: 26 })] })]
          });
        });
        return new D.TableRow({ children: cells });
      });
      blocks.push(new D.Table({ width: { size: 9355, type: D.WidthType.DXA }, columnWidths: colWidths, borders: dataBorders, rows: tRows }));
      blocks.push(new D.Paragraph({ spacing: { before: 60, after: 60 }, children: [] }));
    } else if (tag === 'UL' || tag === 'OL') {
      Array.from(node.querySelectorAll('li')).forEach(function(li, idx) { pushParagraphFromEl(li, tag === 'OL' ? ((idx + 1) + '. ') : '- '); });
    } else pushParagraphFromEl(node, '');
  });
  return blocks;
}

async function exportCurrentPaperToDocx() {
  var btn = el('btnExportDocxStub'), oldHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đúc Word...'; }
  try {
    var D = await ensureDocxLibraryLoaded();
    var tab = captureDOMIntoActiveTab(true);
    if (!tab) return;
    var docTypeObj = APP_CONFIG.docTypes.find(function(d) { return d.code === tab.docType; }) || APP_CONFIG.docTypes[0];
    var bodyHalfPt = (tab.fontSize === '13.5pt') ? 27 : 28;
    var B_NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    var NO_BORDERS = { top: B_NONE, bottom: B_NONE, left: B_NONE, right: B_NONE, insideHorizontal: B_NONE, insideVertical: B_NONE };
    var B_SOLID = { style: D.BorderStyle.SINGLE, size: 6, color: '000000' };
    var DATA_BORDERS = { top: B_SOLID, bottom: B_SOLID, left: B_SOLID, right: B_SOLID, insideHorizontal: B_SOLID, insideVertical: B_SOLID };

    var leftHeader = [
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 20, line: 260 }, children: [new D.TextRun({ text: (tab.orgLine1 || '').toUpperCase(), font: 'Times New Roman', size: 24 })] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 0, line: 260 }, children: [new D.TextRun({ text: (tab.orgLine2 || '').toUpperCase(), font: 'Times New Roman', size: 24, bold: true })] }),
      new D.Paragraph({ indent: { left: 1200, right: 1200 }, border: { bottom: B_SOLID }, spacing: { before: 20, after: 110, line: 40 }, children: [] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 40, after: 60 }, children: [new D.TextRun({ text: tab.docNumber || '', font: 'Times New Roman', size: 26 })] })
    ];
    if (docTypeObj.isCongVan && tab.cvSubject) leftHeader.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 30, after: 60, line: 260 }, children: [new D.TextRun({ text: tab.cvSubject, font: 'Times New Roman', size: 24 })] }));

    var rightHeader = [
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 20, line: 260 }, children: [new D.TextRun({ text: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', font: 'Times New Roman', size: 24, bold: true })] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 0, line: 260 }, children: [new D.TextRun({ text: 'Độc lập - Tự do - Hạnh phúc', font: 'Times New Roman', size: 27, bold: true })] }),
      new D.Paragraph({ indent: { left: 1080, right: 1080 }, border: { bottom: B_SOLID }, spacing: { before: 20, after: 110, line: 40 }, children: [] }),
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 40, after: 60 }, children: [new D.TextRun({ text: tab.dateLine || '', font: 'Times New Roman', size: 26, italics: true })] })
    ];

    var docChildren = [new D.Table({
      width: { size: 9355, type: D.WidthType.DXA }, columnWidths: [3930, 5425], borders: NO_BORDERS,
      rows: [new D.TableRow({ children: [new D.TableCell({ width: { size: 3930, type: D.WidthType.DXA }, children: leftHeader }), new D.TableCell({ width: { size: 5425, type: D.WidthType.DXA }, children: rightHeader })] })]
    })];

    if (!docTypeObj.isCongVan) {
      docChildren.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 200, after: 40 }, children: [new D.TextRun({ text: (tab.docTypeName || docTypeObj.name).toUpperCase(), font: 'Times New Roman', size: 28, bold: true })] }));
      docChildren.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 0, after: 10, line: 280 }, children: [new D.TextRun({ text: tab.namedSub || '', font: 'Times New Roman', size: 27, bold: true })] }));
      docChildren.push(new D.Paragraph({ indent: { left: 3200, right: 3200 }, border: { bottom: B_SOLID }, spacing: { before: 20, after: 180, line: 40 }, children: [] }));
    } else docChildren.push(new D.Paragraph({ spacing: { before: 120, after: 60 }, children: [] }));

    if (!el('a4DearLine').classList.contains('hidden') && (tab.dearLine || '').trim()) {
      docChildren.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 80, after: 160 }, children: [new D.TextRun({ text: tab.dearLine.trim(), font: 'Times New Roman', size: bodyHalfPt, bold: true })] }));
    }
    docChildren = docChildren.concat(convertHtmlBodyToDocxBlocks(el('a4BodyContent'), D, bodyHalfPt, DATA_BORDERS));

    var recLines = (tab.recipients || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var leftFooter = [new D.Paragraph({ spacing: { before: 80, after: 30 }, children: [new D.TextRun({ text: 'Nơi nhận:', font: 'Times New Roman', size: 24, bold: true, italics: true, underline: { type: D.UnderlineType.SINGLE } })] })];
    recLines.forEach(function(rl) { leftFooter.push(new D.Paragraph({ spacing: { after: 25, line: 250 }, children: [new D.TextRun({ text: rl, font: 'Times New Roman', size: 22 })] })); });

    var authLines = (tab.signerAuth || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean), rightFooter = [];
    authLines.forEach(function(al, idx) { rightFooter.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: idx === 0 ? 80 : 0, after: 20, line: 260 }, children: [new D.TextRun({ text: al.toUpperCase(), font: 'Times New Roman', size: bodyHalfPt, bold: true })] })); });
    rightFooter.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 1350, after: 60 }, children: [new D.TextRun({ text: tab.signerName || '[Họ và tên người ký]', font: 'Times New Roman', size: bodyHalfPt, bold: true })] }));

    docChildren.push(new D.Table({
      width: { size: 9355, type: D.WidthType.DXA }, columnWidths: [4210, 5145], borders: NO_BORDERS,
      rows: [new D.TableRow({ children: [new D.TableCell({ width: { size: 4210, type: D.WidthType.DXA }, children: leftFooter }), new D.TableCell({ width: { size: 5145, type: D.WidthType.DXA }, children: rightFooter })] })]
    }));

    var wordDoc = new D.Document({
      sections: [{
        properties: {
          titlePage: true,
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 850, bottom: 1134, left: 1701, header: 567 } }
        },
        headers: {
          first: new D.Header({ children: [new D.Paragraph({ children: [] })] }),
          default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], font: 'Times New Roman', size: bodyHalfPt })] })] })
        },
        children: docChildren
      }]
    });

    var blob = await D.Packer.toBlob(wordDoc);
    var dNow = new Date(), dTag = String(dNow.getDate()).padStart(2, '0') + String(dNow.getMonth() + 1).padStart(2, '0') + dNow.getFullYear();
    var outName = tab.docType + '_' + slugifyFileName(docTypeObj.isCongVan ? tab.cvSubject : tab.namedSub) + '_' + dTag + '.docx';
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = outName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch (err) { alert('Lỗi xuất Word: ' + err.message); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; } }
}

// [AI-07] BẮT DÍNH VỆT BÔI ĐEN TRÊN GIẤY A4 & ĐẤU NỐI MẪU LỆNH MẶC ĐỊNH
document.addEventListener('DOMContentLoaded', function() {
  if (APP_STATE.api && APP_STATE.api.key) ensureVerifiedLiveModels(APP_STATE.api.key, false);

  var origApply = window.applyActiveTabToDOM;
  if (typeof origApply === 'function') {
    window.applyActiveTabToDOM = function() {
      origApply();
      var cur = getActiveTab();
      if (cur) syncDearLineVisibility(cur.docType, ['KH', 'QD', 'TB'].indexOf(cur.docType) !== -1 ? '' : cur.dearLine);
      renderChatHistoryForActiveTab();
      var hasHist = Boolean(cur && cur.chatHistory && cur.chatHistory.length > 0);
      el('chkDeltaMode').checked = hasHist;
      if (!hasHist && typeof setDefaultQuickPromptInInput === 'function') setDefaultQuickPromptInInput();
    };
    window.applyActiveTabToDOM();
  }

  document.addEventListener('selectionchange', function() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var txt = sel.toString().trim();
    var paper = el('a4Paper');
    if (txt.length >= 2 && paper && paper.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      AI_RUNTIME.savedRange = sel.getRangeAt(0).cloneRange();
      AI_RUNTIME.savedSelectedText = txt;
    }
  });

  el('btnOpenSelectionAi').addEventListener('mousedown', function(e) { e.preventDefault(); });
  el('btnOpenSelectionAi').addEventListener('click', function() {
    var sel = window.getSelection();
    var liveTxt = (sel && sel.rangeCount && el('a4Paper').contains(sel.getRangeAt(0).commonAncestorContainer)) ? sel.toString().trim() : '';
    if (liveTxt.length >= 2) {
      AI_RUNTIME.savedRange = sel.getRangeAt(0).cloneRange();
      AI_RUNTIME.savedSelectedText = liveTxt;
    }
    if (!AI_RUNTIME.savedRange || !AI_RUNTIME.savedSelectedText) {
      return alert('Hãy quét chuột bôi đen câu/đoạn chữ trên tờ giấy A4 trước rồi bấm nút này nhé!');
    }
    var t = AI_RUNTIME.savedSelectedText;
    el('selectionPreviewTxt').textContent = '"' + (t.length > 45 ? t.substring(0, 45) + '...' : t) + '"';
    el('selectionAiBar').classList.replace('hidden', 'flex');
    el('selectionCustomPrompt').focus();
  });

  el('btnRunSelectionAi').addEventListener('click', executeSelectionRewrite);
  el('selectionCustomPrompt').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); executeSelectionRewrite(); } });
  el('btnCloseSelectionAi').addEventListener('click', function() { el('selectionAiBar').classList.replace('flex', 'hidden'); });

  el('btnPickTaskFiles').addEventListener('click', function() { el('taskFilesInput').click(); });
  el('taskFilesInput').addEventListener('change', function(e) {
    Array.from(e.target.files || []).forEach(function(f) {
      AI_RUNTIME.taskFiles.push({ name: f.name, file: f, loaded: false, loading: false, extractedText: '', inlineParts: [], isVision: false, badge: 'Đang đọc...', sendOnce: false });
    });
    renderTaskFilesList(); el('chkDeltaMode').checked = false; prepareAddedTaskFiles(); e.target.value = '';
  });

  el('btnAutoFilterCabinet').addEventListener('click', autoFilterCabinetByTopic);
  el('btnRunAi').addEventListener('click', executeMainAiDrafting);
  el('btnCancelAi').addEventListener('click', function() { AI_RUNTIME.userCancelled = true; if (AI_RUNTIME.abortCtrl) AI_RUNTIME.abortCtrl.abort(); });
  el('aiPromptInput').addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); executeMainAiDrafting(); } });

  document.querySelectorAll('.quick-prompt-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.quick-prompt-btn').forEach(function(b) {
        b.className = 'quick-prompt-btn h-10 bg-white hover:bg-purple-50 border border-slate-300 text-slate-700 font-medium text-[10.5px] leading-tight rounded-md flex items-center justify-center text-center px-1 transition';
      });
      btn.className = 'quick-prompt-btn h-10 bg-purple-100 border border-purple-400 text-purple-900 font-semibold text-[10.5px] leading-tight rounded-md flex items-center justify-center text-center px-1 transition';
      el('aiPromptInput').value = btn.getAttribute('data-quick');
      el('aiPromptInput').focus();
    });
  });
  el('btnExportDocxStub').addEventListener('click', exportCurrentPaperToDocx);
});