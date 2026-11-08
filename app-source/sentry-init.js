// Captura errores del navegador sin enviar datos personales por defecto.
const config = window.MEDIA_CHAFA_SENTRY || {};
const dsn = typeof config.dsn === "string" ? config.dsn.trim() : "";

if (!dsn) {
  window.mediaChafaSentryStatus = "needs-dsn";
} else {
  const safeUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.origin + url.pathname;
    } catch {
      return String(value || "").split(/[?#]/, 1)[0];
    }
  };

  try {
    const Sentry = await import("https://esm.sh/@sentry/browser@10?bundle");
    Sentry.init({
      dsn,
      environment: config.environment || (location.hostname === "localhost" ? "development" : "production"),
      release: "mediachafa-web@2.5.4",
      sendDefaultPii: false,
      maxBreadcrumbs: 25,
      beforeSend(event) {
        event.user = undefined;
        if (event.request) {
          event.request.headers = undefined;
          event.request.data = undefined;
          if (event.request.url) event.request.url = safeUrl(event.request.url);
        }
        for (const breadcrumb of event.breadcrumbs || []) {
          if (breadcrumb.data?.url) breadcrumb.data.url = safeUrl(breadcrumb.data.url);
          if (breadcrumb.data?.request?.url) breadcrumb.data.request.url = safeUrl(breadcrumb.data.request.url);
        }
        return event;
      }
    });
    window.mediaChafaSentryStatus = "active";
  } catch (error) {
    window.mediaChafaSentryStatus = "error";
    console.warn("[MediaChafa] No se pudo inicializar Sentry.", error);
  }
}
