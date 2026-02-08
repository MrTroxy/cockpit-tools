use std::path::Path;

use crate::models::{DefaultInstanceSettings, InstanceProfileView};
use crate::modules;

const DEFAULT_INSTANCE_ID: &str = "__default__";

fn is_profile_initialized(user_data_dir: &str) -> bool {
    let path = Path::new(user_data_dir);
    if !path.exists() {
        return false;
    }
    match std::fs::read_dir(path) {
        Ok(mut iter) => iter.next().is_some(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn github_copilot_get_instance_defaults() -> Result<modules::instance::InstanceDefaults, String> {
    modules::github_copilot_instance::get_instance_defaults()
}

#[tauri::command]
pub async fn github_copilot_list_instances() -> Result<Vec<InstanceProfileView>, String> {
    let store = modules::github_copilot_instance::load_instance_store()?;
    let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
    let default_dir_str = default_dir.to_string_lossy().to_string();

    let default_settings = store.default_settings.clone();
    let mut result: Vec<InstanceProfileView> = store
        .instances
        .into_iter()
        .map(|instance| {
            let running = instance
                .last_pid
                .map(modules::process::is_pid_running)
                .unwrap_or(false);
            let initialized = is_profile_initialized(&instance.user_data_dir);
            InstanceProfileView::from_profile(instance, running, initialized)
        })
        .collect();

    let default_running = default_settings
        .last_pid
        .map(modules::process::is_pid_running)
        .unwrap_or(false);
    result.push(InstanceProfileView {
        id: DEFAULT_INSTANCE_ID.to_string(),
        name: String::new(),
        user_data_dir: default_dir_str,
        extra_args: default_settings.extra_args.clone(),
        bind_account_id: default_settings.bind_account_id.clone(),
        created_at: 0,
        last_launched_at: None,
        last_pid: default_settings.last_pid,
        running: default_running,
        initialized: is_profile_initialized(&default_dir.to_string_lossy()),
        is_default: true,
        follow_local_account: false,
    });

    Ok(result)
}

#[tauri::command]
pub async fn github_copilot_create_instance(
    name: String,
    user_data_dir: String,
    extra_args: Option<String>,
    bind_account_id: Option<String>,
    copy_source_instance_id: Option<String>,
    init_mode: Option<String>,
) -> Result<InstanceProfileView, String> {
    let instance = modules::github_copilot_instance::create_instance(
        modules::github_copilot_instance::CreateInstanceParams {
            name,
            user_data_dir,
            extra_args: extra_args.unwrap_or_default(),
            bind_account_id,
            copy_source_instance_id,
            init_mode,
        },
    )?;

    let initialized = is_profile_initialized(&instance.user_data_dir);
    Ok(InstanceProfileView::from_profile(instance, false, initialized))
}

#[tauri::command]
pub async fn github_copilot_update_instance(
    instance_id: String,
    name: Option<String>,
    extra_args: Option<String>,
    bind_account_id: Option<Option<String>>,
    follow_local_account: Option<bool>,
) -> Result<InstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let updated = modules::github_copilot_instance::update_default_settings(
            bind_account_id,
            extra_args,
            follow_local_account,
        )?;
        let running = updated
            .last_pid
            .map(modules::process::is_pid_running)
            .unwrap_or(false);
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            extra_args: updated.extra_args,
            bind_account_id: updated.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: updated.last_pid,
            running,
            initialized: is_profile_initialized(&default_dir.to_string_lossy()),
            is_default: true,
            follow_local_account: false,
        });
    }

    let wants_bind = bind_account_id
        .as_ref()
        .and_then(|next| next.as_ref())
        .is_some();
    if wants_bind {
        let store = modules::github_copilot_instance::load_instance_store()?;
        if let Some(target) = store.instances.iter().find(|item| item.id == instance_id) {
            if !is_profile_initialized(&target.user_data_dir) {
                return Err(
                    "INSTANCE_NOT_INITIALIZED:请先启动一次实例创建数据后，再进行账号绑定".to_string(),
                );
            }
        }
    }

    let instance = modules::github_copilot_instance::update_instance(
        modules::github_copilot_instance::UpdateInstanceParams {
            instance_id,
            name,
            extra_args,
            bind_account_id,
        },
    )?;

    let running = instance
        .last_pid
        .map(modules::process::is_pid_running)
        .unwrap_or(false);
    let initialized = is_profile_initialized(&instance.user_data_dir);
    Ok(InstanceProfileView::from_profile(instance, running, initialized))
}

#[tauri::command]
pub async fn github_copilot_delete_instance(instance_id: String) -> Result<(), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err("默认实例不可删除".to_string());
    }
    modules::github_copilot_instance::delete_instance(&instance_id)
}

#[tauri::command]
pub async fn github_copilot_start_instance(instance_id: String) -> Result<InstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let default_settings = modules::github_copilot_instance::load_default_settings()?;
        let extra_args = modules::process::parse_extra_args(&default_settings.extra_args);
        let pid = modules::process::start_vscode_with_args_with_new_window(
            &default_dir_str,
            &extra_args,
            false,
        )?;
        let _ = modules::github_copilot_instance::update_default_pid(Some(pid))?;
        let running = modules::process::is_pid_running(pid);
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            extra_args: default_settings.extra_args,
            bind_account_id: default_settings.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: Some(pid),
            running,
            initialized: is_profile_initialized(&default_dir.to_string_lossy()),
            is_default: true,
            follow_local_account: false,
        });
    }

    let store = modules::github_copilot_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    let extra_args = modules::process::parse_extra_args(&instance.extra_args);
    let pid = modules::process::start_vscode_with_args(&instance.user_data_dir, &extra_args)?;
    let updated = modules::github_copilot_instance::update_instance_after_start(&instance.id, pid)?;
    let running = modules::process::is_pid_running(pid);
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(InstanceProfileView::from_profile(updated, running, initialized))
}

#[tauri::command]
pub async fn github_copilot_stop_instance(instance_id: String) -> Result<InstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let default_settings = modules::github_copilot_instance::load_default_settings()?;
        modules::process::close_vscode_instance(&default_dir_str, 20)?;
        let updated_settings = modules::github_copilot_instance::update_default_pid(None)?;
        let running = updated_settings
            .last_pid
            .map(modules::process::is_pid_running)
            .unwrap_or(false);
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            extra_args: default_settings.extra_args,
            bind_account_id: default_settings.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: None,
            running,
            initialized: is_profile_initialized(&default_dir.to_string_lossy()),
            is_default: true,
            follow_local_account: false,
        });
    }

    let store = modules::github_copilot_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    modules::process::close_vscode_instance(&instance.user_data_dir, 20)?;
    let updated = modules::github_copilot_instance::update_instance_pid(&instance.id, None)?;
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(InstanceProfileView::from_profile(updated, false, initialized))
}

#[tauri::command]
pub async fn github_copilot_force_stop_instance(instance_id: String) -> Result<InstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let default_settings = modules::github_copilot_instance::load_default_settings()?;
        modules::process::force_kill_vscode_instance(&default_dir_str)?;
        let _ = modules::github_copilot_instance::update_default_pid(None)?;
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            extra_args: default_settings.extra_args,
            bind_account_id: default_settings.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: None,
            running: false,
            initialized: is_profile_initialized(&default_dir.to_string_lossy()),
            is_default: true,
            follow_local_account: false,
        });
    }

    let store = modules::github_copilot_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    modules::process::force_kill_vscode_instance(&instance.user_data_dir)?;
    let updated = modules::github_copilot_instance::update_instance_pid(&instance.id, None)?;
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(InstanceProfileView::from_profile(updated, false, initialized))
}

#[tauri::command]
pub async fn github_copilot_open_instance_window(instance_id: String) -> Result<(), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let default_settings: DefaultInstanceSettings = modules::github_copilot_instance::load_default_settings()?;
        let extra_args = modules::process::parse_extra_args(&default_settings.extra_args);
        let pid = modules::process::start_vscode_with_args_with_new_window(
            &default_dir_str,
            &extra_args,
            false,
        )?;
        let _ = modules::github_copilot_instance::update_default_pid(Some(pid))?;
        return Ok(());
    }

    let store = modules::github_copilot_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    let extra_args = modules::process::parse_extra_args(&instance.extra_args);
    let pid = modules::process::start_vscode_with_args(&instance.user_data_dir, &extra_args)?;
    let _ = modules::github_copilot_instance::update_instance_after_start(&instance.id, pid)?;
    Ok(())
}

#[tauri::command]
pub async fn github_copilot_close_all_instances() -> Result<(), String> {
    // 仅关闭记录中的实例（包含默认实例）
    let _ = modules::github_copilot_instance::clear_all_pids();

    let default_dir = modules::github_copilot_instance::get_default_vscode_user_data_dir()?;
    let default_dir_str = default_dir.to_string_lossy().to_string();
    let _ = modules::process::close_vscode_instance(&default_dir_str, 20);

    let store = modules::github_copilot_instance::load_instance_store()?;
    for instance in store.instances {
        let _ = modules::process::close_vscode_instance(&instance.user_data_dir, 20);
    }

    Ok(())
}
