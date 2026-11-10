// [CFG-01] CẤU HÌNH ĐƠN VỊ, LINK TRẠM GÁC ẨN KEY & CHỮ KÝ KT. MẶC ĐỊNH
window.APP_CONFIG = {
  version: '1.3.0 - Official',
  proxyWebAppUrl: 'https://script.google.com/macros/s/AKfycby-KJwjASF4BhxLHwSjLq7RGykxOu6XZmqbxbi_fRqmCF-RZ4eSyDKGTJ4QNfkzx69eqw/exec',
  defaultPrompt: 'Hãy tham mưu soạn thảo đầy đủ văn bản từ tài liệu đề bài và hồ sơ đính kèm, đúng thể thức Nghị định 30.',

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

  // [CFG-02] DANH SÁCH MODEL AI CHO KEY CÁ NHÂN
  defaultModels: [
    { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash (Chủ lực - Khuyên dùng khi có Key riêng)' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Ổn định - Miễn phí)' },
    { id: 'gemma-3-27b-it', label: 'gemma-3-27b-it (Phao cứu sinh bể Quota riêng)' }
  ],

  // [CFG-03] HAI HỆ QUY CHIẾU THAM MƯU CHÍNH
  roles: [
    {
      id: 'ubnd',
      shortName: '1. Tham mưu UBND Phường',
      icon: 'fa-solid fa-landmark',
      orgMode: 'ubnd',
      defaultRecipients: '- Như trên (hoặc Như Phần IV);\n- TT. Đảng ủy - HĐND Phường (để b/c);\n- CT, các PCT UBND Phường;\n- Ban Điều hành 24 Khu phố;\n- Lưu: VT, VHXH.',
      toneDesc: 'Đứng vai UBND Phường Phú Nhuận: Nếu văn bản triển khai xuống địa bàn (Kế hoạch, Quyết định, Công văn chỉ đạo) thì dùng giọng điều hành, giao việc 5 rõ cho các đơn vị và 24 Khu phố; nếu gửi Thành phố/Sở ngành (Báo cáo, Công văn kiến nghị) thì dùng giọng báo cáo chuẩn mực (kết quả, khó khăn, kiến nghị).'
    },
    {
      id: 'dept',
      shortName: '2. Tham mưu Lãnh đạo Phòng',
      icon: 'fa-solid fa-user-tie',
      orgMode: 'dept',
      defaultRecipients: '- Như trên;\n- Trưởng phòng, các PTP VH-XH;\n- Lưu: VT, VHXH.',
      toneDesc: 'Đứng vai Phòng Văn hóa - Xã hội: Tham mưu Tờ trình, Báo cáo đề xuất kính trình UBND Phường / Lãnh đạo UBND Phường xem xét chỉ đạo hoặc văn bản điều hành nghiệp vụ của Phòng.'
    }
  ],

  // [CFG-04] DANH MỤC LOẠI VĂN BẢN NGHỊ ĐỊNH 30
  docTypes: [
    { code: 'CV', name: 'Công văn', suffixDept: 'VHXH', suffixUbnd: 'UBND-VHXH', isCongVan: true },
    { code: 'TTr', name: 'Tờ trình', suffixDept: 'TTr-VHXH', suffixUbnd: 'TTr-UBND', isCongVan: false },
    { code: 'KH', name: 'Kế hoạch', suffixDept: 'KH-VHXH', suffixUbnd: 'KH-UBND', isCongVan: false },
    { code: 'BC', name: 'Báo cáo', suffixDept: 'BC-VHXH', suffixUbnd: 'BC-UBND', isCongVan: false },
    { code: 'QD', name: 'Quyết định', suffixDept: 'QĐ-VHXH', suffixUbnd: 'QĐ-UBND', isCongVan: false },
    { code: 'TB', name: 'Thông báo', suffixDept: 'TB-VHXH', suffixUbnd: 'TB-UBND', isCongVan: false }
  ]
};