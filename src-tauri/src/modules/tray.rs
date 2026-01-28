//! 系统托盘模块
//! 管理系统托盘图标和菜单

use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime,
};
use tracing::info;

use crate::modules::logger;

/// 托盘菜单 ID
pub const TRAY_ID: &str = "main-tray";

/// 菜单项 ID
pub mod menu_ids {
    pub const SHOW_WINDOW: &str = "show_window";
    pub const REFRESH_QUOTA: &str = "refresh_quota";
    pub const SETTINGS: &str = "settings";
    pub const QUIT: &str = "quit";
}

/// 创建系统托盘
pub fn create_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<TrayIcon<R>, tauri::Error> {
    info!("[Tray] 正在创建系统托盘...");
    
    let menu = build_tray_menu(app)?;
    
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Cockpit Tools")
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;
    
    info!("[Tray] 系统托盘创建成功");
    Ok(tray)
}

/// 构建托盘菜单
fn build_tray_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    // 获取当前语言
    let config = crate::modules::config::get_user_config();
    let lang = &config.language;
    
    // 获取账号信息（暂时使用占位符，后续动态更新）
    let (ag_info, codex_info) = get_account_display_info();
    
    // 创建菜单项
    let show_window = MenuItem::with_id(
        app,
        menu_ids::SHOW_WINDOW,
        get_text("show_window", lang),
        true,
        None::<&str>,
    )?;
    
    let refresh_quota = MenuItem::with_id(
        app,
        menu_ids::REFRESH_QUOTA,
        get_text("refresh_quota", lang),
        true,
        None::<&str>,
    )?;
    
    let settings = MenuItem::with_id(
        app,
        menu_ids::SETTINGS,
        get_text("settings", lang),
        true,
        None::<&str>,
    )?;
    
    let quit = MenuItem::with_id(
        app,
        menu_ids::QUIT,
        get_text("quit", lang),
        true,
        None::<&str>,
    )?;
    
    // Antigravity 子菜单
    let mut ag_items: Vec<MenuItem<R>> = Vec::new();
    ag_items.push(MenuItem::with_id(
        app,
        "ag_account",
        ag_info.account,
        true,
        None::<&str>,
    )?);
    for (idx, line) in ag_info.quota_lines.iter().enumerate() {
        ag_items.push(MenuItem::with_id(
            app,
            format!("ag_quota_{}", idx),
            line,
            true,
            None::<&str>,
        )?);
    }
    let ag_refs: Vec<&dyn IsMenuItem<R>> = ag_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect();
    let ag_submenu = Submenu::with_id_and_items(
        app,
        "antigravity_submenu",
        "Antigravity",
        true,
        &ag_refs,
    )?;
    
    // Codex 子菜单
    let mut codex_items: Vec<MenuItem<R>> = Vec::new();
    codex_items.push(MenuItem::with_id(
        app,
        "codex_account",
        codex_info.account,
        true,
        None::<&str>,
    )?);
    for (idx, line) in codex_info.quota_lines.iter().enumerate() {
        codex_items.push(MenuItem::with_id(
            app,
            format!("codex_quota_{}", idx),
            line,
            true,
            None::<&str>,
        )?);
    }
    let codex_refs: Vec<&dyn IsMenuItem<R>> = codex_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect();
    let codex_submenu = Submenu::with_id_and_items(
        app,
        "codex_submenu",
        "Codex",
        true,
        &codex_refs,
    )?;
    
    // 构建完整菜单
    let menu = Menu::with_id_and_items(
        app,
        "tray_menu",
        &[
            &show_window,
            &PredefinedMenuItem::separator(app)?,
            &ag_submenu,
            &codex_submenu,
            &PredefinedMenuItem::separator(app)?,
            &refresh_quota,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    
    Ok(menu)
}

/// 账号显示信息
struct AccountDisplayInfo {
    account: String,
    quota_lines: Vec<String>,
}

/// 获取账号显示信息
fn get_account_display_info() -> (AccountDisplayInfo, AccountDisplayInfo) {
    let config = crate::modules::config::get_user_config();
    let lang = &config.language;
    
    // 获取 Antigravity 当前账号
    let ag_info = match crate::modules::account::get_current_account() {
        Ok(Some(account)) => {
            let quota_lines = if let Some(quota) = &account.quota {
                build_model_quota_lines(lang, &quota.models)
            } else {
                vec![get_text("loading", lang)]
            };

            AccountDisplayInfo {
                account: format!("📧 {}", account.email),
                quota_lines,
            }
        }
        _ => AccountDisplayInfo {
            account: format!("📧 {}", get_text("not_logged_in", lang)),
            quota_lines: vec!["—".to_string()],
        },
    };
    
    // 获取 Codex 当前账号
    let codex_info = if let Some(account) = crate::modules::codex_account::get_current_account() {
        let mut quota_lines = if let Some(quota) = &account.quota {
            vec![
                format!(
                    "5h: {}% · {} {}",
                    quota.hourly_percentage,
                    get_text("reset", lang),
                    format_reset_time_from_ts(lang, quota.hourly_reset_time)
                ),
                format!(
                    "Week: {}% · {} {}",
                    quota.weekly_percentage,
                    get_text("reset", lang),
                    format_reset_time_from_ts(lang, quota.weekly_reset_time)
                ),
            ]
        } else {
            vec![get_text("loading", lang)]
        };
        if quota_lines.is_empty() {
            quota_lines.push("—".to_string());
        }

        AccountDisplayInfo {
            account: format!("📧 {}", account.email),
            quota_lines,
        }
    } else {
        AccountDisplayInfo {
            account: format!("📧 {}", get_text("not_logged_in", lang)),
            quota_lines: vec!["—".to_string()],
        }
    };
    
    (ag_info, codex_info)
}

fn build_model_quota_lines(
    lang: &str,
    models: &[crate::models::quota::ModelQuota],
) -> Vec<String> {
    let mut lines = Vec::new();
    for model in models.iter().take(4) {
        let reset_text = format_reset_time(&model.reset_time);
        if reset_text.is_empty() {
            lines.push(format!("{}: {}%", model.name, model.percentage));
        } else {
            lines.push(format!(
                "{}: {}% · {} {}",
                model.name,
                model.percentage,
                get_text("reset", lang),
                reset_text
            ));
        }
    }
    if lines.is_empty() {
        lines.push("—".to_string());
    }
    lines
}

fn format_reset_time_from_ts(lang: &str, reset_ts: Option<i64>) -> String {
    let Some(reset_ts) = reset_ts else {
        return "—".to_string();
    };
    let now = chrono::Utc::now().timestamp();
    let remaining_secs = reset_ts - now;
    if remaining_secs <= 0 {
        return get_text("reset_done", lang);
    }
    format_remaining_duration(remaining_secs)
}

fn format_remaining_duration(remaining_secs: i64) -> String {
    let mut secs = remaining_secs.max(0);
    let days = secs / 86_400;
    secs %= 86_400;
    let hours = secs / 3_600;
    secs %= 3_600;
    let minutes = (secs / 60).max(1);

    if days > 0 {
        format!("{}d {}h {}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}

/// 格式化重置时间
fn format_reset_time(reset_time: &str) -> String {
    // 解析 ISO 时间并计算剩余时间
    if let Ok(reset) = chrono::DateTime::parse_from_rfc3339(reset_time) {
        let now = chrono::Utc::now();
        let duration = reset.signed_duration_since(now);
        
        if duration.num_seconds() <= 0 {
            return "已重置".to_string();
        }
        
        let hours = duration.num_hours();
        let minutes = duration.num_minutes() % 60;
        
        if hours > 0 {
            format!("{}h {}m", hours, minutes)
        } else {
            format!("{}m", minutes)
        }
    } else {
        reset_time.to_string()
    }
}

/// 处理菜单事件
fn handle_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    logger::log_info(&format!("[Tray] 菜单点击: {}", id));
    
    match id {
        menu_ids::SHOW_WINDOW => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        menu_ids::REFRESH_QUOTA => {
            // 发送事件到前端触发刷新
            let _ = app.emit("tray:refresh_quota", ());
        }
        menu_ids::SETTINGS => {
            // 显示窗口并导航到设置页面
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = app.emit("tray:navigate", "settings");
            }
        }
        menu_ids::QUIT => {
            info!("[Tray] 用户选择退出应用");
            app.exit(0);
        }
        _ => {
            if id.starts_with("ag_") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = app.emit("tray:navigate", "overview");
                }
            } else if id.starts_with("codex_") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = app.emit("tray:navigate", "codex");
                }
            }
        }
    }
}

/// 处理托盘图标事件
fn handle_tray_event<R: Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => {
            if let Some(window) = tray.app_handle().get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            if let Some(window) = tray.app_handle().get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        _ => {}
    }
}

/// 更新托盘菜单（配额变化时调用）
pub fn update_tray_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        logger::log_info("[Tray] 托盘菜单已更新");
    }
    Ok(())
}

/// 获取本地化文本
fn get_text(key: &str, lang: &str) -> String {
    match (key, lang) {
        // 简体中文
        ("show_window", "zh-cn") => "显示主窗口".to_string(),
        ("refresh_quota", "zh-cn") => "🔄 刷新配额".to_string(),
        ("settings", "zh-cn") => "⚙️ 设置...".to_string(),
        ("quit", "zh-cn") => "❌ 退出".to_string(),
        ("not_logged_in", "zh-cn") => "未登录".to_string(),
        ("loading", "zh-cn") => "加载中...".to_string(),
        ("reset", "zh-cn") => "重置".to_string(),
        ("reset_done", "zh-cn") => "已重置".to_string(),
        
        // 繁体中文
        ("show_window", "zh-tw") => "顯示主視窗".to_string(),
        ("refresh_quota", "zh-tw") => "🔄 重新整理配額".to_string(),
        ("settings", "zh-tw") => "⚙️ 設定...".to_string(),
        ("quit", "zh-tw") => "❌ 結束".to_string(),
        ("not_logged_in", "zh-tw") => "未登入".to_string(),
        ("loading", "zh-tw") => "載入中...".to_string(),
        ("reset", "zh-tw") => "重置".to_string(),
        ("reset_done", "zh-tw") => "已重置".to_string(),
        
        // 英文
        ("show_window", "en") => "Show Window".to_string(),
        ("refresh_quota", "en") => "🔄 Refresh Quota".to_string(),
        ("settings", "en") => "⚙️ Settings...".to_string(),
        ("quit", "en") => "❌ Quit".to_string(),
        ("not_logged_in", "en") => "Not logged in".to_string(),
        ("loading", "en") => "Loading...".to_string(),
        ("reset", "en") => "Reset".to_string(),
        ("reset_done", "en") => "Reset done".to_string(),
        
        // 日语
        ("show_window", "ja") => "ウィンドウを表示".to_string(),
        ("refresh_quota", "ja") => "🔄 クォータを更新".to_string(),
        ("settings", "ja") => "⚙️ 設定...".to_string(),
        ("quit", "ja") => "❌ 終了".to_string(),
        ("not_logged_in", "ja") => "未ログイン".to_string(),
        ("loading", "ja") => "読み込み中...".to_string(),
        ("reset", "ja") => "リセット".to_string(),
        ("reset_done", "ja") => "リセット済み".to_string(),
        
        // 俄语
        ("show_window", "ru") => "Показать окно".to_string(),
        ("refresh_quota", "ru") => "🔄 Обновить квоту".to_string(),
        ("settings", "ru") => "⚙️ Настройки...".to_string(),
        ("quit", "ru") => "❌ Выход".to_string(),
        ("not_logged_in", "ru") => "Не авторизован".to_string(),
        ("loading", "ru") => "Загрузка...".to_string(),
        ("reset", "ru") => "Сброс".to_string(),
        ("reset_done", "ru") => "Сброс выполнен".to_string(),
        
        // 默认英文
        ("show_window", _) => "Show Window".to_string(),
        ("refresh_quota", _) => "🔄 Refresh Quota".to_string(),
        ("settings", _) => "⚙️ Settings...".to_string(),
        ("quit", _) => "❌ Quit".to_string(),
        ("not_logged_in", _) => "Not logged in".to_string(),
        ("loading", _) => "Loading...".to_string(),
        ("reset", _) => "Reset".to_string(),
        ("reset_done", _) => "Reset done".to_string(),
        
        _ => key.to_string(),
    }
}
