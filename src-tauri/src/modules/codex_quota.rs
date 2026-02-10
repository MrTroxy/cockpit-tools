use crate::models::codex::{CodexQuota, CodexAccount};
use crate::modules::{codex_account, logger};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ACCEPT};
use serde::{Deserialize, Serialize};

// Uses the same usage endpoint as Quotio.
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

/// Usage window metadata (5-hour / weekly).
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
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        // Truncate large response body to keep logs short.
        let body_preview = if body.len() > 200 { &body[..200] } else { &body };
        return Err(format!("API returned {} - {}", status, body_preview));
    }
    
    let body = response.text().await
        .map_err(|e| format!("Failed to read quota response body: {}", e))?;
    
    logger::log_info(&format!("Codex quota response: {}", &body[..body.len().min(500)]));
    
    // Parse response.
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
                    logger::log_error(&format!("Token refresh failed for {}: {}", account.email, e));
                    return Err(format!("Token expired and refresh failed: {}", e));
                }
            }
        } else {
            return Err("Token expired and no refresh_token is available".to_string());
        }
    }
    
    let quota = fetch_quota(&account).await?;
    
    account.quota = Some(quota.clone());
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
