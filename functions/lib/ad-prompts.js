// Template prompt gửi Gemini để sinh content ads
// Nếu muốn chỉnh style / brand voice — sửa file này, push là có hiệu lực

export const SYSTEM_PROMPT = `Bạn là copywriter chuyên viết quảng cáo Facebook Ads tiếng Việt cho Doscom — công ty chuyên phân phối thiết bị công nghệ (an ninh, ghi âm, chăm sóc xe, camera hội nghị).

PHONG CÁCH VIẾT (bắt buộc):
- Câu mở đầu phải GIẬT: dùng câu hỏi tu từ, con số shock, hoặc tình huống đồng cảm.
- Triển khai USP theo công thức: Tính năng → Lợi ích cụ thể → Bằng chứng/so sánh.
- CTA cuối phải CỤ THỂ (VD: "Nhắn tin ngay để được tư vấn miễn phí", "Inbox để nhận báo giá chi tiết").
- Dùng emoji hợp lý (1-3 emoji/đoạn, không lạm dụng).
- Viết như đang nói chuyện với 1 người, không sáo rỗng.
- Xuống dòng tự nhiên, đoạn ngắn 1-3 dòng.

RÀNG BUỘC FACEBOOK POLICY (KHÔNG ĐƯỢC VI PHẠM):
- KHÔNG dùng "bạn" ở ngôi thứ 2 trực tiếp tấn công ("Bạn bị béo?"). Thay bằng "nhiều người", "các anh/chị", "chủ xe", v.v.
- KHÔNG khẳng định thuộc tính cá nhân của reader.
- KHÔNG cam kết 100%, dùng "hiệu quả lên đến", "nhiều khách hàng".
- KHÔNG click-bait quá đà ("99% ai cũng cần...", "Ai không biết sẽ hối hận").
- KHÔNG nói chủ đề y tế, giảm cân nhanh, chữa bệnh.
- TRÁNH các từ người dùng dặn riêng cho từng sản phẩm (xem avoidWords).

RÀNG BUỘC ĐỘ DÀI (nghiêm ngặt):
- headline: ≤ 40 ký tự (tiếng Việt tính cả dấu)
- primary_text: 300-800 ký tự (sweet spot 450)
- video_title: ≤ 100 ký tự
- description: ≤ 30 ký tự

OUTPUT: JSON đúng schema, KHÔNG kèm markdown, KHÔNG kèm giải thích ngoài JSON.`;

/**
 * Build user prompt dynamically theo sản phẩm + format campaign + context
 */
export function buildUserPrompt({ product, format, formatLabel, cta, notes }) {
  const avoidSection = product.avoidWords.length > 0
    ? `\nTỪ CẤM KHÔNG ĐƯỢC DÙNG cho sản phẩm này: ${product.avoidWords.join(", ")}`
    : "";

  return `SẢN PHẨM: ${product.fullName}
DANH MỤC: ${product.category}
TẦM GIÁ: ${product.priceRange}

ĐIỂM KHÁC BIỆT (USP):
${product.usps.map((u, i) => `${i + 1}. ${u}`).join("\n")}

PAIN POINT KHÁCH HÀNG:
${product.painPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

ĐỐI TƯỢNG MỤC TIÊU: ${product.targetAudience}
TONE PHÙ HỢP: ${product.tonePreferred}
LƯU Ý POLICY CHO SP NÀY: ${product.fbPolicyNotes}${avoidSection}

CAMPAIGN FORMAT: ${formatLabel}
CTA BUTTON: ${cta}
${notes ? `GHI CHÚ THÊM CỦA NGƯỜI DÙNG: ${notes}\n` : ""}
YÊU CẦU: Viết 3 variants content khác STYLE rõ rệt:
- Variant A (EMOTIONAL): đánh vào cảm xúc, nỗi lo, khát khao của người dùng. Kể chuyện, tạo đồng cảm.
- Variant B (RATIONAL): tập trung tính năng, thông số, so sánh, tiết kiệm chi phí. Giọng chuyên gia.
- Variant C (URGENCY): tạo khan hiếm, thời hạn, giảm giá có điều kiện. Giọng khẩn cấp nhưng không spam.

Mỗi variant gồm 4 trường: headline, primary_text, video_title, description.

Trả về JSON đúng schema:
{
  "variants": [
    {
      "id": "A",
      "style": "Emotional",
      "headline": "...",
      "primary_text": "...",
      "video_title": "...",
      "description": "..."
    },
    { "id": "B", "style": "Rational", ... },
    { "id": "C", "style": "Urgency", ... }
  ]
}`;
}

/**
 * JSON schema để Gemini trả structured output
 */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          style: { type: "string" },
          headline: { type: "string" },
          primary_text: { type: "string" },
          video_title: { type: "string" },
          description: { type: "string" },
        },
        required: ["id", "style", "headline", "primary_text", "video_title", "description"],
      },
    },
  },
  required: ["variants"],
};
