package com.mediachafa.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "DownloadLocation")
public class DownloadLocationPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void saveUrlFile(PluginCall call) {
        String rawUrl = call.getString("url");
        String fileName = call.getString("fileName", "MediaChafa-download");
        JSONObject requestHeaders = call.getObject("headers");
        if (rawUrl == null || !(rawUrl.startsWith("https://") || rawUrl.startsWith("http://"))) {
            call.reject("La URL de descarga no es válida.");
            return;
        }
        fileName = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        call.getData().put("downloadHeaders", requestHeaders == null ? new JSONObject() : requestHeaders);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) intent.putExtra("android.content.extra.SHOW_ADVANCED", true);
        startActivityForResult(call, intent, "saveLocationPicked");
    }

    @ActivityCallback
    private void saveLocationPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new com.getcapacitor.JSObject().put("cancelled", true));
            return;
        }
        Uri destination = result.getData().getData();
        String rawUrl = call.getString("url");
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(rawUrl);
                URLConnection opened = url.openConnection();
                opened.setConnectTimeout(30000);
                opened.setReadTimeout(120000);
                if (!(opened instanceof HttpURLConnection)) throw new IllegalArgumentException("El servidor no permite descargar este archivo por HTTP.");
                connection = (HttpURLConnection) opened;
                connection.setInstanceFollowRedirects(true);
                JSONObject headers = call.getObject("downloadHeaders");
                if (headers != null) {
                    java.util.Iterator<String> names = headers.keys();
                    while (names.hasNext()) {
                        String name = names.next();
                        connection.setRequestProperty(name, headers.optString(name));
                    }
                }
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("El servidor respondió con error " + status + ".");
                try (InputStream input = connection.getInputStream(); OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new IllegalStateException("No se pudo abrir el destino elegido.");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                }
                call.resolve(new com.getcapacitor.JSObject().put("cancelled", false));
            } catch (Exception error) {
                call.reject("No se pudo guardar el archivo: " + error.getMessage(), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }
}
