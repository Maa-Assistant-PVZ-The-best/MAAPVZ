# Android 客户端

外壳是 [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp) 子模块（`Android/MaaFwApp`）。
`interface.json` 在 `assets/`、agent 在仓库根，Gradle 只能从一个目录 include，
所以先由 `Android/prepare_android_pi.py` 摊成 `Android/pi-root/`（构建产物，不进 git）。

## 首次

```bash
git submodule update --init Android/MaaFwApp
python Android/prepare_android_pi.py
python Android/MaaFwApp/scripts/setup_maa_framework.py --abi arm64-v8a --tag v5.13.0
python Android/MaaFwApp/scripts/build_agent_bundle.py --out Android/agent-dist ^
    --abi arm64-v8a --abi x86_64 ^
    --requirements requirements.txt ^
    --exclude onnxruntime --extra-index-url https://chaquo.com/pypi-13.1/
```

`prepare_android_pi.py` 顺带处理两件事：把 pi-root 里那份 interface.json 的
Mirror酱 rid 打成 `MaaPVZ_exec`（桌面端 `assets/interface.json` 不动），以及补齐
OCR 模型（本地 `assets/resource/model/ocr/` 有就复用，没有就从官方 CDN 拉）。

MaaFramework 内核 pin 在 `v5.13.0`（与火影仓库同一验证版本，MaaFwApp 实测可用）。
注意 MaaFramework 的 release tag 与桌面端 `requirements.txt` 里的 maafw py 版本
**不是同一套编号**（桌面 5.14.2 ≠ 内核 release tag）；升级内核时连 CI 缓存 key 里的
fw 版本号一起改。

在 `Android/MaaFwApp/local.properties` 里写（子模块自己的，不进 git）：

```properties
sdk.dir=<Android SDK>
pi.profile=../profile.yaml
build.debugAbi=arm64-v8a
```

## 出包

```bash
# 改了 assets / agent 源码后重新摊平
python Android/prepare_android_pi.py

# 已连接设备
./Android/MaaFwApp/gradlew.bat -p Android/MaaFwApp :app:installDebug

# 正式包：release 默认打 arm64-v8a + x86_64；发版 CI 分别产出两个架构的 APK
python Android/MaaFwApp/scripts/setup_maa_framework.py --tag v5.13.0
./Android/MaaFwApp/gradlew.bat -p Android/MaaFwApp :app:assembleRelease
```

签名读环境变量或 `local.properties`，缺了就打未签名包：`KEYSTORE_PATH`、`KEYSTORE_PASSWORD`、
`KEY_ALIAS`、`KEY_PASSWORD`（环境变量优先，CI 注入不会被本地 stale 值覆盖）。
**未签名 APK 在真机上装不上**（无 v1/v2 签名 → `INSTALL_PARSE_FAILED_NO_CERTIFICATES`），
所以本地要出可安装的 release 包必须配这四项。

本机签名材料放在 `Android/keystore/`（根 `.gitignore` 已忽略，不进仓库）：
`release.jks` + `release.jks.b64`，密码在 `Android/MaaFwApp/local.properties`。
这把 key 一旦对外发过包就不能再换，否则老用户只能卸载重装 —— 务必备份。

## CI

- `.github/workflows/android-ci.yml`：相关路径的 push / PR 构建 Debug 包
  （arm64-v8a + x86_64 矩阵）+ 调用 Release 构建出内部包
- `.github/workflows/android-release-build.yml`：Release 构建（可手动跑），
  校验包内 pi.zip 的 rid = MaaPVZ_exec；上传 APK 与 mapping.txt 为 Artifact
- `.github/workflows/release.yml`：推 `v*` tag 后统一构建桌面端 + Android 公开包

仓库 Secrets：`ANDROID_KEYSTORE_BASE64`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`。

- **公开发版（`distribution: public`）必须配齐**，缺一项 workflow 直接失败，
  不会再静默发出装不上的包。
- **内部包允许缺**：缺了会临时生成一把一次性 debug key 签名，保证内部包可安装
  （公钥与正式 key 不同，冒充不了正式包）。
- 构建后会校验 APK 确实带签名：按 ZIP 结构读 EOCD（含 ZIP64）定位中央目录，
  再查紧贴其前的 APK Signing Block（v2/v3），**不能只看文件尾 64KB** ——
  中央目录本身可能几 MB，尾部窗口必然漏判；最后还会把包内证书与
  `KEYSTORE_PATH` 里的证书比对，签名一致的才算过。

升外壳：

```bash
git -C Android/MaaFwApp fetch
git -C Android/MaaFwApp checkout origin/main
git add Android/MaaFwApp
```
