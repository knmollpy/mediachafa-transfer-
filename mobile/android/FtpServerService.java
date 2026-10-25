package com.mediachafa.app;

import android.app.*;
import android.content.*;
import android.os.*;
import java.io.*;
import java.net.*;
import org.apache.ftpserver.*;
import org.apache.ftpserver.ftplet.*;
import org.apache.ftpserver.listener.*;
import org.apache.ftpserver.usermanager.*;
import org.apache.ftpserver.usermanager.impl.*;

/** On-demand anonymous FTP share, scoped to the app's MediaChafaFTP directory. */
public class FtpServerService extends Service {
    static volatile FtpServer server;
    static volatile int activePort = 2121;
    static volatile String activeIp = "";
    static volatile boolean writable = false;
    static final String CHANNEL = "mediachafa_ftp";
    @Override public void onCreate() { super.onCreate(); if (Build.VERSION.SDK_INT >= 26) { NotificationChannel c = new NotificationChannel(CHANNEL,"Servidor FTP",NotificationManager.IMPORTANCE_LOW); getSystemService(NotificationManager.class).createNotificationChannel(c); } }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(4212, new Notification.Builder(this, CHANNEL).setContentTitle("MediaChafa FTP activo").setContentText("Puerto " + activePort + " · carpeta MediaChafaFTP").setSmallIcon(android.R.drawable.stat_sys_upload_done).setOngoing(true).build());
        try {
            if (server != null && !server.isStopped()) return START_NOT_STICKY;
            activePort = intent.getIntExtra("port",2121); writable = intent.getBooleanExtra("writable",false); activeIp = intent.getStringExtra("ip");
            File root = new File(getExternalFilesDir(null),"MediaChafaFTP"); if (!root.exists() && !root.mkdirs()) throw new IOException("No se pudo crear la carpeta FTP.");
            PropertiesUserManagerFactory users = new PropertiesUserManagerFactory(); users.setFile(new File(getFilesDir(),"ftp-users.properties")); org.apache.ftpserver.ftplet.UserManager manager=users.createUserManager(); BaseUser anonymous=new BaseUser(); anonymous.setName("anonymous"); anonymous.setPassword(""); anonymous.setHomeDirectory(root.getCanonicalPath()); if(writable) anonymous.setAuthorities(java.util.Collections.singletonList(new WritePermission())); manager.save(anonymous);
            ListenerFactory listener=new ListenerFactory(); listener.setPort(activePort); listener.setServerAddress(activeIp);
            DataConnectionConfigurationFactory data=new DataConnectionConfigurationFactory(); data.setPassivePorts("30000-30010"); data.setPassiveAddress(activeIp); listener.setDataConnectionConfiguration(data.createDataConnectionConfiguration());
            FtpServerFactory factory=new FtpServerFactory(); factory.addListener("default",listener.createListener()); factory.setUserManager(manager); ConnectionConfigFactory config=new ConnectionConfigFactory(); config.setAnonymousLoginEnabled(true); factory.setConnectionConfig(config.createConnectionConfig()); server=factory.createServer(); server.start();
        } catch (Exception e) { stopForeground(true); stopSelf(); }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy(){ FtpServer current=server; server=null; if(current!=null) try{current.stop();}catch(Exception ignored){} stopForeground(true); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent){return null;}
    static File root(Context context){return new File(context.getExternalFilesDir(null),"MediaChafaFTP");}
}
