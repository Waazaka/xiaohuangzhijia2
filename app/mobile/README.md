# HomeFrame 手机原生壳（Capacitor）

把现有的 Web 前端（`../public`）包装成真正的手机 App（Android / iOS）。
App 把 UI 和本地数据（WebView 的 localStorage）打进安装包，**零网络也能从首次启动离线使用**；
连上家庭服务器后按原同步协议 pull/push。家庭服务器仍是同步与多设备枢纽，架构不变。

## 前置条件
- Node.js（已具备）
- **Android**：Android Studio + Android SDK（出 APK 用）
- **iOS**：macOS + Xcode（仅 macOS 可出 IPA）

> 本仓库脚手架可在任意机器生成；真正编译安装包需你本机具备上述 SDK。

## 一键构建（推荐）

无论 Windows / macOS / Linux，**一行命令**搞定（脚本会自动检测环境、装依赖、出包，连上手机还会自动安装）：

```bash
cd app/mobile
node build.js              # 构建 Android（默认）
node build.js ios          # 构建 iOS（仅 macOS）
node build.js check        # 只检查前置条件，不构建
```

Windows 上也可以**双击 `build.cmd`**（内容只有一行 `node build.js`，用 `%~dp0` 解析自身目录，不踩中文路径编码坑）。

脚本会按序：① 检测 Node/JDK/Android SDK → ② `npm install` → ③ `cap add android`（已存在则跳过）→
④ `cap sync` → ⑤ `cap build android` → ⑥ 定位 `app-debug.apk`，若已连手机则 `adb install -r` 自动装上。
任意前置条件缺失都会**立即停止并给出安装链接**，不会白跑。

> 手动步骤（等价于脚本内部逻辑，供参考）：
> ```bash
> npm install
> npx cap add android
> npx cap sync
> npx cap open android      # Android Studio 里连手机点 Run 出 APK
> ```

### 前置条件
- **Node.js >= 18**（已具备）
- **JDK 17+**：https://adoptium.net （Temurin 17 LTS）
- **Android SDK**：装 Android Studio，设环境变量 `ANDROID_HOME`（含 platform-tools）；iOS 需 macOS + Xcode
- 首次构建需联网拉取 Capacitor 依赖

改了前端后，重新 `npx cap sync` 再构建即可。

## 首次使用
1. 打开 App，登录界面下方「连接设置」里**填写家庭服务器地址**
   （家里局域网 `http://192.168.x.x:8787`，或 Cloudflare/VPS 域名）。
2. 之后注册/登录，数据会先存本地、再同步到服务器；断网也能看、能改，恢复后自动同步。

## 重要：局域网 HTTP 被系统拦截
Android 9+ / iOS 默认禁止 App 访问 **明文 HTTP**（非 HTTPS）的局域网地址，会报
`Cleartext traffic not permitted` / ATS 阻断。两种解法：

- **推荐**：家庭服务器走 HTTPS（如 Cloudflare 隧道 / 反向代理加证书），App 填 `https://域名`。
- 或放行明文（仅内网自用时）：
  - Android：在 `android/app/src/main/AndroidManifest.xml` 的 `<application>` 加
    `android:usesCleartextTraffic="true"`。
  - iOS：在 `ios/App/App/Info.plist` 加 `NSAppTransportSecurity` 例外（允许该局域网域名）。

## 运行 Web 版（不打包原生，仅看效果）
回到 `app/` 目录：`node server.js`，浏览器开 `http://localhost:8787`。Windows 可双击 `app/start-web.cmd`。

- 网页/PWA 离线依赖 Service Worker，而 **SW 只在 HTTPS/localhost 注册**；纯局域网 HTTP 下离线打不开。
- 原生壳把资源打进包内，由 WebView 直接加载，**不依赖 SW/HTTPS**，离线从首次启动即可用。
- 服务器（`app/server.js`）已开启 CORS，原生 App 跨域调用无需额外配置。
