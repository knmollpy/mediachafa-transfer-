package com.mediachafa.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ExternalLink")
public class ExternalLinkPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String rawUrl = call.getString("url");
        if (rawUrl == null || !(rawUrl.startsWith("https://") || rawUrl.startsWith("http://"))) {
            call.reject("El enlace externo no es válido.");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("No se pudo abrir el enlace en el navegador.", error);
        }
    }
}
