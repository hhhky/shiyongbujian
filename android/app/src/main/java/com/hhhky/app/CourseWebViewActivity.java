package com.hhhky.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 课表导入用内嵌浏览器。
 *
 * 用户在 App 内登录教务系统并打开课表页面，点顶部「解析」时执行页面里的
 * window.CourseImportHooks（由 js/course-webview-hooks.js 注入），把解析结果回传给主界面。
 * 账号密码只在 WebView 与教务系统之间传递，App 不读取、不保存、不上传。
 */
public class CourseWebViewActivity extends Activity {

    private static final String ACCENT = "#0EA5E9";
    private static final String TEXT = "#1D1D1F";
    private static final String SUBTEXT = "#6B7280";

    private WebView webView;
    private EditText urlInput;
    private ProgressBar progress;

    private final String fallbackHooks =
            "(function(){if(window.CourseImportHooks)return;" +
            "var p=[];window.CourseImportHooks={parsers:p,register:function(f){if(typeof f==='function')p.push(f)},run:function(){" +
            "if(!p.length)return{ok:false,error:'no_parser'};" +
            "for(var i=0;i<p.length;i++){try{var l=p[i](document);if(l&&l.length)return{ok:true,courses:l}}catch(e){return{ok:false,error:String(e)}}}" +
            "return{ok:false,error:'no_course'}}};window.registerCourseParser=function(f){window.CourseImportHooks.register(f)};})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyBarColors();
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        buildUi();

        String start = getIntent() != null ? getIntent().getStringExtra("url") : null;
        if (TextUtils.isEmpty(start)) {
            showStartPage();
        } else {
            loadUrl(start);
        }
    }

    private void applyBarColors() {
        Window window = getWindow();
        window.setStatusBarColor(Color.WHITE);
        window.setNavigationBarColor(Color.WHITE);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        window.getDecorView().setSystemUiVisibility(flags);
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(6), dp(6), dp(6), dp(6));
        toolbar.setBackgroundColor(Color.WHITE);
        toolbar.setElevation(dp(2));

        Button back = makeButton("‹", 16, Color.parseColor(TEXT));
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        back.setPadding(dp(10), 0, dp(10), 0);
        back.setOnClickListener(v -> finish());
        toolbar.addView(back, new LinearLayout.LayoutParams(dp(40), dp(44)));

        urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        urlInput.setHint("输入教务系统网址");
        urlInput.setHintTextColor(Color.parseColor("#9CA3AF"));
        urlInput.setTextColor(Color.parseColor(TEXT));
        urlInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        urlInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlInput.setBackgroundColor(Color.parseColor("#F3F4F6"));
        urlInput.setPadding(dp(12), 0, dp(12), 0);
        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(0, dp(42), 1f);
        inputLp.setMargins(dp(4), 0, dp(6), 0);
        toolbar.addView(urlInput, inputLp);
        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigate();
                return true;
            }
            return false;
        });

        Button open = makeButton("打开", 13, Color.WHITE);
        open.setBackgroundColor(Color.parseColor(ACCENT));
        open.setOnClickListener(v -> navigate());
        toolbar.addView(open, new LinearLayout.LayoutParams(dp(58), dp(38)));

        Button parse = makeButton("解析", 13, Color.WHITE);
        parse.setBackgroundColor(Color.parseColor(TEXT));
        parse.setOnClickListener(v -> parsePage());
        LinearLayout.LayoutParams parseLp = new LinearLayout.LayoutParams(dp(58), dp(38));
        parseLp.setMargins(dp(6), 0, 0, 0);
        toolbar.addView(parse, parseLp);

        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        configureWebView();

        TextView footer = new TextView(this);
        footer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        footer.setTextColor(Color.parseColor(SUBTEXT));
        footer.setText("只在本机访问教务系统；App 不保存账号密码，也不上传页面内容。");
        footer.setGravity(Gravity.CENTER);
        footer.setPadding(dp(8), dp(6), dp(8), dp(10));
        footer.setBackgroundColor(Color.parseColor("#FAFAFA"));
        root.addView(footer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private Button makeButton(String text, int textSize, int color) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSize);
        b.setTextColor(color);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setAllCaps(false);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setPadding(dp(8), 0, dp(8), 0);
        b.setBackgroundColor(Color.TRANSPARENT);
        return b;
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl() != null ? request.getUrl().toString() : "";
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false;
                }
                return true; // 不把 intent://、文件等外部协议交给 WebView
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!urlInput.hasFocus()) {
                    urlInput.setText(url);
                }
                injectHooks();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progress.setVisibility(View.GONE);
                } else {
                    progress.setVisibility(View.VISIBLE);
                    progress.setProgress(newProgress);
                }
            }
        });
    }

    private String readAsset(String path) {
        try (InputStream in = getAssets().open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private void injectHooks() {
        String js = readAsset("public/js/course-webview-hooks.js");
        if (js == null) js = fallbackHooks;
        webView.evaluateJavascript(js, null);
    }

    private void navigate() {
        String raw = urlInput.getText() == null ? "" : urlInput.getText().toString().trim();
        if (raw.isEmpty()) {
            toast("请输入网址");
            return;
        }
        loadUrl(raw);
    }

    private void loadUrl(String raw) {
        String url = raw.trim();
        if (!url.matches("(?i)^https?://.*")) {
            if (url.matches("(?i)^[a-z][a-z0-9+.-]*:.*")) {
                toast("只支持 http / https 地址");
                return;
            }
            url = "https://" + url;
        }
        urlInput.setText(url);
        urlInput.clearFocus();
        webView.loadUrl(url);
    }

    private void showStartPage() {
        String html = "<!doctype html><html><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{font-family:-apple-system,Roboto,sans-serif;margin:0;padding:28px 22px;color:#1d1d1f;background:#fff;line-height:1.75}"
                + "h1{font-size:20px;margin:0 0 6px}p{font-size:14px;color:#4b5563;margin:0 0 14px}"
                + "ol{font-size:14px;color:#374151;padding-left:20px;margin:0 0 16px}li{margin-bottom:8px}"
                + ".tip{background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:12px 14px;font-size:12px;color:#0369a1}"
                + "</style></head><body>"
                + "<h1>从教务系统导入课表</h1>"
                + "<p>这是一个只在 App 内使用的浏览器。</p>"
                + "<ol><li>在顶部地址栏输入学校教务系统网址，点「打开」。</li>"
                + "<li>正常登录并进入课表页面。</li>"
                + "<li>点顶部「解析」抓取课程；当前版本尚未内置各校解析脚本时会提示敬请期待。</li></ol>"
                + "<div class='tip'>登录信息只在你本机与教务系统之间传输。App 不读取、不上传账号密码和页面内容。</div>"
                + "</body></html>";
        urlInput.setText("");
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void parsePage() {
        String js = "(function(){try{var h=window.CourseImportHooks;"
                + "if(!h)return JSON.stringify({ok:false,error:'no_hook'});"
                + "return JSON.stringify(h.run());"
                + "}catch(e){return JSON.stringify({ok:false,error:String(e&&e.message?e.message:e)})}})()";
        webView.evaluateJavascript(js, value -> {
            String inner = unwrapJsString(value);
            try {
                JSONObject obj = new JSONObject(inner);
                if (!obj.optBoolean("ok")) {
                    String err = obj.optString("error");
                    if ("no_parser".equals(err) || "no_course".equals(err)) {
                        toast("尚未配置这所学校的解析脚本，敬请期待");
                    } else {
                        toast("解析失败：" + err);
                    }
                    return;
                }
                JSONArray courses = obj.optJSONArray("courses");
                if (courses == null || courses.length() == 0) {
                    toast("未解析到课程");
                    return;
                }
                Intent data = new Intent();
                data.putExtra("courses", courses.toString());
                setResult(RESULT_OK, data);
                finish();
            } catch (Exception e) {
                toast("解析结果格式错误");
            }
        });
    }

    private String unwrapJsString(String value) {
        if (value == null) return "";
        try {
            Object parsed = new JSONTokener(value).nextValue();
            return parsed instanceof String ? (String) parsed : String.valueOf(parsed);
        } catch (Exception e) {
            return value;
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
