# Release Process (Open Source, No Code Signing)

> 适用于 Cockpit Tools 当前开源发布流程（未接入代码签名）。

## 1. 目标

- 保证每次发布可复现、可验证、可追溯。
- 让用户可以通过哈希校验确认安装包未被篡改。
- 单引擎误报（如 VirusTotal 1/72）时，可快速说明和处理。

## 2. 发布前检查（Preflight）

在仓库根目录执行：

```bash
npm run release:preflight
```

该命令会依次执行：

1. `node scripts/check_locales.cjs`
2. `npm run typecheck`
3. `npm run build`
4. `cargo check`（在 `src-tauri` 下）

可选跳过参数（排障用，不建议正式发布时使用）：

```bash
node scripts/release/preflight.cjs --skip-locales --skip-typecheck --skip-build --skip-cargo
```

## 3. 打包产物

使用当前团队既有方式打包（示例）：

```bash
npm run tauri build
```

## 4. 生成 SHA256 校验文件

默认扫描 `src-tauri/target/release/bundle` 和 `dist`，输出到 `release-artifacts/SHA256SUMS.txt`：

```bash
npm run release:checksums
```

也可指定输入目录和输出文件：

```bash
node scripts/release/gen_checksums.cjs \
  --input src-tauri/target/release/bundle \
  --output release-artifacts/SHA256SUMS.txt
```

## 5. Release 发布内容规范

每次发布建议至少包含：

1. 下载文件列表（按平台）
2. `SHA256SUMS.txt`
3. 更新日志（中英文）
4. VirusTotal 链接（可选但推荐）
5. 已知误报说明（如有）

## 6. VirusTotal 单引擎误报处理

当出现 `1/72` 这类结果时：

1. 先在 Release 明确“仅单引擎命中，其他未检出”。
2. 要求用户只从官方 Release 下载并核对 SHA256。
3. 对命中厂商提交误报（附 hash、下载链接、仓库地址）。
4. 误报修复后在 issue/release 回帖同步结果。

## 7. Git 发布建议（与你当前规则对齐）

1. 修改更新日志（`CHANGELOG.md` / `CHANGELOG.zh-CN.md`）。
2. 发布前若涉及“发布 + 推远端 + 打标签”，先运行：

```bash
node scripts/check_locales.cjs
```

3. 提交、打 tag、推送。

