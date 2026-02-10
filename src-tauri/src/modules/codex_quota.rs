use crate::models::codex::{CodexAccount, CodexQuota, CodexQuotaErrorInfo};
use crate::modules::{codex_account, logger};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ACCEPT};
use serde::{Deserialize, Serialize};

// Uses the same usage endpoint as Quotio.
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

fn get_header_value(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-")
        .to_string()
}

fn extract_detail_code_from_body(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;

    if let Some(code) = value
        .get("detail")
        .and_then(|detail| detail.get("code"))
        .and_then(|code| code.as_str())
    {
        return Some(code.to_string());
    }

    if let Some(code) = value.get("code").and_then(|code| code.as_str()) {
        return Some(code.to_string());
    }

    None
}

fn extract_error_code_from_message(message: &str) -> Option<String> {
    let marker = "[error_code:";
    let start = message.find(marker)?;
    let code_start = start + marker.len();
    let end = message[code_start..].find(']')?;
    Some(message[code_start..code_start + end].to_string())
}

fn write_quota_error(account: &mut CodexAccount, message: String) {
    account.quota_error = Some(CodexQuotaErrorInfo {
        code: extract_error_code_from_message(&message),
        message,
        timestamp: chrono::Utc::now().timestamp(),
    });
}

/// 使用率窗口（5小时/周）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowInfo {
    #[serde(rename = "used_percent")]
    used_percent: Option<i32>,
    #[serde(rename = "limit_window_seconds")]
    limit_window_seconds: Option<i64>,
    #[serde(rename = "reset_after_seconds")]
    reset_after_seconds: Option<i64>,
    #[serde(rename = "reset_at")]
    reset_at: Option<i64>,
}

/// Rate limit info.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RateLimitInfo {
    allowed: Option<bool>,
    #[serde(rename = "limit_reached")]
    limit_reached: Option<bool>,
    #[serde(rename = "primary_window")]
    primary_window: Option<WindowInfo>,
    #[serde(rename = "secondary_window")]
    secondary_window: Option<WindowInfo>,
}

/// Usage response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UsageResponse {
    #[serde(rename = "plan_type")]
    plan_type: Option<String>,
    #[serde(rename = "rate_limit")]
    rate_limit: Option<RateLimitInfo>,
    #[serde(rename = "code_review_rate_limit")]
    code_review_rate_limit: Option<RateLimitInfo>,
}

/// Fetches quota for one account.
pub async fn fetch_quota(account: &CodexAccount) -> Result<CodexQuota, String> {
    let client = reqwest::Client::new();
    
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", account.tokens.access_token))
            .map_err(|e| format!("Failed to build Authorization header: {}", e))?,
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    
    // Add ChatGPT-Account-Id header when available.
    let account_id = account
        .account_id
        .clone()
        .or_else(|| codex_account::extract_chatgpt_account_id_from_access_token(&account.tokens.access_token));
    
    if let Some(ref acc_id) = account_id {
        if !acc_id.is_empty() {
            headers.insert(
                "ChatGPT-Account-Id",
                HeaderValue::from_str(acc_id)
                    .map_err(|e| format!("Failed to build ChatGPT-Account-Id header: {}", e))?,
            );
        }
    }
    
    logger::log_info(&format!("Codex quota request: {} (account_id: {:?})", USAGE_URL, account_id));
    
    let response = client
        .get(USAGE_URL)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Quota request failed: {}", e))?;
    
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let request_id = get_header_value(&headers, "request-id");
    let x_request_id = get_header_value(&headers, "x-request-id");
    let cf_ray = get_header_value(&headers, "cf-ray");
    let body_len = body.len();

    logger::log_info(&format!(
        "Codex 配额响应元信息: url={}, status={}, request-id={}, x-request-id={}, cf-ray={}, body_len={}",
        USAGE_URL, status, request_id, x_request_id, cf_ray, body_len
    ));

    if !status.is_success() {
        let detail_code = extract_detail_code_from_body(&body);

        logger::log_error(&format!(
            "Codex 配额接口返回非成功状态: url={}, status={}, request-id={}, x-request-id={}, cf-ray={}, detail_code={:?}, body={}",
            USAGE_URL, status, request_id, x_request_id, cf_ray, detail_code, body
        ));

        let body_preview = if body.len() > 200 { &body[..200] } else { &body };
        let mut error_message = format!("API 返回错误 {}", status);
        if let Some(code) = detail_code {
            error_message.push_str(&format!(" [error_code:{}]", code));
        }
        error_message.push_str(&format!(" - {}", body_preview));
        return Err(error_message);
    }
    
    // 解析响应
    let usage: UsageResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse quota JSON: {}", e))?;
    
    parse_quota_from_usage(&usage, &body)
}

/// Parses quota from usage response.
fn parse_quota_from_usage(usage: &UsageResponse, raw_body: &str) -> Result<CodexQuota, String> {
    let rate_limit = usage.rate_limit.as_ref();
    
    // Primary window = 5-hour quota.
    let (hourly_percentage, hourly_reset_time) = if let Some(primary) = rate_limit.and_then(|r| r.primary_window.as_ref()) {
        let used = primary.used_percent.unwrap_or(0);
        let remaining = 100 - used;
        let reset_at = primary.reset_at;
        (remaining, reset_at)
    } else {
        (100, None)
    };
    
    // Secondary window = weekly quota.
    let (weekly_percentage, weekly_reset_time) = if let Some(secondary) = rate_limit.and_then(|r| r.secondary_window.as_ref()) {
        let used = secondary.used_percent.unwrap_or(0);
        let remaining = 100 - used;
        let reset_at = secondary.reset_at;
        (remaining, reset_at)
    } else {
        (100, None)
    };
    
    // Preserve raw payload.
    let raw_data: Option<serde_json::Value> = serde_json::from_str(raw_body).ok();
    
    Ok(CodexQuota {
        hourly_percentage,
        hourly_reset_time,
        weekly_percentage,
        weekly_reset_time,
        raw_data,
    })
}

/// Refreshes one account quota and persists it (includes token auto-refresh).
pub async fn refresh_account_quota(account_id: &str) -> Result<CodexQuota, String> {
    let mut account = codex_account::load_account(account_id)
        .ok_or_else(|| format!("Account not found: {}", account_id))?;
    
    // Refresh token before quota call if needed.
    if crate::modules::codex_oauth::is_token_expired(&account.tokens.access_token) {
        logger::log_info(&format!("Token expired for {}, attempting refresh", account.email));
        
        if let Some(ref refresh_token) = account.tokens.refresh_token {
            match crate::modules::codex_oauth::refresh_access_token(refresh_token).await {
                Ok(new_tokens) => {
                    logger::log_info(&format!("Token refresh succeeded for {}", account.email));
                    account.tokens = new_tokens;
                    codex_account::save_account(&account)?;
                }
                Err(e) => {
                    logger::log_error(&format!("账号 {} Token 刷新失败: {}", account.email, e));
                    let message = format!("Token 已过期且刷新失败: {}", e);
                    write_quota_error(&mut account, message.clone());
                    if let Err(save_err) = codex_account::save_account(&account) {
                        logger::log_warn(&format!("写入 Codex 配额错误失败: {}", save_err));
                    }
                    return Err(message);
                }
            }
        } else {
            let message = "Token 已过期且无 refresh_token".to_string();
            write_quota_error(&mut account, message.clone());
            if let Err(save_err) = codex_account::save_account(&account) {
                logger::log_warn(&format!("写入 Codex 配额错误失败: {}", save_err));
            }
            return Err(message);
        }
    }

    let quota = match fetch_quota(&account).await {
        Ok(quota) => quota,
        Err(e) => {
            write_quota_error(&mut account, e.clone());
            if let Err(save_err) = codex_account::save_account(&account) {
                logger::log_warn(&format!("写入 Codex 配额错误失败: {}", save_err));
            }
            return Err(e);
        }
    };

    account.quota = Some(quota.clone());
    account.quota_error = None;
    codex_account::save_account(&account)?;
    
    Ok(quota)
}

/// Refreshes quota for all accounts.
pub async fn refresh_all_quotas() -> Result<Vec<(String, Result<CodexQuota, String>)>, String> {
    let accounts = codex_account::list_accounts();
    let mut results = Vec::new();
    
    for account in accounts {
        let result = refresh_account_quota(&account.id).await;
        results.push((account.id.clone(), result));
    }
    
    Ok(results)
}
