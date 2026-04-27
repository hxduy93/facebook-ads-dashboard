# 📦 Doscom Project Context — Backup từ Claude Cowork

Folder này chứa toàn bộ context dự án **Doscom Holdings — FB Ads + Google Ads Dashboard** đã được Claude Cowork tích lũy qua nhiều session (April 2026).

## Mục đích

- Khi chuyển sang IDE khác (Antigravity, Cursor, VSCode + GitHub Copilot, Claude Code CLI, ...), bot mới đọc folder này → hiểu dự án ngay từ tin nhắn đầu, không phải mất 200+ tin nhắn lịch sử.
- Backup phòng ngừa nếu Cowork bị uninstall hoặc mất account.

## Cấu trúc

| File | Nội dung |
|------|----------|
| `00-README.md` | File này |
| `01-CLAUDE-MD.md` | Hồ sơ Doscom đầy đủ (sản phẩm, kịch bản, quy trình R&D, chiến lược thương hiệu) |
| `02-MEMORY.md` | 17 memory entries (user profile, projects, references, feedback rules) |
| `03-ARCHITECTURE.md` | Cấu trúc dashboard: Cloudflare Pages + KV + Pages Functions + GitHub Actions cron |
| `04-KNOWN-BUGS.md` | 16 bug đã gặp trong session April 2026 + cách fix |
| `05-WORKFLOW.md` | Push GitHub workflow, Cloudflare deploy, env vars |
| `06-FEEDBACK-RULES.md` | Quy tắc làm việc với Duy (style trả lời, anti-lazy, push confirm, terminology VN) |
| `skills/` | 6 skill markdown (audit Google Ads, content formulas, brand, ...) |

## Cách dùng với IDE mới

### Antigravity / Cursor / Windsurf

1. Mở folder `E:\Facebook Ads\github-repo` trong IDE
2. Vào Settings → Workspace Rules / System Prompt
3. Paste nội dung `01-CLAUDE-MD.md` + `02-MEMORY.md` + `06-FEEDBACK-RULES.md`
4. Bot mới hiểu dự án ngay

### Claude Code CLI

1. Đặt file `CLAUDE.md` ở repo root (đã có sẵn, link sang docs/claude-context/01-CLAUDE-MD.md)
2. Claude Code tự đọc khi launch

### Khi onboard 1 thành viên mới (Duy nhờ AI hỗ trợ)

1. Member chỉ cần đọc `00-README.md` và `01-CLAUDE-MD.md` là đủ overview dự án
2. Bug history ở `04-KNOWN-BUGS.md` để tránh lặp lại

## Versioning

Folder này nên cập nhật khi:
- Có thay đổi lớn về sản phẩm Doscom (thêm SKU, đổi giá)
- Bug pattern mới xuất hiện (thêm vào `04-KNOWN-BUGS.md`)
- Feedback mới từ Duy về cách làm việc (thêm vào `06-FEEDBACK-RULES.md`)
- Skill mới được tạo (thêm vào `skills/`)

Last updated: 2026-04-27
