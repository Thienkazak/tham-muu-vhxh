// [CFG-01] CẤU HÌNH ĐƠN VỊ, TRẠM GÁC ẨN KEY & CHẾ ĐỘ BẢO MẬT CÁ NHÂN TRÊN PC
window.APP_CONFIG = {
  version: '2.1.0 - PC Pro Edition',
  proxyWebAppUrl: 'https://script.google.com/macros/s/AKfycby-KJwjASF4BhxLHwSjLq7RGykxOu6XZmqbxbi_fRqmCF-RZ4eSyDKGTJ4QNfkzx69eqw/exec',
  defaultPrompt: 'Hãy tham mưu soạn thảo đầy đủ văn bản từ tài liệu đề bài và hồ sơ đính kèm, tuân thủ nghiêm ngặt thể thức Phụ lục I Nghị định 30/2020/NĐ-CP.',

  // Giới hạn lượt trải nghiệm Mã nội bộ trên mỗi PC để khuyến khích đồng nghiệp tự tạo API Key riêng (tiết kiệm Quota chủ phòng)
  internalPinTrialLimit: 5,
  internalPinEmergencyBonusPerDay: 2,

  defaultOrg: {
    govParent: 'UBND PHƯỜNG PHÚ NHUẬN',
    deptName: 'PHÒNG VĂN HÓA - XÃ HỘI',
    ubndLine1: 'ỦY BAN NHÂN DÂN',
    ubndLine2: 'PHƯỜNG PHÚ NHUẬN',
    locationName: 'Phú Nhuận',
    deptSignerTitle: 'KT. TRƯỞNG PHÒNG\nPHÓ TRƯỞNG PHÒNG',
    deptSignerName: '[Họ và tên người ký]',
    ubndSignerTitle: 'TM. ỦY BAN NHÂN DÂN\nKT. CHỦ TỊCH\nPHÓ CHỦ TỊCH',
    ubndSignerName: '[Họ và tên người ký]',
    folderRuleDays: 15,
    folderRuleMaxFiles: 10,
    pinPrefix: '[GHIM]',
    draftSubfolder: '_CONG_VIEC_DANG_SOAN',
    localFacts: '- Đơn vị hành chính: Phường Phú Nhuận trực thuộc Thành phố Hồ Chí Minh (chính quyền địa phương 2 cấp, không còn cấp Quận).\n'
      + '- Quy mô khu phố: Phường Phú Nhuận hiện có 24 Khu phố (từ Khu phố 1 đến Khu phố 24). Khi phân công hoặc gửi khu phố phải ghi chính xác "24 Khu phố" (Trưởng 24 Khu phố / Ban Điều hành 24 Khu phố), tuyệt đối không ghi 13 Khu phố.\n'
      + '- Các cơ quan, đơn vị tại Phường: Thường trực Đảng ủy, Thường trực HĐND Phường; UBND Phường; Ủy ban MTTQ Việt Nam và các tổ chức chính trị - xã hội Phường (Đoàn Thanh niên, Hội LHPN, Hội Cựu chiến binh, Công đoàn); các cơ quan chuyên môn thuộc UBND Phường gồm: Văn phòng HĐND và UBND, Phòng Kinh tế, Hạ tầng và Đô thị, Phòng Văn hóa - Xã hội, Trung tâm Phục vụ hành chính công; Công an Phường, Ban Chỉ huy Quân sự Phường, Trạm Y tế Phường.'
  },

  // [CFG-02] DANH SÁCH MODEL KHỞI TẠO AN TOÀN (TỰ ĐỘNG CẬP NHẬT MODEL MỚI KHI CÓ KEY RIÊNG)
  defaultModels: [
    { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash (Chủ lực mới nhất - Khuyên dùng)' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Ổn định & Nhanh)' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite (Siêu tốc - Tiết kiệm Quota)' },
    { id: 'gemma-3-27b-it', label: 'gemma-3-27b-it (Phao cứu sinh khi hết Quota Gemini)' }
  ],

  // [CFG-03] CÁC MẪU CHỨC DANH KÝ CHUẨN NGHỊ ĐỊNH 30 (CHỌN NHANH 1 CHẠM TRÊN PC)
  signerPresets: {
    ubnd: [
      { id: 'ubnd_kt_pct', label: 'TM. UBND - KT. Chủ tịch (Phó Chủ tịch ký)', text: 'TM. ỦY BAN NHÂN DÂN\nKT. CHỦ TỊCH\nPHÓ CHỦ TỊCH' },
      { id: 'ubnd_ct', label: 'TM. UBND - Chủ tịch ký trực tiếp', text: 'TM. ỦY BAN NHÂN DÂN\nCHỦ TỊCH' },
      { id: 'ct_kt_pct', label: 'KT. Chủ tịch - Phó Chủ tịch (Thẩm quyền riêng CT)', text: 'KT. CHỦ TỊCH\nPHÓ CHỦ TỊCH' },
      { id: 'ct_direct', label: 'Chủ tịch UBND ký trực tiếp (Thẩm quyền riêng CT)', text: 'CHỦ TỊCH' },
      { id: 'tl_cvp', label: 'TL. Chủ tịch - Chánh Văn phòng (Giấy mời / TB)', text: 'TL. CHỦ TỊCH\nCHÁNH VĂN PHÒNG' }
    ],
    dept: [
      { id: 'dept_kt_ptp', label: 'KT. Trưởng phòng - Phó Trưởng phòng ký', text: 'KT. TRƯỞNG PHÒNG\nPHÓ TRƯỞNG PHÒNG' },
      { id: 'dept_tp', label: 'Trưởng phòng ký trực tiếp', text: 'TRƯỞNG PHÒNG' }
    ]
  },

  // [CFG-04] HAI HỆ QUY CHIẾU THAM MƯU CHÍNH
  roles: [
    {
      id: 'ubnd',
      shortName: 'Tham mưu UBND Phường',
      line1: 'Tham mưu',
      line2: 'UBND Phường',
      icon: 'fa-solid fa-landmark',
      orgMode: 'ubnd',
      defaultRecipients: '- Như trên;\n- TT. Đảng ủy, TT. HĐND Phường (để b/c);\n- CT, các PCT UBND Phường;\n- Ủy ban MTTQ và các đoàn thể Phường;\n- Ban Điều hành 24 Khu phố;\n- Lưu: VT, VHXH.',
      toneDesc: 'Đứng vai UBND Phường Phú Nhuận: Nếu văn bản triển khai xuống địa bàn (Kế hoạch, Quyết định, Công văn chỉ đạo, Thông báo, Giấy mời) thì dùng giọng điều hành, phân công rõ người - rõ việc - rõ phối hợp - rõ sản phẩm - rõ thời hạn cho các đơn vị và 24 Khu phố; nếu gửi Thành phố/Sở ngành/Đảng ủy (Báo cáo, Tờ trình, Công văn kiến nghị) thì dùng giọng báo cáo chuẩn mực (kết quả, hạn chế, nguyên nhân, kiến nghị).'
    },
    {
      id: 'dept',
      shortName: 'Tham mưu Lãnh đạo Phòng',
      line1: 'Tham mưu',
      line2: 'Lãnh đạo Phòng',
      icon: 'fa-solid fa-user-tie',
      orgMode: 'dept',
      defaultRecipients: '- Như trên;\n- Trưởng phòng, các PTP VH-XH;\n- Lưu: VT, VHXH.',
      toneDesc: 'Đứng vai Phòng Văn hóa - Xã hội: Tham mưu Tờ trình, Báo cáo đề xuất kính trình UBND Phường / Lãnh đạo UBND Phường xem xét chỉ đạo, hoặc ban hành văn bản điều hành nghiệp vụ chuyên môn của Phòng.'
    }
  ],

  // [CFG-05] DANH MỤC LOẠI VĂN BẢN NGHỊ ĐỊNH 30 (ĐẦY ĐỦ CHO TÁC NGHIỆP VH-XH)
  // hasVeViec: true -> gợi ý "Về việc ...", false -> viết thẳng tên Kế hoạch / Báo cáo / Chương trình
  // dearPolicy: 'none' (không có Kính gửi), 'upward' (gửi cấp trên khi đứng vai UBND), 'flexible' (linh hoạt theo ngữ cảnh)
  docTypes: [
    { code: 'KH', name: 'Kế hoạch', suffixDept: 'KH-VHXH', suffixUbnd: 'KH-UBND', isCongVan: false, hasVeViec: false, dearPolicy: 'none' },
    { code: 'CV', name: 'Công văn', suffixDept: 'VHXH', suffixUbnd: 'UBND-VHXH', isCongVan: true, hasVeViec: true, dearPolicy: 'flexible' },
    { code: 'TTr', name: 'Tờ trình', suffixDept: 'TTr-VHXH', suffixUbnd: 'TTr-UBND', isCongVan: false, hasVeViec: true, dearPolicy: 'upward' },
    { code: 'BC', name: 'Báo cáo', suffixDept: 'BC-VHXH', suffixUbnd: 'BC-UBND', isCongVan: false, hasVeViec: false, dearPolicy: 'upward' },
    { code: 'QD', name: 'Quyết định', suffixDept: 'QĐ-VHXH', suffixUbnd: 'QĐ-UBND', isCongVan: false, hasVeViec: true, dearPolicy: 'none' },
    { code: 'TB', name: 'Thông báo', suffixDept: 'TB-VHXH', suffixUbnd: 'TB-UBND', isCongVan: false, hasVeViec: true, dearPolicy: 'none' },
    { code: 'GM', name: 'Giấy mời', suffixDept: 'GM-VHXH', suffixUbnd: 'GM-UBND', isCongVan: false, hasVeViec: true, dearPolicy: 'flexible' },
    { code: 'CTr', name: 'Chương trình', suffixDept: 'CTr-VHXH', suffixUbnd: 'CTr-UBND', isCongVan: false, hasVeViec: false, dearPolicy: 'none' },
    { code: 'BB', name: 'Biên bản', suffixDept: 'BB-VHXH', suffixUbnd: 'BB-UBND', isCongVan: false, hasVeViec: false, dearPolicy: 'none' }
  ],

  // [CFG-06] THƯ VIỆN NẠP LƯỜI (LAZY-LOAD) TĂNG TỐC MỞ TRANG TỨC THÌ TRÊN PC
  cdnLibs: {
    mammoth: [
      'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
      'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
    ],
    xlsx: [
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    ],
    pdfMain: [
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    ],
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    docx: [
      'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
      'https://unpkg.com/docx@8.5.0/build/index.umd.js'
    ]
  }
};
