// Catalog 5 sản phẩm Doscom - dùng cho prompt AI generate ad copy
// Đồng bộ với skill doscom-products

export const PRODUCTS = {
  "D1": {
    name: "Máy dò D1",
    fullName: "Máy dò thiết bị nghe lén D1",
    priceRange: "2.500.000đ",
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
    priceRange: "1.300.000đ",
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
    priceRange: "199.000đ / chai 200ml",
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
    fullName: "Camera an ninh video call 2 chiều DA8.1",
    priceRange: "1.250.000đ",
    category: "Camera an ninh gia đình kiêm video call",
    usps: [
      "Camera an ninh đầu tiên có video call 2 chiều chỉ bằng 1 nút bấm vật lý – người ở nhà không cần smartphone",
      "Màn hình IPS 2.8 inch mặt camera – ông bà/trẻ nhỏ thấy mặt người gọi",
      "Full HD 1080P + hồng ngoại ban đêm 10m",
      "Góc xoay 350° ngang + 60° dọc – bao quát cả phòng",
      "Phát hiện chuyển động, cảnh báo qua app IM Cam tiếng Việt",
      "Hỗ trợ thẻ nhớ đến 128GB – lưu ~14 ngày video ghi đè tự động",
    ],
    painPoints: [
      "Ba mẹ đi làm lo con nhỏ ở nhà một mình, con cần nhưng không gọi được",
      "Ông bà lớn tuổi ở quê không dùng smartphone, khó video call với con cháu",
      "Gia đình có thú cưng, muốn xem chúng ở nhà khi đi vắng",
      "Camera an ninh thông thường chỉ xem một chiều, không liên lạc 2 chiều được",
    ],
    targetAudience: "Ba mẹ đi làm có con nhỏ ở nhà, gia đình có ông bà lớn tuổi, người thuê nhà có thú cưng, gia đình nhiều thế hệ sống cách xa",
    tonePreferred: "Ấm áp, gần gũi, tập trung vào kết nối gia đình và yên tâm hàng ngày",
    avoidWords: [
      "giám sát lén", "theo dõi bí mật", "rình",
    ],
    fbPolicyNotes: "Tập trung vào kết nối gia đình + an toàn cho người thân. KHÔNG ám chỉ theo dõi/giám sát lén người khác.",
    provenAngles: [
      "CAMERA CẦN THIẾT CHO GIA ĐÌNH CÓ NGƯỜI GIÀ VÀ TRẺ NHỎ — camera vừa là thiết bị an ninh vừa là 'đường dây nóng' để ông bà/trẻ nhỏ ở nhà liên lạc với con cháu đi làm xa, chỉ bằng 1 nút bấm không cần smartphone. (Angle đã thành công 2025)",
      "CON Ở NHÀ MỘT MÌNH – BẠN ĐANG XEM ĐƯỢC GÌ — nhấn mạnh camera thường chỉ xem 1 chiều, DA8.1 cho phép con chủ động bấm nút gọi mẹ. (Angle đã thành công 2025)",
    ],
  },

  "DA8.1 Pro": {
    name: "Camera DA8.1 Pro",
    fullName: "Camera an ninh video call 2 chiều DA8.1 Pro (bản nâng cấp)",
    priceRange: "1.550.000đ",
    category: "Camera an ninh gia đình kiêm video call - bản cao cấp",
    usps: [
      "Tất cả tính năng DA8.1 + nâng cấp chất lượng hình + pin dự phòng",
      "Camera 2K (2560x1440) – sắc nét gấp 1.7 lần bản 1080P",
      "Màn hình 4 inch – lớn hơn 40% so với bản thường, người lớn tuổi dễ nhìn mặt người gọi",
      "WiFi dual-band 2.4GHz + 5GHz – video call không giật khi mạng đông thiết bị",
      "AI phân biệt người / thú cưng – giảm báo giả tới 70%",
      "Pin dự phòng 4000mAh – hoạt động 8 giờ khi mất điện",
      "Loa 2W (gấp đôi bản thường) – tiếng to rõ trong phòng rộng",
    ],
    painPoints: [
      "Gia đình có ông bà lớn tuổi cần màn hình lớn, hình nét để nhìn mặt con cháu",
      "Nhà hay mất điện đột xuất, camera thường tắt theo khiến mất giám sát",
      "Camera thường báo giả liên tục khi thú cưng di chuyển, phiền",
      "Nhiều thiết bị WiFi trong nhà gây giật video call chất lượng cao",
    ],
    targetAudience: "Gia đình thu nhập khá có nhiều thế hệ, doanh nhân hay công tác, người mua biếu ba mẹ ở quê, gia đình có ông bà 60+",
    tonePreferred: "Ấm áp + chất lượng cao, nhấn mạnh 'đáng tiền nâng cấp' cho gia đình quan trọng",
    avoidWords: [
      "giám sát lén", "theo dõi bí mật", "rình",
    ],
    fbPolicyNotes: "Tập trung vào kết nối gia đình + chất lượng cao cho ông bà. KHÔNG ám chỉ theo dõi/giám sát lén.",
    provenAngles: [
      "CAMERA CẦN THIẾT CHO GIA ĐÌNH CÓ NGƯỜI GIÀ VÀ TRẺ NHỎ — bản Pro có màn 4 inch to hơn giúp ông bà lớn tuổi dễ nhìn mặt con cháu khi video call, pin dự phòng 8h giữ kết nối cả khi mất điện. (Angle đã thành công 2025)",
      "QUÀ BIẾU BA MẸ Ở QUÊ — DA8.1 Pro như món quà thiết thực cho ba mẹ không dùng smartphone mà vẫn video call được với con cháu ở xa. (Angle đã thành công 2025)",
    ],
  },
};

export function getProduct(key) {
  return PRODUCTS[key] || null;
}
