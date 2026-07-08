#!/usr/bin/env node
/**
 * HomeFrame 手机原生壳 · 一键构建脚本（跨平台）
 *
 * 用法：
 *   node build.js            # 默认构建 Android（当前目录 = app/mobile）
 *   node build.js android    # 显式构建 Android
 *   node build.js ios        # 构建 iOS（仅 macOS 可出 IPA）
 *   node build.js check      # 只检查前置条件，不构建
 *
 * 前置条件（脚本会自动检测并给出安装指引）：
 *   - Node.js >= 18
 *   - JDK 17+（Android 构建需要；用 `java -version` 检测）
 *   - Android SDK（环境变量 ANDROID_HOME 或 ANDROID_SDK_ROOT 指向）
 *   - 联网（首次需 npm install 拉取 Capacitor 依赖）
 *
 * 构建产物：android/app/build/outputs/apk/debug/app-debug.apk
 * 若已连接 Android 设备，脚本会尝试自动 `adb install` 装到手机。
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

// ---------- 输出助手 ----------
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
function say(msg) { console.log(msg); }
function ok(msg) { say(`  ${c.green}✔${c.reset} ${msg}`); }
function bad(msg) { say(`  ${c.red}✘${c.reset} ${msg}`); }
function step(msg) { say(`\n${c.bold}${c.cyan}▶ ${msg}${c.reset}`); }
function warn(msg) { say(`  ${c.yellow}! ${msg}${c.reset}`); }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: __dirname, ...opts });
  return r.status ?? 1;
}
function capture(cmd, args, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch { return ''; }
}
function has(cmd) {
  const r = spawnSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

// ---------- 前置条件检测 ----------
function checkNode() {
  const v = parseInt(process.versions.node.split('.')[0], 10);
  if (v >= 18) { ok(`Node.js v${process.versions.node}`); return true; }
  bad(`Node.js 版本过低（当前 v${process.versions.node}，需 >= 18）`);
  warn('下载安装：https://nodejs.org （选 LTS 版）');
  return false;
}
function checkJava() {
  if (!has('java')) {
    bad('未检测到 Java（JDK）');
    warn('Android 构建需要 JDK 17+。安装：https://adoptium.net （选 Temurin 17 LTS）');
    return false;
  }
  const out = capture('java', ['-version']);
  const m = out.match(/version "(\d+(?:\.\d+)?)/);
  const major = m ? (m[1].startsWith('1.') ? parseInt(m[1].split('.')[1], 10) : parseInt(m[1], 10)) : 0;
  if (major >= 17) { ok(`JDK ${m ? m[1] : '(已安装)'} 满足要求`); return true; }
  bad(`JDK 版本过低（需 17+，检测到 ${m ? m[1] : '未知'}）`);
  warn('安装 JDK 17+：https://adoptium.net （Temurin 17 LTS）');
  return false;
}
function checkAndroidSdk() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) {
    bad('未设置 Android SDK 环境变量');
    warn('请安装 Android Studio，并在环境变量中设置：');
    warn('  ANDROID_HOME = C:\\Users\\<你>\\AppData\\Local\\Android\\Sdk  (Windows)');
    warn('  ANDROID_SDK_ROOT = ~/Android/Sdk  (macOS/Linux)');
    return false;
  }
  if (!existsSync(sdk)) {
    bad(`ANDROID_HOME 指向的路径不存在：${sdk}`);
    return false;
  }
  const adb = join(sdk, 'platform-tools', isWin ? 'adb.exe' : 'adb');
  if (!existsSync(adb)) {
    bad('未找到 platform-tools/adb，请在 Android Studio 的 SDK Manager 安装「Android SDK Platform-Tools」');
    return false;
  }
  ok(`Android SDK 已就绪（${sdk}）`);
  return true;
}

// ---------- 主流程 ----------
function main() {
  const arg = (process.argv[2] || 'android').toLowerCase();
  let target = 'android';
  if (arg === 'ios') target = 'ios';
  else if (arg === 'check') target = 'check';
  else if (arg === 'android') target = 'android';
  else { warn(`未知参数 "${arg}"，默认构建 Android`); }

  say(`${c.bold}HomeFrame 原生壳构建脚本${c.reset}`);
  say(`目标平台：${c.bold}${target}${c.reset}  工作目录：${__dirname}`);

  // 1. 前置条件
  step('检查前置条件');
  let good = true;
  good = checkNode() && good;
  good = checkJava() && good;
  if (target === 'android') good = checkAndroidSdk() && good;
  if (target === 'ios' && process.platform !== 'darwin') {
    bad('构建 iOS 需要 macOS + Xcode，当前系统不支持');
    good = false;
  }
  if (!good) {
    say(`\n${c.red}前置条件不满足，已停止。请按上面指引安装后重试。${c.reset}`);
    process.exit(1);
  }
  ok('前置条件全部满足');

  if (target === 'check') {
    say(`\n${c.green}环境就绪，可运行 \`node build.js ${target === 'check' ? 'android' : target}\` 开始构建。${c.reset}`);
    process.exit(0);
  }

  // 2. 安装依赖
  step('安装 npm 依赖（首次较慢，需联网）');
  if (run('npm', ['install']) !== 0) {
    bad('npm install 失败，请检查网络或 npm 配置');
    process.exit(1);
  }
  ok('依赖安装完成');

  // 3. 添加原生平台（已存在则跳过）
  const platformDir = join(__dirname, target);
  if (!existsSync(platformDir)) {
    step(`添加 ${target} 平台`);
    if (run('npx', ['cap', 'add', target]) !== 0) {
      bad(`cap add ${target} 失败`);
      process.exit(1);
    }
    ok(`${target} 平台已添加`);
  } else {
    ok(`${target} 平台已存在，跳过添加`);
  }

  // 4. 同步 Web 资源
  step('同步 Web 资源到原生工程（cap sync）');
  if (run('npx', ['cap', 'sync', target]) !== 0) {
    bad('cap sync 失败');
    process.exit(1);
  }
  ok('Web 资源已同步');

  // 5. 构建
  step(`构建 ${target}（生成安装包）`);
  if (run('npx', ['cap', 'build', target]) !== 0) {
    bad(`cap build ${target} 失败`);
    process.exit(1);
  }
  ok('构建完成');

  // 6. 产物定位 + 自动安装
  if (target === 'android') {
    const apk = resolve(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk');
    if (existsSync(apk)) {
      say(`\n${c.bold}${c.green}APK 已生成：${c.reset}${apk}`);
      const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      const adb = sdk ? join(sdk, 'platform-tools', isWin ? 'adb.exe' : 'adb') : 'adb';
      const dev = capture(adb, ['devices']).split('\n').slice(1).filter(l => l.includes('\tdevice')).length;
      if (dev > 0) {
        step('检测到手机，尝试自动安装');
        if (run(adb, ['install', '-r', apk]) === 0) ok('已安装到手机，打开 HomeFrame 即可使用');
        else warn('自动安装失败，可手动用 adb 安装：');
      } else {
        warn('未检测到已连接的 Android 设备，请手动安装：');
      }
      if (dev === 0) say(`  ${adb} install -r "${apk}"`);
    } else {
      warn(`未找到 APK（预期路径 ${apk}），可在 Android Studio 中打开 android/ 目录手动构建`);
    }
  } else if (target === 'ios') {
    say(`\n${c.bold}iOS 工程已生成：${c.reset}${resolve(__dirname, 'ios')}`);
    say('请用 Xcode 打开 ios/App/App.xcworkspace，连设备后点 Run 出 IPA。');
  }

  say(`\n${c.bold}${c.green}全部完成 ✅${c.reset}`);
  say('首次打开 App，记得在「连接设置」填写家庭服务器地址（如 http://192.168.x.x:8787 或 HTTPS 域名）。');
}

main();
