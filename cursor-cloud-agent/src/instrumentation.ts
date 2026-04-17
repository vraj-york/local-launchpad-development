export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerShutdownHandler } = await import("@/lib/shutdown");
    registerShutdownHandler();
  }
}
