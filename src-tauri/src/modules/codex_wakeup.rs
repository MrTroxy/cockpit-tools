use chrono::{Local, TimeZone};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use crate::models::codex::{CodexAccount, CodexQuota};
use crate::modules::{codex_account, codex_quota, logger};

const MODEL_HOURLY: &str = "codex-hourly";
const MODEL_WEEKLY: &str = "codex-weekly";
const CLI_MODEL: &str = "gpt-5.3-codex";
const CLI_REASONING_LEVEL: &str = "low";
const CLI_REASONING_CONFIG: &str = "model_reasoning_effort=\"low\"";
const DEFAULT_WAKEUP_PROMPT: &str = "Reply with exactly: OK";
const DUPLICATE_WAKEUP_WINDOW_MS: i64 = 8_000;

static LAST_WAKEUP_EXEC_AT: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();

fn wakeup_state() -> &'static Mutex<HashMap<String, i64>> {
    LAST_WAKEUP_EXEC_AT.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeupResponse {
    pub reply: String,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub trace_id: Option<String>,
    pub response_id: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
    pub display_name: String,
    pub model_constant: Option<String>,
    pub recommended: Option<bool>,
}

fn format_reset_time(timestamp: Option<i64>) -> String {
    let Some(ts) = timestamp else {
        return "-".to_string();
    };
    if let Some(local_dt) = Local.timestamp_opt(ts, 0).single() {
        return local_dt.format("%m-%d %H:%M").to_string();
    }
    "-".to_string()
}

fn describe_window_change(
    name: &str,
    old_remaining: Option<i32>,
    new_remaining: i32,
    reset_at: Option<i64>,
) -> String {
    let remaining_text = match old_remaining {
        Some(old) => format!("{}% -> {}%", old, new_remaining),
        None => format!("{}%", new_remaining),
    };
    format!(
        "{} remaining {}, reset {}",
        name,
        remaining_text,
        format_reset_time(reset_at)
    )
}

fn trim_for_log(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut out = value.chars().take(max_chars).collect::<String>();
    out.push_str("...");
    out
}

fn build_reply(
    model: &str,
    old_quota: Option<&CodexQuota>,
    new_quota: Option<&CodexQuota>,
    cli_reply: &str,
) -> String {
    let cli_model_part = format!(
        " Used CLI model {} (reasoning: {}).",
        CLI_MODEL, CLI_REASONING_LEVEL
    );
    let cli_reply_part = if cli_reply.trim().is_empty() {
        String::new()
    } else {
        format!(" Reply: {}", trim_for_log(cli_reply.trim(), 140))
    };

    let Some(new_quota) = new_quota else {
        return format!(
            "Codex wakeup request completed.{}{}",
            cli_model_part, cli_reply_part
        );
    };

    let hourly = describe_window_change(
        "5h",
        old_quota.map(|q| q.hourly_percentage),
        new_quota.hourly_percentage,
        new_quota.hourly_reset_time,
    );
    let weekly = describe_window_change(
        "Weekly",
        old_quota.map(|q| q.weekly_percentage),
        new_quota.weekly_percentage,
        new_quota.weekly_reset_time,
    );

    match model {
        MODEL_HOURLY => format!(
            "Codex wakeup completed. {}.{}{}",
            hourly, cli_model_part, cli_reply_part
        ),
        MODEL_WEEKLY => format!(
            "Codex wakeup completed. {}.{}{}",
            weekly, cli_model_part, cli_reply_part
        ),
        _ => format!(
            "Codex wakeup completed. {} | {}.{}{}",
            hourly, weekly, cli_model_part, cli_reply_part
        ),
    }
}

fn next_temp_home_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir().join("cockpit-tools-codex-wakeup");
    fs::create_dir_all(&base).map_err(|e| format!("Failed to create temp wakeup base dir: {}", e))?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to get system time: {}", e))?
        .as_nanos();
    let folder = format!("session-{}-{}", std::process::id(), nanos);
    let path = base.join(folder);
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create temp wakeup dir: {}", e))?;
    Ok(path)
}

fn add_candidate(list: &mut Vec<PathBuf>, seen: &mut std::collections::HashSet<String>, path: PathBuf) {
    let key = path.to_string_lossy().to_string().to_lowercase();
    if seen.insert(key) {
        list.push(path);
    }
}

fn codex_cli_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(custom) = std::env::var("CODEX_CLI_PATH") {
        if !custom.trim().is_empty() {
            add_candidate(&mut candidates, &mut seen, PathBuf::from(custom.trim()));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_dir = PathBuf::from(appdata).join("npm");
            add_candidate(&mut candidates, &mut seen, npm_dir.join("codex.cmd"));
            add_candidate(&mut candidates, &mut seen, npm_dir.join("codex.bat"));
            add_candidate(&mut candidates, &mut seen, npm_dir.join("codex.exe"));
            add_candidate(&mut candidates, &mut seen, npm_dir.join("codex"));
        }

        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local_appdata);
            add_candidate(
                &mut candidates,
                &mut seen,
                local.join("Programs").join("Codex").join("codex.exe"),
            );
            add_candidate(
                &mut candidates,
                &mut seen,
                local.join("Programs").join("codex").join("codex.exe"),
            );
        }
    }

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            #[cfg(target_os = "windows")]
            {
                add_candidate(&mut candidates, &mut seen, dir.join("codex.cmd"));
                add_candidate(&mut candidates, &mut seen, dir.join("codex.bat"));
                add_candidate(&mut candidates, &mut seen, dir.join("codex.exe"));
                add_candidate(&mut candidates, &mut seen, dir.join("codex"));
            }
            #[cfg(not(target_os = "windows"))]
            {
                add_candidate(&mut candidates, &mut seen, dir.join("codex"));
            }
        }
    }

    candidates
}

fn resolve_codex_cli_path() -> Result<PathBuf, String> {
    let candidates = codex_cli_candidates();
    for candidate in &candidates {
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }

    let preview = candidates
        .iter()
        .take(12)
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Codex CLI executable not found. Checked paths: {}",
        if preview.is_empty() { "<none>".to_string() } else { preview }
    ))
}

#[cfg(target_os = "windows")]
fn command_for_executable(executable: &Path) -> Command {
    let ext = executable
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if ext == "cmd" || ext == "bat" {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(executable);
        return command;
    }
    Command::new(executable)
}

#[cfg(not(target_os = "windows"))]
fn command_for_executable(executable: &Path) -> Command {
    Command::new(executable)
}

fn read_last_message(path: &PathBuf, stdout: &str) -> String {
    if let Ok(content) = fs::read_to_string(path) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    stdout
        .lines()
        .map(|line| line.trim())
        .rev()
        .find(|line| !line.is_empty() && *line != "tokens used")
        .unwrap_or("Wakeup request sent.")
        .to_string()
}

fn run_codex_wakeup_cli(account: &CodexAccount, prompt: &str) -> Result<String, String> {
    let temp_home = next_temp_home_dir()?;
    let output_file = temp_home.join("last_message.txt");
    let codex_cli = resolve_codex_cli_path()?;

    let run_result = (|| -> Result<String, String> {
        codex_account::write_auth_file_to_dir(&temp_home, account)?;

        logger::log_info(&format!(
            "[CodexWakeup] Using Codex CLI binary: {}",
            codex_cli.display()
        ));

        let mut command = command_for_executable(&codex_cli);
        command
            .arg("exec")
            .arg("-m")
            .arg(CLI_MODEL)
            .arg("-c")
            .arg(CLI_REASONING_CONFIG)
            .arg("--skip-git-repo-check")
            .arg("--color")
            .arg("never")
            .arg("--output-last-message")
            .arg(&output_file);
        if let Ok(cwd) = std::env::current_dir() {
            command.arg("-C").arg(cwd);
        }
        command.arg(prompt);
        command.env("CODEX_HOME", &temp_home);
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                let npm_dir = PathBuf::from(appdata).join("npm");
                if npm_dir.exists() {
                    let mut path_entries = vec![npm_dir];
                    if let Some(current_path) = std::env::var_os("PATH") {
                        path_entries.extend(std::env::split_paths(&current_path));
                    }
                    if let Ok(joined) = std::env::join_paths(path_entries) {
                        command.env("PATH", joined);
                    }
                }
            }
        }

        let output = command
            .output()
            .map_err(|e| {
                format!(
                    "Failed to launch codex CLI wakeup (binary={}): {}",
                    codex_cli.display(),
                    e
                )
            })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            let code = output
                .status
                .code()
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let details = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(format!(
                "Codex CLI wakeup failed (exit={}): {}",
                code,
                trim_for_log(details, 500)
            ));
        }

        Ok(read_last_message(&output_file, &stdout))
    })();

    if let Err(e) = fs::remove_dir_all(&temp_home) {
        logger::log_warn(&format!(
            "[CodexWakeup] Failed to cleanup temp CODEX_HOME {}: {}",
            temp_home.display(),
            e
        ));
    }

    run_result
}

fn try_reserve_wakeup(account_id: &str) -> bool {
    let now = chrono::Utc::now().timestamp_millis();
    let mut guard = wakeup_state().lock().expect("codex wakeup state lock");
    if let Some(last) = guard.get(account_id) {
        if now - *last < DUPLICATE_WAKEUP_WINDOW_MS {
            return false;
        }
    }
    guard.insert(account_id.to_string(), now);
    true
}

fn release_wakeup_reservation(account_id: &str) {
    let mut guard = wakeup_state().lock().expect("codex wakeup state lock");
    guard.remove(account_id);
}

pub async fn trigger_wakeup(
    account_id: &str,
    model: &str,
    prompt: &str,
    _max_output_tokens: u32,
) -> Result<WakeupResponse, String> {
    let account = codex_account::load_account(account_id)
        .ok_or_else(|| format!("Codex account not found: {}", account_id))?;

    let old_quota = account.quota.clone();
    let started = std::time::Instant::now();

    logger::log_info(&format!(
        "[CodexWakeup] Starting wakeup: email={}, window={}",
        account.email, model
    ));

    let final_prompt = if prompt.trim().is_empty() {
        DEFAULT_WAKEUP_PROMPT.to_string()
    } else {
        prompt.trim().to_string()
    };

    let cli_reply = if try_reserve_wakeup(account_id) {
        let account_for_cli = account.clone();
        let prompt_for_cli = final_prompt.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            run_codex_wakeup_cli(&account_for_cli, &prompt_for_cli)
        })
        .await
        {
            Ok(Ok(reply)) => reply,
            Ok(Err(err)) => {
                release_wakeup_reservation(account_id);
                return Err(err);
            }
            Err(join_err) => {
                release_wakeup_reservation(account_id);
                return Err(format!(
                    "Codex wakeup background task failed: {}",
                    join_err
                ));
            }
        }
    } else {
        logger::log_info(&format!(
            "[CodexWakeup] Skipping duplicate wakeup call: email={}, window={}",
            account.email, model
        ));
        "Skipped duplicate wakeup request (recently executed for this account).".to_string()
    };

    let new_quota = match codex_quota::refresh_account_quota(account_id).await {
        Ok(quota) => Some(quota),
        Err(err) => {
            logger::log_warn(&format!(
                "[CodexWakeup] Quota refresh failed after wakeup: email={}, error={}",
                account.email, err
            ));
            None
        }
    };
    let duration_ms = started.elapsed().as_millis() as u64;
    let reply = build_reply(model, old_quota.as_ref(), new_quota.as_ref(), &cli_reply);

    logger::log_info(&format!(
        "[CodexWakeup] Wakeup completed: email={}, window={}, duration={}ms",
        account.email, model, duration_ms
    ));

    Ok(WakeupResponse {
        reply,
        prompt_tokens: None,
        completion_tokens: None,
        total_tokens: None,
        trace_id: None,
        response_id: None,
        duration_ms,
    })
}

pub async fn fetch_available_models() -> Result<Vec<AvailableModel>, String> {
    Ok(vec![
        AvailableModel {
            id: MODEL_HOURLY.to_string(),
            display_name: "5h Window".to_string(),
            model_constant: Some("hourly".to_string()),
            recommended: Some(true),
        },
        AvailableModel {
            id: MODEL_WEEKLY.to_string(),
            display_name: "Weekly Window".to_string(),
            model_constant: Some("weekly".to_string()),
            recommended: Some(true),
        },
    ])
}
