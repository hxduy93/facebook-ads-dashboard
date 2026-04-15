// Catalog 5 sản phẩm Doscom - dùng cho prompt AI generate ad copy
// Đồng bộ với skill doscom-products

export const PRODUCTS = {
  "D1": {
    name: "Máy dò D1",
    fullName: "Máy dò thiết bị nghe lén D1",
    priceRange: "2.5 - 4 triệu",
    category: "An ninh - bảo mật",
    usps: [
      "Phát hiện camera ẩn, thiết bị nghe lén, GPS trộm",
      "Công nghệ quét đa tần số RF + từ trường + hồng ngoại",
      "Nhỏ gọn, cầm tay, pin 8 tiếng",
      "Dùng được ở khách sạn, homestay, xe hơi, văn phòng",
    ],
    painPoints: [
      "Lo lắng bị quay lén khi đi công tác, du lịch",
      "Sợ bị theo dõi trong xe hoặc nhà riêng",
      "Doanh nhân lo rò rỉ thông tin trong phòng họp",
    ],
    targetAudience: "Doanh nhân, người hay công tác, du lịch, gia đình thành thị",
    tonePreferred: "Nghiêm túc, tạo cảm giác an toàn, không hù dọa thái quá",
    avoidWords: [
      "theo dõi vợ", "theo dõi chồng", "rình", "gián điệp",
      "bí mật cá nhân của người khác",
    ],
    fbPolicyNotes: "Không được ám chỉ xâm phạm quyền riêng tư người khác. Tập trung vào 'bảo vệ bản thân'.",
  },

  "DR1": {
    name: "Máy ghi âm DR1",
    fullName: "Máy ghi âm siêu nhỏ DR1",
    priceRange: "1.5 - 2.5 triệu",
    category: "Thiết bị ghi âm chuyên dụng",
    usps: [
      "Ghi âm liên tục 30 giờ, dung lượng 16-32GB",
      "Kích thước siêu nhỏ (như chiếc USB)",
      "Chất lượng âm thanh HD, lọc tiếng ồn",
      "Kích hoạt bằng giọng nói (voice-activated)",
      "Kết nối máy tính không cần app",
    ],
    painPoints: [
      "Cần lưu lại cuộc họp quan trọng",
      "Phóng viên, nhà báo cần tác nghiệp",
      "Luật sư cần ghi lại trao đổi với khách hàng",
      "Sinh viên cần ghi lại bài giảng dài",
    ],
    targetAudience: "Phóng viên, luật sư, doanh nhân, sinh viên cao học, người cần tác nghiệp",
    tonePreferred: "Chuyên nghiệp, nhấn mạnh tính tiện dụng và bảo mật",
    avoidWords: [
      "ghi âm lén", "nghe lén", "rình",
    ],
    fbPolicyNotes: "Phải nêu mục đích hợp pháp (tác nghiệp, ghi nhớ). Không được ám chỉ ghi âm bí mật người khác.",
  },

  "Noma 911": {
    name: "Noma 911",
    fullName: "Dung dịch tẩy ố kính Noma 911",
    priceRange: "300 - 500k / chai",
    category: "Chăm sóc ô tô",
    usps: [
      "Tẩy sạch ố kính ô tô do mưa axit, nước cứng chỉ sau 5 phút",
      "Công thức đậm đặc, không gây xước kính",
      "An toàn với viền cao su, không ăn mòn",
      "1 chai dùng được cho 4-5 xe",
      "Được các gara, detailing chuyên nghiệp tin dùng",
    ],
    painPoints: [
      "Kính xe bị mờ ố do mưa axit, khó lau sạch",
      "Lái xe trời mưa bị chói, nguy hiểm",
      "Các dung dịch rẻ tiền thường gây xước kính",
      "Ra gara tẩy kính tốn 500k-1tr/lần",
    ],
    targetAudience: "Chủ xe hơi cá nhân nam 30-55 tuổi, gara rửa xe, detailing shop",
    tonePreferred: "Thực tế, có dẫn chứng hình ảnh before/after, giọng thợ lành nghề",
    avoidWords: [],
    fbPolicyNotes: "Tránh khẳng định tuyệt đối ('tẩy sạch 100%'). Dùng 'hiệu quả lên đến'.",
  },

  "DA8.1": {
    name: "Camera DA8.1",
    fullName: "Camera video call thông minh DA8.1",
    priceRange: "3.5 - 5 triệu",
    category: "Thiết bị hội nghị - video call",
    usps: [
      "Camera 4K, góc rộng 120°, auto zoom người nói",
      "Mic thu âm 360°, khử ồn AI",
      "Kết nối USB-C cắm là dùng, không cần driver",
      "Tương thích Zoom, Google Meet, Teams, Skype",
      "Tự động theo dõi người nói khi di chuyển",
    ],
    painPoints: [
      "Webcam laptop mờ, thiếu sáng, trông thiếu chuyên nghiệp",
      "Họp đội nhóm không thu được hết tiếng trong phòng",
      "Cần 1 thiết bị cho phòng họp nhỏ 4-8 người",
    ],
    targetAudience: "Doanh nghiệp SME, team nhỏ làm việc hybrid, phòng họp nhỏ",
    tonePreferred: "Chuyên nghiệp, tập trung giá trị công việc, before/after",
    avoidWords: [],
    fbPolicyNotes: "OK, không ràng buộc đặc biệt.",
  },

  "DA8.1 Pro": {
    name: "Camera DA8.1 Pro",
    fullName: "Camera hội nghị cao cấp DA8.1 Pro",
    priceRange: "6 - 9 triệu",
    category: "Thiết bị hội nghị cao cấp",
    usps: [
      "Tất cả tính năng DA8.1 + camera PTZ (Pan/Tilt/Zoom 10x)",
      "Mic array 8 hướng, bắt tiếng rõ 6m",
      "AI framing tự chia khung hình khi nhiều người nói",
      "Điều khiển từ xa, app mobile",
      "Phù hợp phòng họp trung 10-20 người",
    ],
    painPoints: [
      "Phòng họp lớn, webcam thường không bao quát được",
      "Cần chất lượng cho họp với khách hàng quan trọng",
      "Setup giải pháp chuyên nghiệp mà không tốn 30-50 triệu như hệ thống cũ",
    ],
    targetAudience: "Doanh nghiệp vừa-lớn, phòng họp boardroom, CEO, sales manager",
    tonePreferred: "Cao cấp, đẳng cấp doanh nghiệp, không cần hù dọa",
    avoidWords: [],
    fbPolicyNotes: "OK.",
  },
};

export function getProduct(key) {
  return PRODUCTS[key] || null;
}
