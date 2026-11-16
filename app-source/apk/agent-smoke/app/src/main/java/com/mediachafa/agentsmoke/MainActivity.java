package com.mediachafa.agentsmoke;
import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
public final class MainActivity extends Activity {
 @Override public void onCreate(Bundle state) { super.onCreate(state); TextView view = new TextView(this); view.setText("MediaChafa APK build pipeline OK"); view.setTextSize(22); view.setPadding(24,24,24,24); setContentView(view); }
}
