package com.mediachafa.beta;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int FILE_PICKER = 4201;
    private static final int MEDIA_PERMISSION = 4202;
    private static final String APP_URL = "https://mediachafa-transfer.pages.dev/?betaApp=1&betaStandalone=20261117&nativeShell=2";

    private static final String BETA_APP_ENFORCER =
        "(function(){try{" +
        "window.MEDIA_BETA_APP=true;localStorage.setItem('mediachafa-beta-app','1');document.documentElement.classList.add('beta-app-shell');" +
        "if(!document.getElementById('native-beta-app-style')){var st=document.createElement('style');st.id='native-beta-app-style';" +
        "st.textContent=" +
        "'html,body{margin:0!important;min-height:100%!important;background:#07112f url(/beta-assets/beta-wallpaper.svg) center center/cover fixed no-repeat!important;color:#f4f6ff!important}'+" +
        "'#login.login-screen{position:fixed!important;inset:0!important;z-index:10000!important;display:grid!important;place-items:center!important;padding:24px 18px!important;overflow:auto!important;background:linear-gradient(180deg,rgba(3,8,29,.12),rgba(3,8,29,.32)),url(/beta-assets/beta-wallpaper.svg) center/cover fixed no-repeat!important}'+" +
        "'#login .login-card{width:min(420px,100%)!important;padding:28px 24px!important;border-radius:24px!important;background:rgba(4,10,35,.78)!important;color:#fff!important;border:1px solid rgba(202,218,255,.28)!important;box-shadow:0 22px 90px #0008!important;backdrop-filter:blur(12px)!important}'+" +
        "'#login .brand,#login h1{color:#fff!important}#login .brand-mark{width:52px!important;height:52px!important;border-radius:15px!important;object-fit:cover!important}'+" +
        "'#login .sub,#login .field-label,#login .remember-session,#login .login-note{color:#e0e8ff!important}#login .field{background:rgba(6,14,43,.88)!important;color:#fff!important;border:1px solid rgba(194,210,255,.4)!important;border-radius:12px!important}'+" +
        "'#login .primary{background:#29499d!important;color:#fff!important;border-radius:12px!important}#guest-ps4-entry,.install-mobile-option,.install-mobile-help{display:none!important}'+" +
        "'#app>.topbar,#app .welcome,#app .storage,#app #files-layout,#app #links-panel,#app #ps4-panel,#app #dm-panel,#app .paypal-donation{display:none!important}'+" +
        "'#app.beta-mode{min-height:100svh!important;background:transparent!important}#app.beta-mode .wrap{width:100%!important;max-width:none!important;min-height:100svh!important;margin:0!important;padding:env(safe-area-inset-top) 10px calc(10px + env(safe-area-inset-bottom))!important}'+" +
        "'#app.beta-mode #beta-panel{display:flex!important;width:100%!important;min-height:100svh!important;margin:0!important;padding:12px!important;border:0!important;border-radius:0!important;background:linear-gradient(180deg,rgba(3,8,29,.12),rgba(3,8,29,.20)),url(/beta-assets/beta-wallpaper.svg) center/cover fixed no-repeat!important;box-shadow:none!important}'+" +
        "'#app.beta-mode #beta-panel .beta-workspace{background:transparent!important;min-height:calc(100svh - 24px)!important}#app.beta-mode #beta-panel .beta-header{background:rgba(4,10,35,.48)!important;border:1px solid rgba(202,218,255,.2)!important;border-radius:16px!important;backdrop-filter:blur(8px)!important}'+" +
        "'#app.beta-mode #beta-panel .beta-chat-stage{background:rgba(3,8,29,.08)!important;border:1px solid rgba(202,218,255,.14)!important;border-radius:18px!important;backdrop-filter:none!important}#app.beta-mode #beta-panel .beta-messages{background:transparent!important}'+" +
        "'#app.beta-mode #beta-panel .beta-message{background:rgba(5,14,42,.76)!important;color:#f6f7ff!important;backdrop-filter:blur(8px)!important}#app.beta-mode #beta-panel .beta-composer,#app.beta-mode #beta-panel .beta-activity{background:rgba(4,10,35,.82)!important;border-color:rgba(202,218,255,.24)!important;backdrop-filter:blur(12px)!important}'+" +
        "'#app.beta-mode #beta-panel .beta-settings{background:rgba(4,10,35,.97)!important}#app.beta-mode #beta-panel .beta-orb{background:url(/beta-assets/beta-icon.svg) center/cover no-repeat!important;color:transparent!important}';" +
        "document.head.appendChild(st);}" +
        "var a=document.getElementById('app'),t=document.getElementById('beta-tab');if(a&&!a.classList.contains('hidden')&&!a.classList.contains('beta-mode')&&t&&!t.classList.contains('hidden'))t.click();" +
        "if(!window.__nativeBetaObserver){window.__nativeBetaObserver=new MutationObserver(function(){var x=document.getElementById('app'),b=document.getElementById('beta-tab');if(x&&!x.classList.contains('hidden')&&!x.classList.contains('beta-mode')&&b&&!b.classList.contains('hidden'))b.click();});window.__nativeBetaObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});}" +
        "}catch(e){console.error('Beta native shell:',e);}})();";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(0xFF050B27);
        getWindow().setNavigationBarColor(0xFF050B27);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF050B27);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && (url.startsWith("https://mediachafa-transfer.pages.dev/") || url.startsWith("https://mediachafa-transfer.vercel.app/"))) view.evaluateJavascript(BETA_APP_ENFORCER, null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
                if (host.equals("mediachafa-transfer.pages.dev") || host.equals("mediachafa-transfer.vercel.app") || host.equals("velxgwkujcabdaxbppyj.supabase.co") || host.equals("challenges.cloudflare.com")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (ActivityNotFoundException ignored) { Toast.makeText(MainActivity.this, "No hay una aplicación para abrir este enlace.", Toast.LENGTH_SHORT).show(); }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = params.createIntent();
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(Intent.createChooser(picker, "Elegir archivo para Beta"), FILE_PICKER); return true; }
                catch (ActivityNotFoundException error) { fileCallback = null; Toast.makeText(MainActivity.this, "No se encontró un selector de archivos.", Toast.LENGTH_SHORT).show(); return false; }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean audio = false, camera = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) camera = true;
                    }
                    boolean audioOk = !audio || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                    boolean cameraOk = !camera || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                    if (audioOk && cameraOk) request.grant(request.getResources());
                    else {
                        pendingWebPermission = request;
                        java.util.ArrayList<String> needed = new java.util.ArrayList<>();
                        if (audio && !audioOk) needed.add(Manifest.permission.RECORD_AUDIO);
                        if (camera && !cameraOk) needed.add(Manifest.permission.CAMERA);
                        requestPermissions(needed.toArray(new String[0]), MEDIA_PERMISSION);
                    }
                });
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.setMimeType(mimeType);
                request.setTitle("Descarga de Beta");
                request.setDescription("Descargando archivo desde Beta");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Beta-" + System.currentTimeMillis());
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, "Descarga iniciada.", Toast.LENGTH_SHORT).show();
            } catch (Exception error) { Toast.makeText(this, "No se pudo iniciar la descarga.", Toast.LENGTH_SHORT).show(); }
        });
        setContentView(webView);
        if (savedInstanceState != null) webView.restoreState(savedInstanceState); else webView.loadUrl(APP_URL);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount(); result = new Uri[count];
                    for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) result = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(result); fileCallback = null;
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == MEDIA_PERMISSION && pendingWebPermission != null) {
            boolean granted = true; for (int result : results) if (result != PackageManager.PERMISSION_GRANTED) granted = false;
            if (granted) pendingWebPermission.grant(pendingWebPermission.getResources()); else pendingWebPermission.deny();
            pendingWebPermission = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle outState) { if (webView != null) webView.saveState(outState); super.onSaveInstanceState(outState); }
    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (fileCallback != null) fileCallback.onReceiveValue(null); if (webView != null) { webView.stopLoading(); webView.destroy(); } super.onDestroy(); }
}
