# Android 构建说明（Phase E）

当前仓库已经准备好 Capacitor 配置，Android 工程会在首次构建时由 Capacitor 生成。
当前 Release 安装包为 `app-debug.apk`（版本 `0.1.5`）。

## 前置条件

- 安装 Node.js 18+ 与 Java 17+（推荐 Java 21）
- 固定使用 Capacitor 6：`@capacitor/core@6 @capacitor/cli@6 @capacitor/android@6`
- 安装 Android Studio，并配置 `ANDROID_HOME`
- 在 `android/` 目录执行以下命令：

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem
npx cap add android
npx cap sync android
```

然后用 Android Studio 打开 `android/android/`，等待 Gradle 同步后：

```bash
cd android
./gradlew assembleDebug
```

生成的 APK 位于 `android/android/app/build/outputs/apk/debug/app-debug.apk`。

## 数据与隐私

- 数据全部保存在应用本机，不经过服务器。
- 导出备份使用系统文件选择器，可保存到本地、网盘或云盘目录。
- “备份目录”设置会调用系统目录选择器，导出优先写入所选目录；未设置时导出会先弹出目录选择器，支持本地文件夹和网盘/云盘目录，导入优先打开该目录。
- 卸载应用即清空数据，符合“删除即清空”的产品决策。
- 覆盖安装新版不会清除本地数据；只有卸载应用才会清空。

## allowBackup

正式发布前，请确认 `android/app/src/main/AndroidManifest.xml` 中 application 节点包含：

```xml
android:allowBackup="false"
```

Capacitor 生成的模板默认会带 `android:allowBackup="true"`，需要按上面的配置改掉。
