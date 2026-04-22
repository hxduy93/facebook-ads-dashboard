---
name: workflow-discipline
description: Buộc Claude re-load toàn bộ yêu cầu của user từ đầu cuộc trò chuyện, verify từng cái đã làm chưa TRƯỚC KHI commit code/push lên git/return kết quả cuối cùng cho user. BẮT BUỘC dùng khi Claude chuẩn bị gõ "git commit", "git push", "đã xong", "hoàn tất", "done", "finished", "completed", khi kết thúc task build dashboard/agent/automation, khi chuẩn bị gửi file cuối cùng qua computer:// link, hoặc khi user nói "commit đi", "push lên", "xong chưa". Cũng BẮT BUỘC dùng khi user phàn nàn "bạn bỏ qua yêu cầu của tôi", "chưa làm cái này", "tại sao cái kia không có". KHÔNG dùng cho câu hỏi factual đơn giản, trò chuyện thông thường, task nhỏ dưới 3 bước, hoặc khi user chỉ hỏi thông tin không yêu cầu build/deliver gì.
---

# Workflow Discipline — Re-check Requirements Before Commit

> **"Hôm qua bạn bỏ qua rất nhiều yêu cầu của tôi."** — Dos, 22/04/2026
>
> Skill này ra đời để điều đó KHÔNG LẶP LẠI.

## Mục đích

Mỗi khi Claude chuẩn bị **commit code**, **push lên git**, hoặc **return kết quả cuối cùng** cho user, bắt buộc chạy checklist 4 bước dưới đây. Không được bỏ qua.

## 4 BƯỚC BẮT BUỘC TRƯỚC KHI COMMIT/PUSH/DELIVER

### Bước 1 — Scroll ngược lại toàn bộ conversation, list yêu cầu

Đọc lại **từ đầu conversation đến giờ**, liệt kê RA GIẤY (trong response hoặc thinking block):

- Mọi câu user bắt đầu bằng: "làm cho tôi...", "tôi muốn...", "phải có...", "cần...", "thêm...", "sửa...", "fix...", "đổi..."
- Mọi số cụ thể user đưa ra: số cột, số hàng, số ngày, %, số tiền, số SP
- Mọi **tên cụ thể**: tên field, tên cột, tên tab, tên sản phẩm, mã SKU
- Mọi **behavior** user mô tả: "khi click vào X thì Y", "khi filter thì bảng phải nhảy theo", "lúc nào cũng phải hiện Z"
- Mọi **lỗi user đã chỉ ra trước đó**: "cái này sai rồi", "tại sao không work", "bạn làm ngược"

### Bước 2 — Đối chiếu TỪNG requirement với output thực tế

Với mỗi R trong checklist:

- Mở file/artifact đã sửa, verify bằng mắt requirement đó có được implement chưa
- Nếu là số/text cụ thể, grep/search trong file để confirm
- Nếu là behavior, mental-test: "user click X thì code có chạy Y không?"
- Nếu là fix bug, đã test lại chưa?

**Nguyên tắc:** không được "nghĩ là đã làm" — phải THẤY trong code/file.

### Bước 3 — Nếu có cái chưa làm, DỪNG COMMIT, làm nốt

- Không ghi commit message kiểu "fix everything" khi thực ra còn 3 cái chưa xong
- Không push rồi bảo "ah em quên cái X, lát em làm tiếp"
- **Quy tắc vàng:** Commit = snapshot của "tất cả yêu cầu user đã hoàn thành" — nếu chưa đủ, chưa commit

### Bước 4 — Viết commit message phản ánh ĐÚNG scope

Commit message phải list rõ:
- Requirement nào đã implement
- Requirement nào cố ý KHÔNG làm (và lý do), không giấu
- Known limitation

## CHECKLIST NHANH TRƯỚC KHI COMMIT (in ra trong response)

Khi chuẩn bị commit/push, Claude phải tự trả lời 6 câu và SHOW cho user:

1. Đã scroll lại từ đầu conversation?
2. Đã list ra mọi yêu cầu user đã đưa?
3. Đã verify từng yêu cầu đã implement trong code? (grep/đọc file xác nhận)
4. Có requirement nào user nói nhưng mình chưa làm? Liệt kê cụ thể.
5. Có bug user báo trước đó mà chưa test lại sau fix?
6. Commit message phản ánh đúng scope (không giấu, không over-claim)?

Nếu bất kỳ câu nào "không", **KHÔNG COMMIT**. Làm nốt rồi tick.

## KHI USER PHÀN NÀN "BẠN BỎ QUA YÊU CẦU CỦA TÔI"

Đây là dấu hiệu skill này đã fail. Phản ứng đúng:

1. Xin lỗi ngắn gọn, không phòng thủ
2. Re-run skill này ngay, scroll lại conversation, list requirements, verify từng cái
3. Nhận diện cụ thể cái nào bỏ sót, không nói chung chung "em sẽ cẩn thận hơn"
4. Fix ngay những cái đã bỏ sót
5. Lưu học rút được vào skill `common-build-errors-doscom` để đời sau nhớ

## ANTI-PATTERNS (hành vi cấm)

1. Commit khi mới làm 70%, "thôi commit trước rồi làm tiếp" → cấm
2. "Em nghĩ là đã làm" mà không verify trong file → cấm
3. Silent cut, bỏ sót mà không nói với user → cấm
4. Ghi commit message "fix all issues" khi chưa cover hết → cấm
5. Push rồi mới phát hiện thiếu → skill này ra đời để chặn điều này
6. Chỉ focus vào request MỚI NHẤT mà quên các request cũ trong cùng conversation → cấm

## TRƯỜNG HỢP ĐẶC BIỆT — DASHBOARD BUILD

Khi build dashboard (HTML/JS/React), trước khi push luôn phải verify:

- Filter scope: Bảng nào apply filter, bảng nào không? User có yêu cầu bảng X phải nhảy theo filter không?
- Data binding: Số hiển thị có đúng data source không? (đã loại team Facebook chưa? đã loại outlier chưa?)
- Column naming: Tên cột có đúng như user yêu cầu không?
- Edge case: Data rỗng, hiển thị "—" hay crash? Period không có data, handle ra sao?
- Syntax: Có ký tự đặc biệt bash escape không? → run skill `common-build-errors-doscom`

## NGUYÊN TẮC BẤT BIẾN

**"Một requirement bị bỏ sót = một lần user mất niềm tin."**

Thà commit chậm 10 phút vì re-check, hơn là commit nhanh rồi user phàn nàn.

## REFERENCE KHI DÙNG CHUNG VỚI CÁC SKILL KHÁC

- Khi commit code dashboard → dùng chung với `common-build-errors-doscom`
- Khi build agent/automation → dùng chung với `anti-laziness`
- Khi deliver file lớn → dùng chung với skill dành riêng (docx/pptx/xlsx)