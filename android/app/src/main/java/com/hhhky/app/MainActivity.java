package com.hhhky.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 系统栏（状态栏 / 导航栏）沉浸式适配。
 *
 * 页面自身用 --sat / --sab 预留安全区，因此这里把系统栏做成透明并让内容绘制到系统栏下方：
 * 系统栏区域显示的就是页面自己的背景，不会出现“系统栏一条底色、页面另一种底色”的割裂。
 * 原生只负责两件事：
 *   1. edge-to-edge + 系统栏透明（鸿蒙、Android 14 及以下统一生效）；
 *   2. 按 App 当前主题切换系统栏图标/文字的黑白，并兜底填充系统栏区域底色。
 *
 * 能力通过 AndroidSystemBars 暴露给 JS；Web 端取不到该对象时自动降级，不影响原有逻辑。
 */
public class MainActivity extends BridgeActivity {

    /** 返回键处理是否正在等页面回话，用于吞掉连续快按 */
    private boolean backPending = false;

    /** 网页热更新：自己的记录（当前使用的热更目录、版本、是否加载成功） */
    private static final String HOT_PREFS = "shiyongbujian_hot";
    /** Capacitor 自己的 serverBasePath 记录，Bridge 启动时会读取它 */
    private static final String CAP_PREFS = "CapWebViewSettings";
    private static final String CAP_SERVER_PATH = "serverBasePath";

    /**
     * 网页热更新要在 Bridge 创建之前决定加载哪套网页资源，
     * 所以覆盖 load()（BridgeActivity 在这里创建 Bridge 并加载页面）。
     */
    @Override
    protected void load() {
        prepareHotUpdate();
        super.load();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyEdgeToEdge();
        bindWebViewBridge();
        bindBackHandler();
    }

    /**
     * 系统返回键交给页面自己的路由栈判断：
     * 页面有上一级就返回上一级（留在 App 内），只有停在首页时才真正退出。
     * 返回事件在鸿蒙与 Android 上同样走 OnBackPressedDispatcher，无需分别适配。
     */
    private void bindBackHandler() {
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (backPending) return;
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    return;
                }
                backPending = true;
                webView.evaluateJavascript(
                    "(function(){try{return (typeof handleAndroidBack==='function'&&handleAndroidBack())?'1':'0'}catch(e){return '0'}})()",
                    value -> {
                        backPending = false;
                        // "1" = 页面已返回上一级；"0" = 已在首页，交给系统默认行为退出
                        boolean handled = value != null && value.contains("1");
                        if (!handled) {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }

    @SuppressWarnings("deprecation")
    private void applyEdgeToEdge() {
        Window window = getWindow();
        // 内容延伸到系统栏下方；Capacitor 的 SystemBars 会据此注入真实安全区尺寸
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // 系统栏透明：颜色交由页面自己绘制，避免固定底色与页面主题不一致
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 关闭系统给手势条自动加的半透明遮罩，否则深色页面底部会多出一条灰带
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
    }

    private void bindWebViewBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new SystemBarsBridge(), "AndroidSystemBars");
        webView.addJavascriptInterface(new UpdateBridge(), "AndroidUpdate");
        webView.addJavascriptInterface(new HotUpdateBridge(), "AndroidHotUpdate");
    }

    // ── 网页热更新（只换 Web 资源，不动原生，所以不需要发新安装包）──────────

    /** 热更包的解压根目录（私有目录，卸载应用时一并清理） */
    private File hotRoot() {
        File dir = new File(getFilesDir(), "hot");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private String appVersionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** 让 Capacitor 下次加载页面时从指定目录取资源；空串表示恢复内置资源 */
    private void writeCapServerPath(String path) {
        getSharedPreferences(CAP_PREFS, MODE_PRIVATE)
                .edit()
                .putString(CAP_SERVER_PATH, path)
                .apply();
    }

    /**
     * 启动前决定加载哪套资源（必须在 super.load() 之前调用）。
     * 只有同时满足「目录存在 + index.html 在 + 装的是同一版 APK + 上次加载成功」
     * 才使用热更包，否则清掉并回退到安装包内置资源。
     */
    private void prepareHotUpdate() {
        SharedPreferences prefs = getSharedPreferences(HOT_PREFS, MODE_PRIVATE);
        String dir = prefs.getString("activeDir", null);
        if (dir == null || dir.isEmpty()) return;

        File root = new File(dir);
        boolean usable = root.isDirectory()
                && new File(root, "index.html").isFile()
                && appVersionName().equals(prefs.getString("baseApp", null))
                && prefs.getBoolean("healthy", true);
        if (!usable) {
            clearHotUpdate(false);
            return;
        }

        writeCapServerPath(dir);
        // 本次启动先记为「未确认」，由页面加载完成后调用 markHealthy 才是真正可用。
        // 如果页面起不来（白屏/崩溃），下次启动就会自动回滚到内置资源。
        prefs.edit().putBoolean("healthy", false).apply();
    }

    /**
     * 清掉热更新：删除已下载的资源、清空记录，reload=true 时立刻重新加载内置页面。
     */
    private void clearHotUpdate(boolean reload) {
        getSharedPreferences(HOT_PREFS, MODE_PRIVATE).edit().clear().apply();
        writeCapServerPath("");
        deleteRecursive(hotRoot());
        if (reload) {
            runOnUiThread(() -> {
                if (getBridge() != null) getBridge().reload();
            });
        }
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** 解压 zip 到指定目录，并挡住 ../ 这类越界路径 */
    private void unzip(File zip, File target) throws Exception {
        String rootPath = target.getCanonicalPath() + File.separator;
        byte[] buf = new byte[65536];
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                File out = new File(target, entry.getName());
                if (!out.getCanonicalPath().startsWith(rootPath)) {
                    throw new Exception("更新包内容异常");
                }
                if (entry.isDirectory()) {
                    if (!out.exists() && !out.mkdirs()) throw new Exception("解压失败");
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) throw new Exception("解压失败");
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n);
                }
            }
        }
    }

    /**
     * 下载文件到 cacheDir/<subDir>/，供 APK 更新与网页热更新共用。
     *
     * @param strict 还有备用线路时传 true：10 秒内平均速度低于 100KB/s 就放弃，交给页面换线路
     * @param progressFn 页面上的进度回调函数名，例如 window.onUpdateProgress
     */
    private File downloadFile(String url, String subDir, String fileName, boolean strict, String progressFn)
            throws Exception {
        File dir = new File(getCacheDir(), subDir);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法创建下载目录");
        String name = (fileName == null || fileName.isEmpty()) ? "update.apk"
                : fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        File target = new File(dir, name);
        File part = new File(dir, name + ".part");

        HttpURLConnection conn = null;
        String current = url;
        try {
            // GitHub Releases 会 302 到对象存储，手动跟随跳转，避免被自动重定向策略坑到
            for (int hop = 0; hop < 5; hop++) {
                conn = (HttpURLConnection) new URL(current).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("User-Agent", "shiyongbujian-app");
                // 文件本身已压缩，要求不额外编码，省掉一次解压开销
                conn.setRequestProperty("Accept-Encoding", "identity");
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String next = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (next == null) throw new Exception("下载地址跳转失败");
                    current = next;
                    continue;
                }
                if (code != 200) throw new Exception("下载失败（HTTP " + code + "）");
                break;
            }
            if (conn == null) throw new Exception("下载地址跳转失败");

            long total = conn.getContentLength(); // 服务端给了长度才显示真实进度
            long done = 0;
            long startedAt = System.currentTimeMillis();
            int lastPct = -1;
            byte[] buf = new byte[65536];
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;

                    // 还有备用线路时，主线路太慢就尽快放弃，别让用户干等
                    if (strict) {
                        long elapsed = System.currentTimeMillis() - startedAt;
                        if (elapsed > 10000 && done * 1000 / elapsed < 102400) {
                            throw new Exception("线路太慢");
                        }
                    }

                    if (total > 0) {
                        int pct = (int) (done * 100 / total);
                        if (pct != lastPct && pct % 2 == 0) {
                            lastPct = pct;
                            callJs(progressFn + " && " + progressFn + "(" + pct + ")");
                        }
                    }
                }
            }

            if (part.length() <= 0) throw new Exception("下载内容为空");
            if (target.exists() && !target.delete()) throw new Exception("无法覆盖旧文件");
            if (!part.renameTo(target)) throw new Exception("文件保存失败");
            return target;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** 在页面里执行一段 JS（主线程），用于把下载进度/结果回传 */
    private void callJs(final String script) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(script, null);
            }
        });
    }

    /** 供 Web 端调用：同步系统栏图标黑白 + 系统栏区域底色 */
    private void applyBarTheme(final boolean lightBackground, final String backgroundColor) {
        runOnUiThread(() -> {
            Window window = getWindow();
            View decor = window.getDecorView();

            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            if (controller != null) {
                // lightBackground=true 表示浅色背景，需要深色图标（反之亦然）
                controller.setAppearanceLightStatusBars(lightBackground);
                controller.setAppearanceLightNavigationBars(lightBackground);
            }

            // 旧版 WebView 由 Capacitor 给 DecorView 加 padding 避开系统栏，
            // 系统栏区域显示的就是 DecorView 底色，这里同步成页面当前主题色。
            if (backgroundColor != null && !backgroundColor.isEmpty()) {
                try {
                    decor.setBackgroundColor(Color.parseColor(backgroundColor));
                } catch (IllegalArgumentException ignored) {
                    // 颜色格式无法解析时保持系统默认，不影响页面使用
                }
            }
        });
    }

    private class SystemBarsBridge {

        @JavascriptInterface
        public void setBarTheme(final boolean lightBackground, final String backgroundColor) {
            applyBarTheme(lightBackground, backgroundColor);
        }
    }

    /**
     * App 内更新：下载新版本 APK，再拉起系统安装界面。
     *
     * Android 不允许第三方应用静默安装，所以这里只负责「省掉手动找包、下载、点击」，
     * 最后一步的「安装」按钮仍由系统安装程序提供，用户确认一次即可。
     * 进度与结果通过 window.onUpdateProgress / onUpdateError / onUpdateInstalling 回传页面。
     */
    private class UpdateBridge {

        /** 是否正在下载，防止连点重复下载 */
        private boolean downloading = false;

        /**
         * @param strict 还有备用线路时传 true：主线路太慢会主动放弃，让页面换线路重试
         */
        @JavascriptInterface
        public void downloadAndInstall(final String url, final String fileName, final boolean strict) {
            if (url == null || url.isEmpty() || downloading) return;

            // Android 8+ 需要「安装未知应用」授权，没有就先把用户送到授权页
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                        callJs("window.onUpdateError && window.onUpdateError('needPermission')");
                    } catch (Exception e) {
                        callJs("window.onUpdateError && window.onUpdateError('无法打开安装权限设置')");
                    }
                });
                return;
            }

            downloading = true;
            new Thread(() -> {
                try {
                    File apk = downloadFile(url, "updates", fileName, strict, "window.onUpdateProgress");
                    callJs("window.onUpdateProgress && window.onUpdateProgress(100)");
                    installApk(apk);
                } catch (Exception e) {
                    String msg = e.getMessage() == null ? "下载失败" : e.getMessage().replace("'", " ");
                    callJs("window.onUpdateError && window.onUpdateError('" + msg + "')");
                } finally {
                    downloading = false;
                }
            }).start();
        }

        private void installApk(File apk) {
            runOnUiThread(() -> {
                try {
                    // 走 Capacitor 自带的 FileProvider，把私有目录里的 APK 权限授予安装程序
                    Uri uri = FileProvider.getUriForFile(MainActivity.this,
                            getPackageName() + ".fileprovider", apk);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    callJs("window.onUpdateInstalling && window.onUpdateInstalling()");
                } catch (Exception e) {
                    callJs("window.onUpdateError && window.onUpdateError('无法启动安装程序')");
                }
            });
        }
    }

    /**
     * 网页热更新：下载一份完整的 Web 资源 zip，解压到私有目录，
     * 下次启动时由 prepareHotUpdate() 把页面切到新目录。
     *
     * 只改 Web（HTML/CSS/JS）时用这条通道即可，不需要发新 APK、不升版本号。
     * 原生能力有变化时仍然必须发新安装包——新包会清掉热更新，回到内置资源。
     */
    private class HotUpdateBridge {

        /** 同一时间只允许一个下载任务 */
        private volatile boolean busy = false;

        /** 返回已应用的热更信息，形如 {"version":"3","dir":"/data/..."} */
        @JavascriptInterface
        public String getState() {
            SharedPreferences prefs = getSharedPreferences(HOT_PREFS, MODE_PRIVATE);
            String version = prefs.getString("version", "");
            String dir = prefs.getString("activeDir", "");
            return "{\"version\":\"" + version.replace("\"", "")
                    + "\",\"dir\":\"" + dir.replace("\\", "/").replace("\"", "") + "\"}";
        }

        /** 页面加载完成时调用：确认这份热更资源可用，避免下次启动被误回滚 */
        @JavascriptInterface
        public void markHealthy() {
            getSharedPreferences(HOT_PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean("healthy", true)
                    .apply();
        }

        /**
         * 下载并解压热更包；成功只写入记录，当前会话仍用旧资源，
         * 下次打开 App 自动生效（避免突然刷掉用户正在做的操作）。
         */
        @JavascriptInterface
        public void downloadAndApply(final String url, final String version, final String fileName,
                                     final boolean strict) {
            if (url == null || url.isEmpty() || version == null || version.isEmpty() || busy) return;
            busy = true;
            new Thread(() -> {
                try {
                    File zip = downloadFile(url, "hot", fileName, strict, "window.onHotUpdateProgress");

                    SharedPreferences prefs = getSharedPreferences(HOT_PREFS, MODE_PRIVATE);
                    String active = prefs.getString("activeDir", null);

                    // 目录名带时间戳：绝不覆盖当前正在使用的那一份，避免下载到一半把页面资源删了
                    String safeVersion = version.replaceAll("[^A-Za-z0-9._-]", "_");
                    File target = new File(hotRoot(), safeVersion + "_" + System.currentTimeMillis());
                    if (!target.mkdirs()) throw new Exception("无法创建热更新目录");

                    unzip(zip, target);
                    if (!new File(target, "index.html").isFile()) throw new Exception("更新包内容不完整");

                    // 清掉更早的包，但保留当前会话正在使用的那一份（下次启动才会切换）
                    File[] children = hotRoot().listFiles();
                    if (children != null) {
                        for (File child : children) {
                            if (child.equals(target)) continue;
                            if (active != null && child.getAbsolutePath().equals(active)) continue;
                            deleteRecursive(child);
                        }
                    }
                    //noinspection ResultOfMethodCallIgnored
                    zip.delete();

                    prefs.edit()
                            .putString("activeDir", target.getAbsolutePath())
                            .putString("version", version)
                            .putString("baseApp", appVersionName())
                            .putBoolean("healthy", true)
                            .apply();

                    String safeJsVersion = version.replace("'", "");
                    callJs("window.onHotUpdateDone && window.onHotUpdateDone('" + safeJsVersion + "')");
                } catch (Exception e) {
                    String msg = e.getMessage() == null ? "热更新失败" : e.getMessage().replace("'", " ");
                    callJs("window.onHotUpdateError && window.onHotUpdateError('" + msg + "')");
                } finally {
                    busy = false;
                }
            }).start();
        }

        /** 放弃热更新，恢复安装包里内置的网页资源 */
        @JavascriptInterface
        public void rollback() {
            clearHotUpdate(true);
        }
    }
}
