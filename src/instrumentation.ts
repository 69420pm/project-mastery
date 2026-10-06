export async function register() {
  // The OpenTelemetry Node SDK does not run on the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTracing } = await import("./lib/tracing/node");
    startTracing();
  }
}
