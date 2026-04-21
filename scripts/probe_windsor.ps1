# Probe Windsor.ai JSON API — kiểm tra free trial có cap field ở API không.
# Usage: .\scripts\probe_windsor.ps1

$key = $env:WINDSOR_API_KEY
if (-not $key) { $key = Read-Host "Paste WINDSOR_API_KEY" }
if (-not $key) { Write-Host "[FATAL] No API key"; exit 1 }

function Probe-Windsor {
    param([string]$Label, [string]$Fields, [string]$Key)

    Write-Host ""
    Write-Host ("=" * 60)
    Write-Host "TEST: $Label"
    $count = ($Fields -split ",").Count
    Write-Host "Fields ($count): $Fields"
    Write-Host ("=" * 60)

    $url = "https://connectors.windsor.ai/all?api_key=$Key&date_preset=last_7d&fields=$Fields"
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60
    } catch {
        Write-Host "[HTTP ERROR] $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Host "Response body: $($body.Substring(0, [Math]::Min(500, $body.Length)))"
        }
        return
    }

    $raw = $response.Content
    Write-Host ""
    Write-Host "--- Raw response (500 chars đầu) ---"
    Write-Host $raw.Substring(0, [Math]::Min(500, $raw.Length))

    try {
        $data = $raw | ConvertFrom-Json
    } catch {
        Write-Host "[JSON PARSE ERROR] $($_.Exception.Message)"
        return
    }

    Write-Host ""
    Write-Host "--- Parsed ---"
    Write-Host "Type: $($data.GetType().Name)"

    if ($data -is [Array]) {
        Write-Host "Rows: $($data.Count)"
        if ($data.Count -gt 0) {
            $fieldsInRow = $data[0].PSObject.Properties.Name
            Write-Host "Fields có trong row[0] ($($fieldsInRow.Count)): $($fieldsInRow -join ', ')"
            Write-Host "Row[0] sample:"
            $data[0] | ConvertTo-Json -Depth 3 -Compress | Write-Host
        }
        return
    }

    # Object → kiểm tra wrapper
    $topKeys = $data.PSObject.Properties.Name
    Write-Host "Top-level keys: $($topKeys -join ', ')"

    foreach ($wrapper in 'data', 'result', 'rows') {
        if ($topKeys -contains $wrapper) {
            $rows = $data.$wrapper
            if ($rows -is [Array]) {
                Write-Host "Unwrap key='$wrapper' -> $($rows.Count) rows"
                if ($rows.Count -gt 0) {
                    $fieldsInRow = $rows[0].PSObject.Properties.Name
                    Write-Host "Fields có trong row[0] ($($fieldsInRow.Count)): $($fieldsInRow -join ', ')"
                    Write-Host "Row[0] sample:"
                    $rows[0] | ConvertTo-Json -Depth 3 -Compress | Write-Host
                }
                return
            }
        }
    }

    Write-Host "Không có wrapper chuẩn. Raw object:"
    $data | ConvertTo-Json -Depth 3 | Write-Host
}

Probe-Windsor "Baseline 7 fields (pipeline hiện tại)" `
    "account_name,campaign,date,spend,clicks,impressions,datasource" $key

Probe-Windsor "9 fields (them search_term + conversions)" `
    "account_name,campaign,date,spend,clicks,impressions,datasource,search_term,conversions" $key

Probe-Windsor "11 fields (them match_type + status)" `
    "account_name,campaign,date,spend,clicks,impressions,datasource,search_term,conversions,search_term_match_type,search_term_view_status" $key

# Test 4 — RSA Headlines + Description
Probe-Windsor "RSA ad copy (headlines + descriptions)" `
    "account_name,campaign,date,spend,clicks,impressions,ad_responsive_search_ad_headlines,ad_text_ad_description1,ad_text_ad_description2" $key

# Test 5 — GDN Placement
Probe-Windsor "GDN placement + network type" `
    "account_name,campaign,date,spend,clicks,impressions,placement,placement_type,ad_network_type" $key

# Test 6 — Biến thể tên field (nếu Test 4-5 fail)
Probe-Windsor "Biến thể: responsive_search_ad_headlines (không prefix ad_)" `
    "account_name,campaign,date,spend,clicks,responsive_search_ad_headlines" $key

# Test 7 — RSA ad level (thêm ad_id + ad_name + ad_group_name)
Probe-Windsor "RSA headlines AD LEVEL" `
    "account_name,campaign,ad_group_name,ad_id,ad_name,date,spend,clicks,impressions,ad_responsive_search_ad_headlines,ad_text_ad_description1" $key

# Test 8 — Asset level (dùng asset_*)
Probe-Windsor "Asset level (asset_text, asset_type, asset_name)" `
    "account_name,campaign,ad_group_name,date,spend,clicks,impressions,asset_id,asset_name,asset_type,asset_source" $key
