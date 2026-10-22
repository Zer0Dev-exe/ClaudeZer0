package es.zer0dev.zer0code;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Actualizaciones de la app: mira el último release de GitHub y, si es más nuevo que esta versión, ofrece
 * descargar el APK y abrir el instalador de Android. La firma del APK la comprueba el propio sistema: solo se
 * instala si está firmado con la misma clave que la app instalada.
 */
final class Updater {
    private static final String API = "https://api.github.com/repos/Zer0Dev-exe/Zer0Code/releases/latest";
    private static final String PREFS = "zer0code";
    private static final String KEY_SKIPPED = "update_skipped";
    private static final String KEY_CHECKED_AT = "update_checked_at";
    private static final long CHECK_EVERY_MS = 6L * 60 * 60 * 1000;

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    /** Descarga en curso (o terminada y a la espera de que se conceda el permiso de instalar) */
    private static long downloadId = -1;
    private static boolean waitingForPermission = false;
    private static BroadcastReceiver receiver;

    private Updater() {}

    /** Datos del release más nuevo */
    private static final class Release {
        String version;
        String notes;
        String page;
        String apkName;
        String apkUrl;
    }

    /** '1.3.10' -> {1,3,10}; null si no es una versión */
    static int[] parse(String v) {
        if (v == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^v?(\\d+)\\.(\\d+)\\.(\\d+)").matcher(v.trim());
        if (!m.find()) return null;
        return new int[] { Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)) };
    }

    /** Positivo si a es más nueva que b */
    static int compare(String a, String b) {
        int[] x = parse(a);
        int[] y = parse(b);
        if (x == null || y == null) return 0;
        for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] - y[i];
        return 0;
    }

    /**
     * Comprueba si hay versión nueva. Al abrir la app se hace como mucho cada 6 horas y sin molestar si no hay nada;
     * con manual=true se responde siempre.
     */
    static void check(final Activity activity, final boolean manual) {
        final SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!manual && System.currentTimeMillis() - prefs.getLong(KEY_CHECKED_AT, 0) < CHECK_EVERY_MS) return;

        IO.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Release release = fetchLatest();
                    prefs.edit().putLong(KEY_CHECKED_AT, System.currentTimeMillis()).apply();
                    final Release found = release;
                    final boolean newer = found != null && compare(found.version, BuildConfig.VERSION_NAME) > 0;
                    final boolean skipped = found != null && found.version.equals(prefs.getString(KEY_SKIPPED, ""));
                    MAIN.post(new Runnable() {
                        @Override
                        public void run() {
                            if (activity.isFinishing()) return;
                            if (newer && (manual || !skipped)) offer(activity, found);
                            else if (manual) Toast.makeText(activity, "Zer0Code " + BuildConfig.VERSION_NAME + " está al día", Toast.LENGTH_LONG).show();
                        }
                    });
                } catch (final Exception e) {
                    if (manual) {
                        MAIN.post(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(activity, "No se pudo comprobar las actualizaciones", Toast.LENGTH_LONG).show();
                            }
                        });
                    }
                }
            }
        });
    }

    private static Release fetchLatest() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(API).openConnection();
        try {
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("User-Agent", "Zer0Code-Android/" + BuildConfig.VERSION_NAME);
            if (connection.getResponseCode() != 200) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) > 0 && out.size() < 512 * 1024) out.write(buffer, 0, n);
            }
            JSONObject json = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            Release release = new Release();
            release.version = json.optString("tag_name", "").replaceFirst("^[vV]", "");
            release.notes = json.optString("body", "");
            release.page = json.optString("html_url", "");
            JSONArray assets = json.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    String name = asset.optString("name", "");
                    if (name.toLowerCase().endsWith(".apk")) {
                        release.apkName = name;
                        release.apkUrl = asset.optString("browser_download_url", "");
                        break;
                    }
                }
            }
            // CI sube el APK unos minutos después de publicar el release: hasta entonces no se ofrece nada
            if (release.apkUrl == null || release.apkUrl.isEmpty()) return null;
            return parse(release.version) == null ? null : release;
        } finally {
            connection.disconnect();
        }
    }

    // ------------------------------------------------------------------------
    // Aviso y descarga
    // ------------------------------------------------------------------------
    private static void offer(final Activity activity, final Release release) {
        String notes = release.notes == null ? "" : release.notes.trim();
        if (notes.length() > 600) notes = notes.substring(0, 600) + "…";
        String message = "Tienes la versión " + BuildConfig.VERSION_NAME + " y ya está disponible la " + release.version + "."
                + (notes.isEmpty() ? "" : "\n\n" + notes);

        AlertDialog.Builder dialog = new AlertDialog.Builder(activity)
                .setTitle("Nueva versión de Zer0Code")
                .setMessage(message)
                .setNegativeButton("Más tarde", null)
                .setNeutralButton("Omitir esta versión", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface d, int which) {
                        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_SKIPPED, release.version).apply();
                    }
                });
        if (release.apkUrl != null && !release.apkUrl.isEmpty()) {
            dialog.setPositiveButton("Actualizar", new android.content.DialogInterface.OnClickListener() {
                @Override
                public void onClick(android.content.DialogInterface d, int which) {
                    download(activity, release);
                }
            });
        } else {
            dialog.setPositiveButton("Ver en GitHub", new android.content.DialogInterface.OnClickListener() {
                @Override
                public void onClick(android.content.DialogInterface d, int which) {
                    openPage(activity, release.page);
                }
            });
        }
        dialog.show();
    }

    private static void openPage(Activity activity, String url) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
            // sin navegador: nada que hacer
        }
    }

    private static void download(final Activity activity, final Release release) {
        try {
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(release.apkUrl));
            request.setTitle("Zer0Code " + release.version);
            request.setDescription("Descargando la actualización");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, release.apkName);
            downloadId = manager.enqueue(request);
            waitingForPermission = false;

            if (receiver != null) {
                try {
                    activity.getApplicationContext().unregisterReceiver(receiver);
                } catch (Exception ignored) {
                    // ya estaba dado de baja
                }
            }
            final Context app = activity.getApplicationContext();
            receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id != downloadId) return;
                    try {
                        app.unregisterReceiver(this);
                    } catch (Exception ignored) {
                        // ya estaba dado de baja
                    }
                    receiver = null;
                    install(context);
                }
            };
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            else app.registerReceiver(receiver, filter);
            Toast.makeText(activity, "Descargando la actualización…", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            // Sin DownloadManager: que lo descargue el navegador
            openPage(activity, release.apkUrl);
        }
    }

    /** Abre el instalador de Android con el APK descargado (pide antes el permiso de «instalar apps desconocidas») */
    private static void install(Context context) {
        if (downloadId < 0) return;
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        Uri uri = manager.getUriForDownloadedFile(downloadId);
        if (uri == null) {
            Toast.makeText(context, "La descarga no se completó", Toast.LENGTH_LONG).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            waitingForPermission = true;
            Toast.makeText(context, "Permite instalar desde Zer0Code y vuelve a la app", Toast.LENGTH_LONG).show();
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(settings);
            return;
        }
        waitingForPermission = false;
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    /** Al volver a la app tras conceder el permiso de instalar: seguir con la instalación pendiente */
    static void onResume(Activity activity) {
        if (waitingForPermission && downloadId >= 0 && Build.VERSION.SDK_INT >= 26 && activity.getPackageManager().canRequestPackageInstalls()) {
            install(activity);
        }
    }
}
