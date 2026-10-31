package com.hhhky.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

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
}
