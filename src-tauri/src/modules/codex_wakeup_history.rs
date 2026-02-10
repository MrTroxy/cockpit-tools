use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::modules;

const HISTORY_FILE: &str = "codex_wakeup_history.json";
const MAX_HISTORY_ITEMS: usize = 100;

static HISTORY_LOCK: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeupHistoryItem {
    pub id: String,
    pub timestamp: i64,
    pub trigger_type: String,
    pub trigger_source: String,
    pub task_name: Option<String>,
    pub account_email: String,
    pub model_id: String,
    pub prompt: Option<String>,
    pub success: bool,
    pub message: Option<String>,
    pub duration: Option<u64>,
}

fn history_path() -> Result<PathBuf, String> {
    let data_dir = modules::account::get_data_dir()?;
    Ok(data_dir.join(HISTORY_FILE))
}

pub fn load_history() -> Result<Vec<WakeupHistoryItem>, String> {
    let path = history_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read Codex wakeup history: {}", e))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    let items: Vec<WakeupHistoryItem> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Codex wakeup history: {}", e))?;
    Ok(items)
}

fn save_history(items: &[WakeupHistoryItem]) -> Result<(), String> {
    let path = history_path()?;
    let data_dir = modules::account::get_data_dir()?;
    let temp_path = data_dir.join(format!("{}.tmp", HISTORY_FILE));

    let content = serde_json::to_string_pretty(items)
        .map_err(|e| format!("Failed to serialize Codex wakeup history: {}", e))?;
    fs::write(&temp_path, content).map_err(|e| format!("Failed to write temporary history file: {}", e))?;
    fs::rename(temp_path, path).map_err(|e| format!("Failed to replace history file: {}", e))
}

pub fn add_history_items(new_items: Vec<WakeupHistoryItem>) -> Result<(), String> {
    if new_items.is_empty() {
        return Ok(());
    }

    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "Failed to acquire Codex wakeup history lock")?;
    let mut existing = load_history().unwrap_or_default();
    let existing_ids: std::collections::HashSet<String> =
        existing.iter().map(|item| item.id.clone()).collect();

    let filtered_new: Vec<WakeupHistoryItem> = new_items
        .into_iter()
        .filter(|item| !existing_ids.contains(&item.id))
        .collect();
    if filtered_new.is_empty() {
        return Ok(());
    }

    let added_count = filtered_new.len();
    let mut merged = filtered_new;
    merged.append(&mut existing);
    merged.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    merged.truncate(MAX_HISTORY_ITEMS);

    save_history(&merged)?;
    modules::logger::log_info(&format!(
        "[CodexWakeup] History updated: added={}, total={}",
        added_count,
        merged.len()
    ));
    Ok(())
}

pub fn clear_history() -> Result<(), String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "Failed to acquire Codex wakeup history lock")?;
    save_history(&[])?;
    modules::logger::log_info("[CodexWakeup] History cleared");
    Ok(())
}
