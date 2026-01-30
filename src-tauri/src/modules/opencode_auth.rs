use crate::models::codex::CodexAccount;
use crate::modules::{codex_account, codex_oauth, logger};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::json;
use std::fs;
use std::path::PathBuf;

/// 获取 OpenCode 的 auth.json 路径
///
/// - macOS/Linux: $XDG_DATA_HOME/opencode/auth.json 或 ~/.local/share/opencode/auth.json
pub fn get_opencode_auth_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;

    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.trim().is_empty() {
            return Ok(PathBuf::from(xdg).join("opencode").join("auth.json"));
        }
    }

    Ok(home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json"))
}

fn atomic_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("无法获取 auth.json 目录")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;

    let tmp_path = parent.join(format!(
        ".auth.json.tmp.{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    fs::write(&tmp_path, content).map_err(|e| format!("写入临时文件失败: {}", e))?;

    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp_path, path).map_err(|e| format!("替换 auth.json 失败: {}", e))?;
    Ok(())
}

fn build_openai_payload(account: &CodexAccount) -> serde_json::Value {
    let mut payload = json!({
        "type": "oauth",
        "access": account.tokens.access_token,
    });

    if let Some(refresh) = account.tokens.refresh_token.clone() {
        payload["refresh"] = json!(refresh);
    }

    if let Some(expires) = decode_token_exp_ms(&account.tokens.access_token) {
        payload["expires"] = json!(expires);
    }

    let fallback_account_id = extract_chatgpt_account_id(&account.tokens.access_token);
    if let Some(account_id) = account.account_id.clone().or(fallback_account_id) {
        payload["accountId"] = json!(account_id);
    }

    payload
}

fn decode_token_exp_ms(access_token: &str) -> Option<i64> {
    let payload = codex_account::decode_jwt_payload(access_token).ok()?;
    payload.exp.map(|exp| exp * 1000)
}

fn extract_chatgpt_account_id(access_token: &str) -> Option<String> {
    let payload = decode_jwt_payload_value(access_token)?;
    let auth_data = payload.get("https://api.openai.com/auth")?;
    if let Some(value) = auth_data.get("chatgpt_account_id").and_then(|v| v.as_str()) {
        return Some(value.to_string());
    }
    if let Some(value) = auth_data.get("account_id").and_then(|v| v.as_str()) {
        return Some(value.to_string());
    }
    None
}

fn decode_jwt_payload_value(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let payload_bytes = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    let payload_str = String::from_utf8(payload_bytes).ok()?;
    serde_json::from_str(&payload_str).ok()
}

/// 使用 Codex 账号的 token 替换 OpenCode auth.json 中的 openai 记录
pub fn replace_openai_entry_from_codex(account: &CodexAccount) -> Result<(), String> {
    // 确保 token 未过期
    if codex_oauth::is_token_expired(&account.tokens.access_token) {
        return Err("Codex access_token 已过期，无法同步到 OpenCode".to_string());
    }

    let auth_path = get_opencode_auth_json_path()?;
    let mut auth_json = if auth_path.exists() {
        let content = fs::read_to_string(&auth_path)
            .map_err(|e| format!("读取 OpenCode auth.json 失败: {}", e))?;
        serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("解析 OpenCode auth.json 失败: {}", e))?
    } else {
        json!({})
    };

    if !auth_json.is_object() {
        auth_json = json!({});
    }

    let openai_payload = build_openai_payload(account);
    if let Some(map) = auth_json.as_object_mut() {
        map.insert("openai".to_string(), openai_payload);
    }

    let content = serde_json::to_string_pretty(&auth_json)
        .map_err(|e| format!("序列化 OpenCode auth.json 失败: {}", e))?;
    atomic_write(&auth_path, &content)?;

    logger::log_info("已更新 OpenCode auth.json 中的 openai 记录");
    Ok(())
}
