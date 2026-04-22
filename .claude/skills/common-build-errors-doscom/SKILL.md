---
name: common-build-errors-doscom
description: Tra cuu va ne tranh cac loi thuc te da mac khi build dashboard HTML/JS/React cho Doscom, khi dung bash heredoc co ky tu dac biet, khi huong dan user chay PowerShell tren may Windows (git commit/push, file encoding, .bat prefix, index.lock), va khi xu ly git conflict/stash/rebase tu may user len GitHub. BAT BUOC dung khi Claude chuan bi viet file HTML/JS dashboard, khi dung bash voi heredoc chua dau "!", "$", ", `, khi user sap chay PowerShell command dung toi file tieng Viet, khi huong dan "git push"/"git commit"/"git stash"/"git rebase" tu may user, khi build GitHub Actions workflow co cron schedule, hoac khi user bao "dashboard do", "khong load duoc", "mojibake tieng Viet", "push bi reject", "index.lock". KHONG dung cho viet noi dung marketing, kich ban CSKH, tai lieu phap ly, hoac cac task khong lien quan toi code/git/dashboard.
---

# Common Build Errors - Doscom Dashboard & Git Deploy

Bo suu tap loi thuc te da mac trong cac session build Doscom dashboard + deploy Git tu may user (Windows PowerShell).
Cap nhat: v1.0 - 22/04/2026

---

## TIER 1 - LOI NGHIEM TRONG, DA TAI DIEN NHIEU LAN

### LOI 1.1 - Bash heredoc tu dong escape ky tu "!" thanh "\!"

Trieu chung: Agent AI/dashboard JS file bi loi, user bao "do khong load duoc". Mo file thay if(\!REPORT) thay vi if(!REPORT). Console bao SyntaxError.

Nguyen nhan: Bash trong sandbox Claude khi dung heredoc (cat > file.js << EOF) se tu dong escape dau ! thanh \! trong JavaScript. Day la dac diem cua bash history expansion.

Fix: Sau MOI lan write file .js/.html bang bash heredoc, chay auto-fix: sed -i s/\\!/!/g /path/to/file.js

Phong ngua: Uu tien dung Write tool (file tool native), KHONG dung bash heredoc de tao file JS/HTML. Neu bat buoc bash heredoc, luon chay sed fix ngay sau do.

Lich su: Tai dien it nhat 3 lan trong thang 4/2026. File bi: agent-google-doscom.js, dashboard.js.

---

### LOI 1.2 - PowerShell doc/ghi file UTF-8 sai encoding -> mojibake tieng Viet

Trieu chung: Sau khi chay PowerShell script xu ly file co tieng Viet, cac tu nhu "Chay", "Yeu cau", "Ghi am" bi bien thanh ky tu la. File YAML/JSON/Markdown bi pha hoan toan.

Nguyen nhan: Get-Content + Set-Content trong PowerShell 5 mac dinh dung encoding ANSI (Windows-1252), khong phai UTF-8. Du script co -Encoding UTF8 khi GHI, neu khong set khi DOC thi da doc sai tu dau.

Fix DUNG - dung .NET API:
$enc = New-Object System.Text.UTF8Encoding $false
$c = [System.IO.File]::ReadAllText($path, $enc)
[System.IO.File]::WriteAllText($path, $c, $enc)

Fix SAI pho bien: (Get-Content $f -Raw) -replace ... | Set-Content -Encoding UTF8 $f -> Get-Content doc bang ANSI, mojibake xay ra truoc.

Phong ngua: Moi script PowerShell dung file tieng Viet deu PHAI dung [System.IO.File]::ReadAllText/WriteAllText voi UTF-8. Sau khi chay, verify bang git diff.

---

### LOI 1.3 - PowerShell Set-Content -NoNewline nuot toan bo line break

Trieu chung: File YAML/JSON sau khi chay script PowerShell bi gop ve 1 dong duy nhat, mat het xuong dong. git diff --stat show 1 insertion(+), 52 deletions(-). GitHub Actions bao YAML invalid.

Nguyen nhan: Flag -NoNewline cua Set-Content bao PowerShell khong them newline cuoi - nhung khi ket hop voi -replace tren chuoi da normalize line endings, no xoa het CR/LF.

Fix: KHONG dung -NoNewline khi xu ly YAML/JSON/multiline file. Dung [System.IO.File]::WriteAllText. Verify sau write: (Get-Content $f).Count phai khop so dong goc +/- 1.

Lich su: 21/04/2026, file .github/workflows/fetch-google-ads.yml bi pha, phai git reset --hard HEAD~1 rollback.

---

## TIER 2 - LOI POWERSHELL/GIT HAY GAP

### LOI 2.1 - PowerShell khong chay .bat trong thu muc hien tai

Trieu chung: fix_workflows.bat : The term fix_workflows.bat is not recognized. User confused vi CMD chay duoc, PowerShell bao loi.

Nguyen nhan: PowerShell co security policy khong auto-run file trong cwd (chong malware trung ten lenh he thong). CMD thi cho phep.

Fix: Luon huong dan user prefix .\ -> .\fix_workflows.bat

Phong ngua: Trong moi huong dan PowerShell, neu file .bat/.ps1 trong cwd, luon ghi .\filename.

---

### LOI 2.2 - .git/index.lock: File exists chan moi thao tac git

Trieu chung: fatal: Unable to create .git/index.lock: File exists. Moi lenh git deu fail.

Nguyen nhan: Lenh git truoc bi crash chua kip don, hoac co app khac dang mo repo (VS Code, GitHub Desktop).

Fix: Remove-Item .git\index.lock -Force

Phong ngua: Khi huong dan user chay bat script co nhieu lenh git, bao truoc: "neu crash giua chung co the phai xoa .git/index.lock". Khuyen user dong VSCode truoc khi chay automation.

---

### LOI 2.3 - User dung sai thu muc khi chay git

Trieu chung: fatal: not a git repository hoac pathspec did not match any files.

Nguyen nhan: User dang o E:\Facebook Ads\scripts\ thay vi E:\Facebook Ads\github-repo\ (noi co .git).

Fix: Luon ghi explicit path trong huong dan: cd "E:\Facebook Ads\github-repo" truoc git status.

Phong ngua: KHONG bao gio gia dinh user dang o dung cwd. Luon bat dau chuoi lenh bang cd <full_path>. Giai thich "root repo" ro rang: thu muc co folder an .git.

---

### LOI 2.4 - Paste nguyen prompt PowerShell lam lenh

Trieu chung: Get-Process: A positional parameter cannot be found that accepts argument E:\Facebook.

Nguyen nhan: User copy-paste nguyen dong PS E:\Facebook Ads\github-repo> vao terminal, PowerShell hieu PS la alias cua Get-Process.

Fix: Bao user bo qua loi, vo hai.

Phong ngua: Khi gui code block, chi paste lenh, khong paste prompt PS ...>. Dung code fence khong prefix.

---

### LOI 2.5 - git stash pop co conflict -> user mat file dev

Trieu chung: User co stash chua code dang dev, nhung remote da co commit moi tren cung file -> pop bao conflict.

Nguyen nhan: Stash luu diff theo base commit cu, remote da di tiep -> 3-way merge fail.

Fix flow an toan:
1. git stash list, git stash show stash@{0} --stat (xem stash co gi)
2. git stash pop, git status xem file nao conflict
3a. File data (JSON auto-gen), uu tien remote: git checkout --ours <file>, git add <file>
3b. File code dev, can merge tay: xoa marker <<<<<<< ======= >>>>>>>, hoac git checkout --theirs scripts/xxx.py roi python -m py_compile verify.

CAN THAN: --ours vs --theirs khi rebase/stash co the dao nghia. Trong stash pop: --ours = ban DANG o working tree (thuong la ban remote da merge), --theirs = ban trong stash (code dev cua user).

Phong ngua: Khuyen user git stash list va git stash show stash@{0} --stat TRUOC khi pop. Backup file dev quan trong ra ngoai repo truoc khi thao tac stash phuc tap.

---

## TIER 3 - LOI GITHUB ACTIONS & CI/CD

### LOI 3.1 - Cron race condition giua 2 workflow cung repo

Trieu chung: 2 workflow fetch data cung schedule */30 * * * * -> ca 2 cung chay phut :00 va :30 -> push conflict: ! [rejected] main -> main (fetch first).

Nguyen nhan: Ca 2 dong thoi git commit + git push tren cung branch -> second push bi reject vi fast-forward fail.

Fix: Lech schedule:
- Workflow A: cron "0,30 * * * *" (:00 va :30)
- Workflow B: cron "5,35 * * * *" (:05 va :35, lech 5 phut)

Ket hop voi retry + rebase 5 lan truoc push.

Phong ngua: Moi workflow cung push vao 1 branch phai lech schedule it nhat 5 phut. Luon them retry 5 lan voi rebase truoc push. Document trong README lich cron cua tung workflow.

---

### LOI 3.2 - GitHub PAT "no expiration" hien thi icon canh bao user nham la het han

Trieu chung: User bao "access token het han" du da set "no expiration".

Nguyen nhan: GitHub hien thi warning vang voi token khong het han, NHUNG day la khuyen cao bao mat (token vinh vien rui ro cao), khong phai bao loi.

Fix: Giai thich cho user: icon canh bao KHONG phai error, chi la GitHub nhac nen set expiration ngan hon cho an toan. Token van hoat dong.

Phong ngua: Khi user bao "token het han", luon hoi screenshot truoc khi ket luan. Phan biet "Expires on [date]" vs "No expiration date" vs "Expired" ro rang.

---

## TIER 4 - LOI DASHBOARD BUILD (HTML/JS/React)

### LOI 4.1 - Time filter khong apply toan bo bang (user expect dynamic)

Trieu chung: User yeu cau dashboard co bo loc thoi gian, nhung sau khi build chi mot so bang react, con lai co dinh 30d. User phan nan.

Nguyen nhan: Data source (Windsor free trial, Pancake POS) khong support daily granularity cho moi field. Dev implement partial ma khong document ro.

Fix: Hoi ro user tu dau "bang nao can filter dong, bang nao fix 30d OK?". Implement dung requirement. Neu technical limitation, document ro tren UI bang note HTML. Doi nhan bang phan anh scope: "Xep hang SP theo Doanh thu - Ky: [label]".

Phong ngua: Truoc khi code dashboard, list ra matrix filter scope cho tung bang. Get user approval matrix truoc khi build. Neu co technical limit, show UI warning ngay tu dau.

---

### LOI 4.2 - Column naming mo ho (user nham voi SEO rank)

Trieu chung: Cot "Xep hang" trong bang keyword thuc ra la ranking noi bo (hieu qua conv/spend/CTR), nhung user hieu la SEO position that. User phan nan "phai la SEO chu".

Fix: Doi ten cot ro rang: "Hieu qua #" hoac "Rank noi bo (conv/spend)". Them tooltip hover: "Khong phai SEO rank Google". Neu user muon SEO that, add metric search_top_impression_share, search_absolute_top_impression_share. Google Ads da bo average_position tu 2019.

Phong ngua: Moi cot numeric ranking phai co tooltip giai thich metric goc. Neu SEO-related, luon clarify "ads impression share" vs "organic SEO rank".

---

### LOI 4.3 - Dashboard hien thi data outlier (team noi bo) khong loc

Trieu chung: Top san pham D1 hien thi 415tr doanh thu vi include team Facebook (DUY 382tr internal test). Data khong reflect sales thuc.

Fix: Loai team noi bo khoi ranking bang EXCLUDED_SOURCES array, filter orders truoc khi aggregate.

Phong ngua: Hoi user tu dau: "co source nao can exclude khong?" (test/internal/team/shop noi bo). Document blacklist source o dau file JS. Show dashboard "Data range: [external sources only]" de user biet.

---

### LOI 4.4 - Agent AI do sau deploy (thuong do syntax error)

Trieu chung: Dashboard/agent load trang, khong hien thi gi. Console bao SyntaxError.

Nguyen nhan (thu tu uu tien check):
1. \! do bash heredoc escape (xem Loi 1.1)
2. Template literal chua dong ngoac
3. Missing semicolon trong IIFE
4. Browser cache version cu

Fix flow: Check syntax local truoc bang node -c dashboard.js. Grep tim pattern sai: grep -n "\\\\!" dashboard.js. Sau deploy, hard reload browser (Ctrl+Shift+R). Neu van loi, mo DevTools Console screenshot gui.

Phong ngua: Sau moi write file JS bang bash, MUST chay node -c verify syntax. Pre-commit hook: lint JS truoc khi commit. Dashboard phai co try-catch bao ngoai init(), log error ro rang de user screenshot.

---

## TIER 5 - LOI VAN HANH & COMMUNICATION

### LOI 5.1 - Gop nhieu lenh nhung khong bao user biet co dau ;

Trieu chung: User copy git push origin main.\fix_workflows.bat vao terminal -> dinh 2 lenh -> loi.

Fix: Khi gop lenh trong 1 dong dung ;, ALWAYS explain: "; ngan cach lenh". Khi user noi "tach dong" -> LUON tach, dung gop. Khi user noi "gop 1 block" -> dung code fence rieng cho tung block.

Phong ngua: Hoi user tu dau: "anh muon em tach dong hay gop 1 block?". Nho setting nay cho toan cuoc tro chuyen.

---

### LOI 5.2 - Code fence khong explain ket qua expected

Trieu chung: User chay xong khong biet output dung hay sai, phai hoi lai "xong chua".

Fix: Moi code block phai kem "tieu chi pass": PASS neu thay X, FAIL neu thay Y.

---

### LOI 5.3 - User dung VSCode/editor khong co trong PATH

Trieu chung: Huong dan code file.js -> user bao "code is not recognized".

Fix: Luon co fallback notepad file.js (Windows built-in). Hoac phuong an khong can editor: dung git checkout --theirs/--ours + verify bang syntax check.

---

## TIER 6 - MEMO TONG KET (QUICK REFERENCE)

Khi build Doscom dashboard + deploy tu may user, luon check 10 diem sau:

1. File JS duoc tao bang Write tool (KHONG bash heredoc) - tranh \!
2. PowerShell script dung [System.IO.File]::ReadAllText/WriteAllText cho file tieng Viet
3. KHONG dung Set-Content -NoNewline voi YAML/JSON
4. Huong dan PowerShell co .\ prefix cho file trong cwd
5. Canh bao user ve .git/index.lock neu script co nhieu lenh git
6. Luon cd <full_path> explicit truoc lenh git
7. 2 workflow cung branch phai lech cron + co retry 5 lan
8. Dashboard: matrix filter scope duoc user approve tu dau
9. Column naming ro rang, co tooltip neu la ranking noi bo
10. Pre-commit: chay skill workflow-discipline re-check requirements

---

## CHUA PHAN LOAI (bo sung khi gap loi moi)

Khi gap loi moi chua co trong skill nay, add vao day voi format:
- Ngay:
- Context:
- Trieu chung:
- Nguyen nhan:
- Fix:
- Phong ngua:

---

## REFERENCE - DUNG CHUNG VOI SKILL NAO

- workflow-discipline - BAT BUOC chay truoc moi commit/push de re-check requirements
- anti-laziness - khi output >50 dong code hoac >500 tu, tranh placeholder
- doscom-brand-guidelines - khi dashboard can ap mau/font thuong hieu Doscom