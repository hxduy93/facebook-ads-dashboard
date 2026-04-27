# 📋 Feedback Rules — Cách làm việc với Duy

8 quy tắc Duy đã thiết lập qua các session April 2026. AI mới làm việc với dự án Doscom CẦN tuân thủ.

## Rule 1 — Style trả lời

- **Ngôn ngữ**: Tiếng Việt. Xưng "tôi", gọi "Duy".
- **Format**: Bảng markdown khi so sánh số liệu hoặc liệt kê (4 ad account, 5 SP, 8 nhóm chấm điểm).
- **Step-by-step**: Hướng dẫn kỹ thuật chia rõ bước, kèm URL/screenshot expectation.
- **Không postamble dài**: Đã làm xong thì thôi, không giải thích lại — Duy đọc diff/file được.
- **Link file**: `[Tên file](computer://...)` cho mọi output.
- **Critical step**: Dừng trước commit/push để Duy verify.

## Rule 2 — Triển khai đầy đủ (chống lười)

Khi Duy giao task lớn (skill, tài liệu, báo cáo, code dài):

1. Triển khai **đầy đủ mọi ý** Duy yêu cầu, không tự cắt bớt.
2. **Không rút gọn**, không viết vắn tắt 30% khi có thể 80-100%.
3. **Không placeholder** ("…", "v.v.", "tương tự", "(bổ sung sau)").
4. Mọi section có thể liên quan → đủ tất cả. Không chắc → hỏi trước khi viết.
5. Code: không TODO, không bỏ edge case. Edge case chưa xử lý → comment hoặc hỏi.
6. Câu hỏi kỹ thuật: cho đủ ngữ cảnh + alternatives + ưu/nhược.

**Ngoại lệ ngắn**: Conversation thường, back-and-forth nhanh, step-by-step debug guided.

**Trigger keywords**: "triển khai đầy đủ", "không được vắn tắt", "chi tiết", "tạo skill", "viết tài liệu", "đừng làm tắt".

## Rule 3 — Hỏi trước khi push GitHub

**LUÔN hỏi user xác nhận** trước:
- `git push` (deploy production)
- Bất kỳ action nào tác động infrastructure (Cloudflare, scheduled tasks, GitHub workflows, email, APIs)
- Generate file lớn vào E:\
- Major change có thể phá UI

**Kể cả khi**:
- User đã nói "push" / "làm xong" turn trước
- Task có vẻ routine
- Đang fix bug → cần fix tiếp → vẫn hỏi

**Workflow chuẩn**:
1. Sửa code trong /tmp sandbox → commit local
2. Tóm tắt thay đổi (file gì, dòng gì, impact gì)
3. Hỏi explicit "Push lên GitHub chưa?"
4. CHỈ khi user confirm rõ TRONG TURN ĐÓ → mới push

**Không cần hỏi**: commit local, read-only git ops (status/log/diff), Read/Write trong /tmp.

## Rule 4 — Plan A trước, B sau

Khi user nói "thử A, fail mới B" (hoặc biến thể):

1. **Tập trung 100% vào A** — thử mọi cách (tools, scripts, web fetch, hỏi user).
2. Báo cáo kết quả A, **chờ user xác nhận** trước khi xét B.
3. CHỈ khi A fail rõ ràng → mới triển khai/đề xuất B.
4. **KHÔNG liệt kê sẵn B** trong câu trả lời kiểm tra A — gây loãng focus.

Nếu cần đề cập B: 1 dòng cuối "Nếu A fail mình chuyển sang B" — không triển khai chi tiết.

## Rule 5 — Gom commit, không push rải rác

Khi fix 1 vấn đề cần nhiều thay đổi nhỏ:

1. Làm hết trong /tmp/local repo, **TEST kỹ** trước khi push.
2. Commit **1 lần duy nhất**, message rõ ràng.
3. KHÔNG push từng bước nhỏ rồi fix tiếp → gây nhiều build runs Cloudflare → confuse.

**Nếu phát hiện lỗi sau push**:
- `git commit --amend` + `git push --force-with-lease`
- Hoặc rebase + squash

**Lưu ý**: Edit tool có thể truncate file → luôn verify cuối file đúng (`</html>`, `if __name__ == "__main__":\n    main()`) trước commit.

## Rule 6 — PowerShell UTF-8 với tiếng Việt

Khi sửa file UTF-8 (yml, json, py có comment tiếng Việt) qua PowerShell 5:

**KHÔNG dùng**:
- `Get-Content $f` (mặc định ANSI/Windows-1252) → mojibake
- `Set-Content -NoNewline` → nuốt line break, file YAML mất cấu trúc

**DÙNG `[System.IO.File]` API**:
```powershell
$enc = New-Object System.Text.UTF8Encoding $false  # UTF-8 no BOM
$c = [System.IO.File]::ReadAllText($p, $enc)
$c = $c -replace 'pattern', 'replacement'
[System.IO.File]::WriteAllText($p, $c, $enc)
```

## Rule 7 — Giải thích VN sau thuật ngữ EN

Mọi UI dashboard / báo cáo / artifact / explain kỹ thuật cho Doscom: **mỗi term tiếng Anh phải kèm giải thích tiếng Việt**.

### Marketing/Ads terms (UI dashboard)
- CTR (tỷ lệ click), CPC (chi phí mỗi click), CPM (chi phí mỗi 1000 hiển thị), ROAS (lợi nhuận/chi phí ads), AOV (giá trị đơn TB), Conv (chuyển đổi/đơn), Imp (lượt hiển thị)
- KEEP (giữ nguyên), SCALE (tăng bid), PAUSE (tạm dừng), REPLACE (thay thế), MONITOR (theo dõi)
- ACTIVE (đang chạy), EXCLUDED (loại trừ), PAUSED (tạm dừng)
- BROAD (đối sánh rộng), PHRASE (cụm), EXACT (chính xác), NEAR_PHRASE (gần cụm)
- SEARCH (tìm kiếm), CONTENT (mạng hiển thị), YOUTUBE, MIXED (hỗn hợp), DISPLAY (hiển thị GDN)
- WEBSITE, MOBILE_APPLICATION (app), YOUTUBE_VIDEO
- RSA (Responsive Search Ad — quảng cáo tìm kiếm linh hoạt), DISPLAY_BANNER, VIDEO

### Programming/Dev terms (hướng dẫn code, log)
- Git: commit (lưu), push (đẩy), pull (kéo), rebase (xếp lại), merge (gộp), branch (nhánh), PAT (mã truy cập), remote (repo từ xa), origin (gốc), HEAD (commit hiện tại), stash (lưu tạm)
- Deploy: build (đóng gói), deploy (triển khai), CDN (mạng phân phối), cache (đệm), rollback (quay lui), production (bản thật)
- API: endpoint (điểm truy cập), fetch (lấy data), request/response (yêu cầu/phản hồi), 200/404/403/500 (mã trạng thái)
- Auth: OAuth (xác thực bên thứ ba), session (phiên), cookie (tệp cookie), middleware (lớp trung gian), token (mã xác thực)
- Code: async/await (bất đồng bộ), promise, callback (hàm gọi lại), JSON, parse (phân tích), render (hiển thị), SyntaxError (lỗi cú pháp)

**Format**: `CTR (tỷ lệ click)` hoặc tooltip `title="Tỷ lệ click"`, hoặc dòng chú thích đầu bảng.

## Rule 8 — Đọc skill `common-build-errors-doscom` trước khi action

Trước khi viết code/dashboard/git/PowerShell/CI:
1. Đọc `E:\Facebook Ads\.claude-skills\common-build-errors-doscom\SKILL.md`
2. Scan checklist 14 điểm Tier 6
3. Apply fix/phòng ngừa tương ứng

Khi gặp lỗi mới chưa có → bổ sung vào skill (3 bản: `.claude-skills/`, `github-repo/.claude/skills/`, `github-repo/docs/skills/`).

**Trigger keywords**: dashboard, agent JS, workflow YAML, git push/commit/stash/rebase, PowerShell script, fix encoding, bash heredoc, GitHub Actions cron.
