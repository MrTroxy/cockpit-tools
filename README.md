# Cockpit Tools

[English](README.en.md) · 简体中文

[![GitHub stars](https://img.shields.io/github/stars/jlcodes99/cockpit-tools?style=flat&color=gold)](https://github.com/jlcodes99/cockpit-tools)
[![GitHub issues](https://img.shields.io/github/issues/jlcodes99/cockpit-tools)](https://github.com/jlcodes99/cockpit-tools/issues)

一款**通用的 AI IDE 账号管理工具**，目前完美支持 **Antigravity**、**Codex** 和 **GitHub Copilot**，并支持多账号多实例并行运行。

> 本工具旨在帮助用户高效管理多个 AI IDE 账号，支持一键切换、配额监控、自动唤醒与多开实例并行运行，助您充分利用不同账号的资源。

**功能**：一键切号 · 多账号管理 · 多开实例 · 配额监控 · 唤醒任务 · 设备指纹 · 插件联动 · GitHub Copilot 管理

**语言**：支持 16 种语言

🇺🇸 English · 🇨🇳 简体中文 · 繁體中文 · 🇯🇵 日本語 · 🇩🇪 Deutsch · 🇪🇸 Español · 🇫🇷 Français · 🇮🇹 Italiano · 🇰🇷 한국어 · 🇧🇷 Português · 🇷🇺 Русский · 🇹🇷 Türkçe · 🇵🇱 Polski · 🇨🇿 Čeština · 🇸🇦 العربية · 🇻🇳 Tiếng Việt

---

## 功能概览

### 1. 仪表盘 (Dashboard)

全新的可视化仪表盘，为您提供一站式的状态概览：

- **三平台支持**：同时展示 Antigravity、Codex 与 GitHub Copilot 的账号状态
- **配额监控**：实时查看各模型剩余配额、重置时间
- **快捷操作**：一键刷新、一键唤醒
- **可视化进度**：直观的进度条展示配额消耗情况

> ![Dashboard Overview](docs/images/dashboard_overview.png)

### 2. Antigravity 账号管理

- **一键切号**：一键切换当前使用的账号，无需手动登录登出
- **多种导入**：支持 OAuth 授权、Refresh Token、插件同步
- **唤醒任务**：定时唤醒 AI 模型，提前触发配额重置周期
- **设备指纹**：生成、管理、绑定设备指纹，降低风控风险

> ![Antigravity Accounts](docs/images/antigravity_list.png)
>
> *(唤醒任务与设备指纹管理)*
> ![Wakeup Tasks](docs/images/wakeup_detail.png)
> ![Device Fingerprints](docs/images/fingerprint_detail.png)

#### 2.1 Antigravity 多开实例

支持同一平台多账号多实例并行运行。比如同时打开两个 Antigravity，分别绑定不同账号，分别处理不同项目，互不影响。

- **独立账号**：每个实例绑定不同账号并独立运行
- **并行项目**：多实例同时处理不同任务/项目
- **参数隔离**：支持自定义实例目录与启动参数

> ![Antigravity Instances](docs/images/antigravity_instances.png)

### 3. Codex 账号管理

- **专属支持**：专为 Codex 优化的账号管理体验
- **配额展示**：清晰展示 Hourly 和 Weekly 配额状态
- **计划识别**：自动识别账号 Plan 类型 (Basic, Plus, Team 等)

> ![Codex Accounts](docs/images/codex_list.png)

#### 3.1 Codex 多开实例

Codex 同样支持多账号多实例并行运行。比如同时打开两个 Codex，分别绑定不同账号，分别处理不同项目，互不影响。

- **独立账号**：每个实例绑定不同账号并独立运行
- **并行项目**：多实例同时处理不同任务/项目
- **参数隔离**：支持自定义实例目录与启动参数

> ![Codex Instances](docs/images/codex_instances.png)

### 4. GitHub Copilot 账号管理

- **账号导入**：支持 OAuth 授权、Token/JSON 导入
- **配额视图**：展示 Inline Suggestions / Chat messages 使用情况与重置时间
- **订阅识别**：自动识别 Free / Individual / Pro / Business / Enterprise 等计划类型
- **批量管理**：支持标签与批量操作

#### 4.1 GitHub Copilot 多开实例

基于 VS Code 的 Copilot 多实例管理，支持独立配置与生命周期控制。

- **独立配置**：每个实例拥有独立的用户目录
- **快速启停**：一键启动/停止/强制关闭实例
- **窗口管理**：支持打开实例窗口与批量关闭

### 5. 通用设置

- **个性化设置**：主题切换、语言设置、自动刷新间隔

> ![Settings](docs/images/settings_page.png)

---

---

## 安装指南 (Installation)

### 选项 A: 手动下载 (推荐)

前往 [GitHub Releases](https://github.com/jlcodes99/cockpit-tools/releases) 下载对应系统的安装包：

*   **macOS**: `.dmg` (Apple Silicon & Intel)
*   **Windows**: `.msi` (推荐) 或 `.exe`
*   **Linux**: `.deb` (Debian/Ubuntu) 或 `.AppImage` (通用)

### 选项 B: Homebrew 安装 (macOS)

> 需要先安装 Homebrew。

```bash
brew tap jlcodes99/cockpit-tools https://github.com/jlcodes99/cockpit-tools
brew install --cask cockpit-tools
```

如果遇到 macOS “应用已损坏”或无法打开，也可以使用 `--no-quarantine` 安装：

```bash
brew install --cask --no-quarantine cockpit-tools
```

如果提示已存在应用（例如：`already an App at '/Applications/Cockpit Tools.app'`），请先删除旧版本再安装：

```bash
rm -rf "/Applications/Cockpit Tools.app"
brew install --cask cockpit-tools
```

或者直接强制覆盖安装：

```bash
brew install --cask --force cockpit-tools
```

### 🛠️ 常见问题排查 (Troubleshooting)

#### macOS 提示“应用已损坏，无法打开”？
由于 macOS 的安全机制，非 App Store 下载的应用可能会触发此提示。您可以按照以下步骤快速修复：

1.  **命令行修复** (推荐):
    打开终端，执行以下命令：
    ```bash
    sudo xattr -rd com.apple.quarantine "/Applications/Cockpit Tools.app"
    ```
    > **注意**: 如果您修改了应用名称，请在命令中相应调整路径。

2.  **或者**: 在“系统设置” -> “隐私与安全性”中点击“仍要打开”。

---

## 开发与构建

### 前置要求

- Node.js v18+
- npm v9+
- Rust（Tauri 运行时）

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建产物

```bash
npm run tauri build
```

---

## ☕ 赞助项目

如果不介意，请 [☕ 赞赏支持一下](docs/DONATE.md)

您的每一份支持都是对开源项目最大的鼓励！无论金额大小，都代表着您对这个项目的认可。

---

## 致谢

- Antigravity 账号切号逻辑参考：[Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)

感谢项目作者的开源贡献！如果这些项目对你有帮助，也请给他们点个 ⭐ Star 支持一下！

---

## 许可证

[MIT](LICENSE)

---

## 免责声明

本项目仅供个人学习和研究使用。使用本项目即表示您同意：

- 不将本项目用于任何商业用途
- 承担使用本项目的所有风险和责任
- 遵守相关服务条款和法律法规

项目作者对因使用本项目而产生的任何直接或间接损失不承担责任。
