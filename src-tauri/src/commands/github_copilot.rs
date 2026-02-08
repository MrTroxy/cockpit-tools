use tauri::AppHandle;

use crate::models::github_copilot::{GitHubCopilotAccount, GitHubCopilotOAuthStartResponse};
use crate::modules::{github_copilot_account, github_copilot_oauth, logger};

/// 列出所有 GitHub Copilot 账号
#[tauri::command]
pub fn list_github_copilot_accounts() -> Result<Vec<GitHubCopilotAccount>, String> {
    Ok(github_copilot_account::list_accounts())
}

/// 删除 GitHub Copilot 账号
#[tauri::command]
pub fn delete_github_copilot_account(account_id: String) -> Result<(), String> {
    github_copilot_account::remove_account(&account_id)
}

/// 批量删除 GitHub Copilot 账号
#[tauri::command]
pub fn delete_github_copilot_accounts(account_ids: Vec<String>) -> Result<(), String> {
    github_copilot_account::remove_accounts(&account_ids)
}

/// 从 JSON 字符串导入 GitHub Copilot 账号
#[tauri::command]
pub fn import_github_copilot_from_json(json_content: String) -> Result<Vec<GitHubCopilotAccount>, String> {
    github_copilot_account::import_from_json(&json_content)
}

/// 导出 GitHub Copilot 账号为 JSON
#[tauri::command]
pub fn export_github_copilot_accounts(account_ids: Vec<String>) -> Result<String, String> {
    github_copilot_account::export_accounts(&account_ids)
}

/// 刷新单个账号 Copilot token/配额信息（GitHub API）
#[tauri::command]
pub async fn refresh_github_copilot_token(_app: AppHandle, account_id: String) -> Result<GitHubCopilotAccount, String> {
    github_copilot_account::refresh_account_token(&account_id).await
}

/// 刷新所有账号 Copilot token/配额信息（GitHub API）
#[tauri::command]
pub async fn refresh_all_github_copilot_tokens(_app: AppHandle) -> Result<i32, String> {
    let results = github_copilot_account::refresh_all_tokens().await?;
    let success_count = results.iter().filter(|(_, r)| r.is_ok()).count();
    Ok(success_count as i32)
}

/// OAuth（Device Flow）：开始登录（返回 user_code + verification_uri 等）
#[tauri::command]
pub async fn github_copilot_oauth_login_start() -> Result<GitHubCopilotOAuthStartResponse, String> {
    logger::log_info("GitHub Copilot OAuth start 命令触发");
    let response = github_copilot_oauth::start_login().await?;
    logger::log_info(&format!(
        "GitHub Copilot OAuth start 命令成功: login_id={}",
        response.login_id
    ));
    Ok(response)
}

/// OAuth（Device Flow）：轮询并完成登录（返回保存后的账号）
#[tauri::command]
pub async fn github_copilot_oauth_login_complete(login_id: String) -> Result<GitHubCopilotAccount, String> {
    logger::log_info(&format!(
        "GitHub Copilot OAuth complete 命令触发: login_id={}",
        login_id
    ));
    let payload = github_copilot_oauth::complete_login(&login_id).await?;
    let account = github_copilot_account::upsert_account(payload)?;
    logger::log_info(&format!(
        "GitHub Copilot OAuth complete 成功: account_id={}, login={}",
        account.id, account.github_login
    ));
    Ok(account)
}

/// OAuth（Device Flow）：取消登录（login_id 为空时取消当前流程）
#[tauri::command]
pub fn github_copilot_oauth_login_cancel(login_id: Option<String>) -> Result<(), String> {
    logger::log_info(&format!(
        "GitHub Copilot OAuth cancel 命令触发: login_id={}",
        login_id.as_deref().unwrap_or("<none>")
    ));
    github_copilot_oauth::cancel_login(login_id.as_deref())
}

/// 通过 GitHub access token 添加账号（会自动拉取 Copilot token/user 信息）
#[tauri::command]
pub async fn add_github_copilot_account_with_token(github_access_token: String) -> Result<GitHubCopilotAccount, String> {
    let payload = github_copilot_oauth::build_payload_from_github_access_token(&github_access_token).await?;
    let account = github_copilot_account::upsert_account(payload)?;
    Ok(account)
}

/// 更新账号标签
#[tauri::command]
pub async fn update_github_copilot_account_tags(account_id: String, tags: Vec<String>) -> Result<GitHubCopilotAccount, String> {
    github_copilot_account::update_account_tags(&account_id, tags)
}

/// 返回 GitHub Copilot 账号索引文件路径（便于排障/查看）
#[tauri::command]
pub fn get_github_copilot_accounts_index_path() -> Result<String, String> {
    github_copilot_account::accounts_index_path_string()
}

