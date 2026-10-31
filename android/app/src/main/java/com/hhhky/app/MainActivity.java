package com.hhhky.app;

import android.content.Intent;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

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

        @JavascriptInterface
        public void downloadAndInstall(final String url, final String fileName) {
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
                    File apk = downloadApk(url, fileName);
                    callJs("window.onUpdateProgress && window.onUpdateProgress(100)");
                    installApk(apk);
                } catch (Exception e) {
                    downloading = false;
                    String msg = e.getMessage() == null ? "下载失败" : e.getMessage().replace("'", " ");
                    callJs("window.onUpdateError && window.onUpdateError('" + msg + "')");
                }
            }).start();
        }

        private File downloadApk(String url, String fileName) throws Exception {
            File dir = new File(getCacheDir(), "updates");
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
                    // APK 本身已压缩，要求不额外编码，省掉一次解压开销
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
                int lastPct = -1;
                byte[] buf = new byte[65536];
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int pct = (int) (done * 100 / total);
                            if (pct != lastPct && pct % 2 == 0) {
                                lastPct = pct;
                                callJs("window.onUpdateProgress && window.onUpdateProgress(" + pct + ")");
                            }
                        }
                    }
                }

                if (part.length() <= 0) throw new Exception("下载内容为空");
                if (target.exists() && !target.delete()) throw new Exception("无法覆盖旧安装包");
                if (!part.renameTo(target)) throw new Exception("安装包保存失败");
                return target;
            } finally {
                if (conn != null) conn.disconnect();
                downloading = false;
            }
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
}
