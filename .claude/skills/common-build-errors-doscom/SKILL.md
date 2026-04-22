---
name: common-build-errors-doscom
description: Tra cứu và né tránh các lỗi thực tế đã mắc khi build dashboard HTML/JS/React cho Doscom, khi dùng bash heredoc có ký tự đặc biệt, khi hướng dẫn user chạy PowerShell trên máy Windows (git commit/push, file encoding, .bat prefix, index.lock), và khi xử lý git conflict/stash/rebase từ máy user lên GitHub. BẮT BUỘC dùng khi Claude chuẩn bị viết file HTML/JS dashboard, khi dùng bash với heredoc chứa dấu "!", "$", ", `, khi user sắp chạy PowerShell command đụng tới file tiếng Việt, khi hướng dẫn "git push"/"git commit"/"git stash"/"git rebase" từ máy user, khi build GitHub Actions workflow có cron schedule, hoặc khi user báo "dashboard đơ", "không load được", "mojibake tiếng Việt", "push bị reject", "index.lock". KHÔNG dùng cho viết nội dung marketing, kịch bản CSKH, tài liệu pháp lý, hoặc các task không liên quan tới code/git/dashboard.
---

# Common Build Errors — Doscom Dashboard & Git Deploy

> Bộ sưu tập lỗi thực tế đã mắc trong các session build Doscom dashboard + deploy Git từ máy user (Windows PowerShell).
> **Cập nhật:** v1.1 — 22/04/2026 (thêm 4 lỗi từ session push skill lên GitHub)

---

## 🧭 CÁCH DÙNG SKILL NÀY

1. **Trước khi viết code:** Scroll toàn bộ section bên dưới, check xem task hiện tại có đụng pattern nào không.
2. **Trước khi commit/push:** Re-check section `Git & PowerShell Errors`.
3. **Khi user báo lỗi:** Match lỗi user báo với section tương ứng, áp dụng fix.
4. **Khi phát hiện lỗi mới:** Bổ sung vào section cuối "CHƯA PHÂN LOẠI" để lần sau né.

---

## 🔥 TIER 1 — LỖI NGHIÊM TRỌNG, ĐÃ TÁI DIỄN NHIỀU LẦN

### LỖI 1.1 — Bash heredoc tự động escape ký tự "!" thành "\!"

**Triệu chứng:**
- Agent AI/dashboard JS file bị lỗi, user báo "đơ không load được"
- Mở file thấy `if(\!REPORT) return;` thay vì `if(!REPORT) return;`
- Console browser báo SyntaxError

**Nguyên nhân:**
Bash trong sandbox Claude khi dùng heredoc (`cat > file.js << 'EOF' ... EOF`) sẽ **tự động escape dấu `!`** thành `\!` trong JavaScript. Đây là đặc điểm của bash history expansion, **không phải do Claude viết sai**.

**Fix:**
```bash
# Sau MỌI lần write file .js/.html bằng bash heredoc, chạy auto-fix:
sed -i 's/\\!/!/g' /path/to/file.js
sed -i 's/\\!/!/g' /path/to/agent-google-doscom.js
```

**Phòng ngừa:**
- Ưu tiên dùng `Write` tool (file tool native), KHÔNG dùng bash heredoc để tạo file JS/HTML
- Nếu bắt buộc bash heredoc, luôn chạy `sed` fix ngay sau đó
- Đã bị lần này phải thêm step "verify không còn `\!` trong file" vào pre-commit checklist

**Lịch sử:** Tái diễn ít nhất 3 lần trong tháng 4/2026. File bị: `agent-google-doscom.js`, `dashboard.js`.

---

### LỖI 1.2 — PowerShell đọc/ghi file UTF-8 sai encoding → mojibake tiếng Việt

**Triệu chứng:**
Sau khi chạy PowerShell script xử lý file có tiếng Việt:
- `"Chạy"` → `"Chá¡y"`
- `"Yêu cầu"` → `"YÃªu cáº§u"`
- `"Ghi âm"` → `"Ghi Ã¢m"`

File YAML/JSON/Markdown có tiếng Việt bị phá hoàn toàn.

**Nguyên nhân:**
`Get-Content` + `Set-Content` trong PowerShell 5 mặc định dùng encoding **ANSI (Windows-1252)**, không phải UTF-8. Dù script có `-Encoding UTF8` khi GHI, nếu không set khi ĐỌC thì đã đọc sai từ đầu.

**Fix ĐÚNG — dùng .NET API:**
```powershell
$f = 'đường\dẫn\file.yml'
$p = Resolve-Path $f
$enc = New-Object System.Text.UTF8Encoding $false  # UTF-8 no-BOM
$c = [System.IO.File]::ReadAllText($p, $enc)
$c = $c -replace 'pattern_cũ', 'pattern_mới'
[System.IO.File]::WriteAllText($p, $c, $enc)
```

**Fix SAI (phổ biến):**
```powershell
# KHÔNG dùng!
(Get-Content $f -Raw) -replace 'a','b' | Set-Content -Encoding UTF8 $f
# ← Get-Content đọc bằng ANSI, mojibake xảy ra trước khi có Encoding UTF8
```

**Phòng ngừa:**
- Mọi script PowerShell đụng file tiếng Việt đều PHẢI dùng `[System.IO.File]::ReadAllText/WriteAllText` với UTF-8
- Sau khi chạy, verify bằng `git diff` — phải thấy CHỈ dòng cần sửa, không có ký tự mojibake ở dòng khác
- Nếu thấy diff có nhiều dòng "lạ" thay đổi → rollback ngay bằng `git reset --hard HEAD`

---

### LỖI 1.3 — PowerShell `Set-Content -NoNewline` nuốt toàn bộ line break

**Triệu chứng:**
File YAML/JSON sau khi chạy script PowerShell bị gộp về **1 dòng duy nhất**, mất hết xuống dòng.
- `git diff --stat` show `1 file changed, 1 insertion(+), 52 deletions(-)` (thay vì 1 insertion, 1 deletion)
- GitHub Actions báo YAML invalid, workflow không chạy được

**Nguyên nhân:**
Flag `-NoNewline` của `Set-Content` bảo PowerShell "không thêm newline cuối" — nhưng khi kết hợp với `-replace` trên chuỗi đã normalize line endings, nó xóa hết CR/LF giữa các dòng.

**Fix:**
- KHÔNG dùng `-NoNewline` khi xử lý YAML/JSON/multiline file
- Dùng `[System.IO.File]::WriteAllText` (giữ nguyên line endings)
- Verify sau write: `(Get-Content $f).Count` phải khớp số dòng gốc ± 1

**Lịch sử:** 21/04/2026, file `.github/workflows/fetch-google-ads.yml` bị phá, phải `git reset --hard HEAD~1` rollback.

---

## ⚡ TIER 2 — LỖI POWERSHELL/GIT HAY GẶP

### LỖI 2.1 — PowerShell không chạy `.bat` trong thư mục hiện tại

**Triệu chứng:**
```
fix_workflows.bat : The term 'fix_workflows.bat' is not recognized...
```
User confused vì CMD chạy được, PowerShell báo lỗi.

**Nguyên nhân:**
PowerShell có security policy không auto-run file trong cwd (chống malware trùng tên lệnh hệ thống). CMD thì cho phép.

**Fix:**
Luôn hướng dẫn user prefix `.\`:
```powershell
.\fix_workflows.bat
```

**Phòng ngừa:**
- Trong mọi hướng dẫn PowerShell, nếu file `.bat`/`.ps1` trong cwd, luôn ghi `.\filename`
- Explain cho user: "`.\` nghĩa là thư mục hiện tại, PowerShell mặc định không tự chạy file trong cwd vì bảo mật"

---

### LỖI 2.2 — `.git/index.lock: File exists` chặn mọi thao tác git

**Triệu chứng:**
```
fatal: Unable to create '.git/index.lock': File exists.
```
Mọi lệnh `git` đều fail.

**Nguyên nhân:**
- Lệnh git trước bị crash chưa kịp dọn
- Có app khác đang mở repo (VS Code, GitHub Desktop, SourceTree)

**Fix:**
```powershell
Remove-Item .git\index.lock -Force
```

**Phòng ngừa:**
- Khi hướng dẫn user chạy bat script có nhiều lệnh git, báo trước: "nếu crash giữa chừng có thể phải xóa `.git/index.lock`"
- Khuyên user đóng VSCode/GitHub Desktop trước khi chạy automation

---

### LỖI 2.3 — User đứng sai thư mục khi chạy git

**Triệu chứng:**
```
fatal: not a git repository (or any of the parent directories)
# Hoặc
pathspec 'data/...' did not match any files
```

**Nguyên nhân:**
User đang ở `E:\Facebook Ads\scripts\` hoặc `E:\Facebook Ads\` thay vì `E:\Facebook Ads\github-repo\` (nơi có `.git`).

**Fix:**
Luôn ghi explicit path trong hướng dẫn:
```powershell
cd "E:\Facebook Ads\github-repo"
git status
```

**Phòng ngừa:**
- KHÔNG bao giờ giả định user đang ở đúng cwd
- Luôn bắt đầu chuỗi lệnh bằng `cd <full_path>` hoặc check `git status` trước
- Giải thích "root repo" rõ ràng: "thư mục có folder ẩn `.git`"

---

### LỖI 2.4 — Paste nguyên prompt PowerShell làm lệnh

**Triệu chứng:**
```
Get-Process: A positional parameter cannot be found that accepts argument 'E:\Facebook'
```

**Nguyên nhân:**
User copy-paste nguyên dòng `PS E:\Facebook Ads\github-repo>` vào terminal, PowerShell hiểu `PS` là alias của `Get-Process`.

**Fix:**
Báo user bỏ qua lỗi, vô hại.

**Phòng ngừa:**
- Khi gửi code block, chỉ paste **lệnh**, không paste prompt `PS ...>`
- Dùng markdown code fence không prefix: ```` ```powershell ... ``` ```` với nội dung chỉ có lệnh

---

### LỖI 2.5 — `git stash pop` có conflict → user mất file dev

**Triệu chứng:**
User có stash chứa code đang dev, nhưng remote đã có commit mới trên cùng file → pop báo conflict.

**Nguyên nhân:**
Stash lưu diff theo base commit cũ, remote đã đi tiếp → 3-way merge fail.

**Fix — flow an toàn:**
```powershell
# 1. Kiểm tra stash có gì
git stash list
git stash show stash@{0} --stat  # xem stash có gì

# 2. Pop và xử lý conflict
git stash pop
# Nếu conflict:
git status  # xem file nào conflict

# 3a. File data (JSON auto-gen), ưu tiên remote:
git checkout --ours <file>
git add <file>

# 3b. File code dev, cần merge tay:
# Mở VSCode/Notepad merge, xóa marker <<<<<<< ======= >>>>>>>
# Hoặc thử keep bản dev rồi test syntax:
git checkout --theirs scripts/xxx.py
python -m py_compile scripts/xxx.py  # verify syntax
```

**⚠️ CẨN THẬN:** `--ours` vs `--theirs` khi rebase/stash có thể đảo nghĩa! Trong stash pop:
- `--ours` = bản ĐANG ở working tree (thường là bản remote đã merge)
- `--theirs` = bản trong stash (code dev của user)

**Phòng ngừa:**
- Khuyên user `git stash list` và `git stash show stash@{0} --stat` TRƯỚC khi pop
- Backup file dev quan trọng ra ngoài repo trước khi thao tác stash phức tạp

---

### LỖI 2.6 — Paste PowerShell block vào cmd.exe (và ngược lại)

**Triệu chứng:**
```
'#' is not recognized as an internal or external command, operable program or batch file.
'Write-Host' is not recognized as an internal or external command...
'$lockFile' is not recognized as an internal or external command...
```
Hoặc ngược lại khi paste cmd syntax vào PowerShell:
```
Microsoft : The term 'Microsoft' is not recognized as the name of a cmdlet...
```

**Nguyên nhân:**
User mở nhầm shell. cmd.exe không hiểu:
- `#` comment (cmd dùng `REM`)
- `Write-Host`, `Get-Process`, `Remove-Item`, `Format-Table` (chỉ có trên PowerShell)
- Biến `$var` (cmd dùng `%var%`)
- Block `if () {} else {}` (cmd dùng `if ... ( ) else ( )`)
- Here-string `@'...'@`

PowerShell thì lại không chạy được nếu user paste nguyên log cũ có prompt `C:\Users\HXDUy>`.

**Fix:**

**Cách 1 — Xác định đúng shell đang dùng:**
- PowerShell prompt: `PS C:\...>` (có "PS" ở đầu)
- cmd.exe prompt: `C:\...>` (không có "PS")

**Cách 2 — Mở đúng shell:**
- Start → gõ "PowerShell" → mở **Windows PowerShell** (không phải "PowerShell ISE")
- Hoặc Win+X → chọn "Windows PowerShell"

**Cách 3 — Viết block tương thích cả hai (hạn chế):**
Nếu không chắc user dùng shell nào, hạn chế dùng feature đặc thù. Lệnh `git` chạy được ở cả 2 shell. Nhưng `cd` với path cross-drive chỉ PowerShell làm được (xem Lỗi 2.9).

**Phòng ngừa:**
- Khi viết code block, LUÔN ghi rõ `powershell` hoặc `cmd` ở đầu code fence
- Nhắc user: "mở PowerShell (không phải cmd)"
- Nếu block có `$var`, `Write-Host`, `-ForegroundColor` → PS only
- Nếu block có `%var%`, `@echo off` → cmd only

**Lịch sử:** 22/04/2026 session push skill. User mở cmd.exe paste PowerShell block → tất cả lệnh fail. Sau đó mở PowerShell lại paste cả log cũ (có prompt) vào → tiếp tục fail. Mất 3 lượt để sửa.

---

### LỖI 2.7 — `git push` lần đầu repo cần `--set-upstream origin main`

**Triệu chứng:**
```
fatal: The current branch main has no upstream branch.
To push the current branch and set the remote as upstream, use
    git push --set-upstream origin main
```

**Nguyên nhân:**
Branch local chưa link với branch remote. Lần đầu push cần explicit tell git "branch này tracking origin/main".

**Fix:**
```powershell
git push --set-upstream origin main
```

Hoặc shortcut:
```powershell
git push -u origin main
```

Sau lần đầu, các lần sau chỉ cần `git push`.

**Phòng ngừa:**
- Khi hướng dẫn user clone mới hoặc init repo mới, ALWAYS dùng `-u` ở lần push đầu
- Nếu clone từ GitHub thì không cần (đã tracking sẵn)
- Set global default để tự tạo upstream:
  ```powershell
  git config --global push.autoSetupRemote true
  ```

---

### LỖI 2.8 — `git pull --rebase` với dirty working tree → fail

**Triệu chứng:**
```
error: cannot pull with rebase: You have unstaged changes.
error: please commit or stash them.
```
Hoặc `git stash pop` sau pull rebase bị conflict vì remote đã sửa cùng file.

**Nguyên nhân:**
Git không cho rebase khi working tree còn modified file chưa commit. Pull --rebase re-apply commit trên HEAD mới từ remote, file đang sửa dở có thể conflict.

**Fix — flow 4 bước an toàn:**
```powershell
git stash push -u -m "WIP before sync with remote"
git pull --rebase origin main
git push origin main
git stash pop
```

- `-u` stash cả untracked files
- Nếu `stash pop` conflict → xem Lỗi 2.5

**Phòng ngừa:**
- Trước khi pull/rebase, ALWAYS check `git status` xem có uncommitted changes không
- Nếu có → quyết định: commit trước hoặc stash trước
- Giải thích cho user: "stash giống ngăn kéo tạm, pop lại ra sau"

**Lịch sử:** 22/04/2026 session push skill. User có 4 file modified + 6 untracked từ task Google Ads agent đang pause. Pull --rebase phải stash trước, sau đó pop lại → conflict 3 file → dùng `--theirs` giữ version local.

---

### LỖI 2.9 — `cd` trong cmd không đổi ổ đĩa

**Triệu chứng:**
User ở `C:\Users\HXDUy` chạy `cd "E:\Facebook Ads\github-repo"` trong cmd → prompt vẫn là `C:\Users\HXDUy>`, không đổi. Lệnh git sau đó fail "not a git repository".

**Nguyên nhân:**
cmd.exe mặc định `cd` chỉ đổi thư mục, không đổi ổ đĩa (drive). PowerShell và Linux shell thì đổi được cả drive + path với 1 lệnh `cd`.

**Fix (cmd):**

Cách 1 — đổi ổ đĩa trước:
```cmd
E:
cd "E:\Facebook Ads\github-repo"
```

Cách 2 — dùng `cd /d`:
```cmd
cd /d "E:\Facebook Ads\github-repo"
```

**PowerShell thì không cần:**
```powershell
cd "E:\Facebook Ads\github-repo"   # OK, đổi cả drive
```

**Phòng ngừa:**
- Nếu hướng dẫn cho cmd.exe, luôn dùng `cd /d` hoặc đổi drive trước
- Khuyến khích user dùng PowerShell thay cmd — ít pitfalls hơn

---

## 🔧 TIER 3 — LỖI GITHUB ACTIONS & CI/CD

### LỖI 3.1 — Cron race condition giữa 2 workflow cùng repo

**Triệu chứng:**
2 workflow fetch data cùng schedule `*/30 * * * *` → cả 2 cùng chạy phút `:00` và `:30` → push conflict:
```
! [rejected] main -> main (fetch first)
```

**Nguyên nhân:**
Cả 2 đồng thời `git commit` + `git push` trên cùng branch → second push bị reject vì fast-forward fail.

**Fix:**
Lệch schedule:
```yaml
# Workflow A
- cron: "0,30 * * * *"   # :00 và :30
# Workflow B
- cron: "5,35 * * * *"   # :05 và :35 (lệch 5 phút)
```

**Kết hợp với retry + rebase:**
```bash
for i in 1 2 3 4 5; do
  git fetch origin main
  git rebase origin/main
  git push origin main && break
  sleep $((i * 5))
done
```

**Phòng ngừa:**
- Mọi workflow cùng push vào 1 branch phải lệch schedule ít nhất 5 phút
- Luôn thêm retry 5 lần với rebase trước push
- Document trong README lịch cron của từng workflow

---

### LỖI 3.2 — GitHub PAT "no expiration" hiển thị icon ⚠️ user nhầm là hết hạn

**Triệu chứng:**
User báo "access token hết hạn" dù đã set "no expiration".

**Nguyên nhân:**
GitHub hiển thị ⚠️ warning vàng với token không hết hạn, NHƯNG đây là **khuyến cáo bảo mật** ("token vĩnh viễn rủi ro cao"), không phải báo lỗi.

**Fix:**
Giải thích cho user: icon ⚠️ KHÔNG phải error, chỉ là GitHub nhắc nên set expiration ngắn hơn cho an toàn. Token vẫn hoạt động.

**Phòng ngừa:**
- Khi user báo "token hết hạn", luôn hỏi screenshot trước khi kết luận
- Phân biệt "Expires on [date]" vs "No expiration date" vs "Expired" rõ ràng

---

## 📊 TIER 4 — LỖI DASHBOARD BUILD (HTML/JS/React)

### LỖI 4.1 — Time filter không apply toàn bộ bảng (user expect dynamic)

**Triệu chứng:**
User yêu cầu dashboard có bộ lọc thời gian, nhưng sau khi build chỉ một số bảng react, còn lại cố định 30d. User phàn nàn.

**Nguyên nhân:**
- Data source (Windsor free trial, Pancake POS) không support daily granularity cho mọi field
- Dev implement partial mà không document rõ

**Fix:**
1. Hỏi rõ user từ đầu: "bảng nào cần filter động, bảng nào fix 30d OK?"
2. Implement đúng requirement
3. Nếu technical limitation, **document rõ trên UI**:
   ```html
   <p class="note">
     Bảng keyword/banner/placement: cố định 30d (Windsor free trial không hỗ trợ daily).
     Muốn filter daily: upgrade Windsor paid hoặc chuyển Google Ads API trực tiếp.
   </p>
   ```
4. Đổi nhãn bảng phản ánh scope: "Xếp hạng SP theo Doanh thu — Kỳ: [label]"

**Phòng ngừa:**
- Trước khi code dashboard, list ra **matrix filter scope** cho từng bảng
- Get user approval matrix trước khi build
- Nếu có technical limit, show UI warning ngay từ đầu

---

### LỖI 4.2 — Column naming mơ hồ (user nhầm với SEO rank)

**Triệu chứng:**
Cột "Xếp hạng" trong bảng keyword thực ra là ranking nội bộ (hiệu quả conv/spend/CTR), nhưng user hiểu là SEO position thật. User phàn nàn "phải là SEO chứ".

**Fix:**
1. Đổi tên cột rõ ràng: "Hiệu quả #" hoặc "Rank nội bộ (conv/spend)"
2. Thêm tooltip hover: "Không phải SEO rank Google"
3. Nếu user muốn SEO thật, add metric:
   - `search_top_impression_share` (% impression ở top 4)
   - `search_absolute_top_impression_share` (% impression ở #1)
   - Google Ads đã bỏ `average_position` từ 2019

**Phòng ngừa:**
- Mọi cột numeric ranking phải có tooltip giải thích metric gốc
- Nếu SEO-related, luôn clarify "ads impression share" vs "organic SEO rank"

---

### LỖI 4.3 — Dashboard hiển thị data outlier (team nội bộ) không lọc

**Triệu chứng:**
Top sản phẩm D1 hiển thị 415tr doanh thu vì include team Facebook (DUY 382tr internal test). Data không reflect sales thực.

**Fix:**
```javascript
// Loại team nội bộ khỏi ranking
const EXCLUDED_SOURCES = ['DUY', 'TEAM_FB_TEST', ...];
const filteredOrders = orders.filter(o => !EXCLUDED_SOURCES.includes(o.source));
```

**Phòng ngừa:**
- Hỏi user từ đầu: "có source nào cần exclude không?" (test/internal/team/shop nội bộ)
- Document blacklist source ở đầu file JS
- Show dashboard "Data range: [external sources only]" để user biết

---

### LỖI 4.4 — Agent AI đơ sau deploy (thường do syntax error)

**Triệu chứng:**
Dashboard/agent load trắng, không hiển thị gì. Console báo SyntaxError.

**Nguyên nhân (thứ tự ưu tiên check):**
1. `\!` do bash heredoc escape (xem Lỗi 1.1)
2. Template literal chưa đóng ngoặc
3. Missing semicolon trong IIFE
4. Browser cache version cũ

**Fix flow:**
```bash
# 1. Check syntax local trước
node -c dashboard.js  # hoặc: python -m py_compile <file>.py

# 2. Grep tìm pattern sai
grep -n '\\!' dashboard.js
grep -n 'console\.log' dashboard.js  # có thể quên xóa debug

# 3. Sau deploy, hard reload browser (Ctrl+Shift+R)
# 4. Nếu vẫn lỗi, mở DevTools → Console → screenshot gửi
```

**Phòng ngừa:**
- Sau mọi write file JS bằng bash, MUST chạy `node -c` verify syntax
- Pre-commit hook: lint JS trước khi commit
- Dashboard phải có try-catch bao ngoài init(), log error rõ ràng để user screenshot

---

## 🗂️ TIER 5 — LỖI VẬN HÀNH & COMMUNICATION

### LỖI 5.1 — Gộp nhiều lệnh nhưng không báo user biết có dấu `;`

**Triệu chứng:**
User copy `git push origin main.\fix_workflows.bat` vào terminal → dính 2 lệnh → lỗi.

**Fix:**
- Khi gộp lệnh trong 1 dòng dùng `;`, ALWAYS explain: "`;` ngăn cách lệnh"
- Khi user nói "tách dòng" → LUÔN tách, đừng gộp
- Khi user nói "gộp 1 block" → dùng code fence riêng cho từng block

**Phòng ngừa:**
- Hỏi user từ đầu: "anh muốn em tách dòng hay gộp 1 block?"
- Nhớ setting này cho toàn cuộc trò chuyện

---

### LỖI 5.2 — Code fence không explain kết quả expected

**Triệu chứng:**
User chạy xong không biết output đúng hay sai, phải hỏi lại "xong chưa".

**Fix:**
Mọi code block phải kèm "tiêu chí pass":
```markdown
```powershell
git push origin main
```
→ PASS nếu thấy `main -> main` ở dòng cuối.
→ FAIL nếu thấy `! [rejected]` hoặc `Everything up-to-date`.
```

---

### LỖI 5.3 — User dùng VSCode/editor không có trong PATH

**Triệu chứng:**
Hướng dẫn `code file.js` → user báo "'code' is not recognized".

**Fix:**
- Luôn có fallback: `notepad file.js` (Windows built-in)
- Hoặc phương án không cần editor: dùng `git checkout --theirs/--ours` + verify bằng syntax check

---

## 📝 TIER 6 — MEMO TỔNG KẾT (QUICK REFERENCE)

Khi build Doscom dashboard + deploy từ máy user, luôn check 14 điểm sau:

1. [ ] File JS được tạo bằng `Write` tool (KHÔNG bash heredoc) — tránh `\!`
2. [ ] PowerShell script dùng `[System.IO.File]::ReadAllText/WriteAllText` cho file tiếng Việt
3. [ ] KHÔNG dùng `Set-Content -NoNewline` với YAML/JSON
4. [ ] Hướng dẫn PowerShell có `.\` prefix cho file trong cwd
5. [ ] Cảnh báo user về `.git/index.lock` nếu script có nhiều lệnh git
6. [ ] Luôn `cd <full_path>` explicit trước lệnh git (dùng `cd /d` nếu cmd + đổi drive)
7. [ ] 2 workflow cùng branch phải lệch cron + có retry 5 lần
8. [ ] Dashboard: matrix filter scope được user approve từ đầu
9. [ ] Column naming rõ ràng, có tooltip nếu là ranking nội bộ
10. [ ] Pre-commit: chạy skill `workflow-discipline` re-check requirements
11. [ ] Code fence ghi rõ `powershell` hoặc `cmd` — KHÔNG để user nhầm shell
12. [ ] Lần đầu push branch mới → dùng `git push -u origin main` hoặc set `push.autoSetupRemote true`
13. [ ] Pull/rebase với dirty working tree → `git stash push -u` trước, `pop` sau
14. [ ] Khi user paste log có prompt (`PS C:\..>` hoặc `C:\..>`), báo user copy CHỈ phần lệnh, bỏ prompt

---

## 🆕 CHƯA PHÂN LOẠI (bổ sung khi gặp lỗi mới)

> Khi gặp lỗi mới chưa có trong skill này, add vào đây với format:
> - **Ngày:**
> - **Context:**
> - **Triệu chứng:**
> - **Nguyên nhân:**
> - **Fix:**
> - **Phòng ngừa:**

---

## 🔗 REFERENCE — DÙNG CHUNG VỚI SKILL NÀO

- `workflow-discipline` — BẮT BUỘC chạy trước mọi commit/push để re-check requirements
- `anti-laziness` — khi output >50 dòng code hoặc >500 từ, tránh placeholder
- `doscom-brand-guidelines` — khi dashboard cần áp màu/font thương hiệu Doscom
