package com.mediachafa.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DownloadLocationPlugin.class);
        registerPlugin(ExternalLinkPlugin.class);
        registerPlugin(MediaFtpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
