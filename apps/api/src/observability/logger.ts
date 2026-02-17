export type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, payload: Record<string, unknown>) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export function logInfo(event: string, payload: Record<string, unknown> = {}) {
  write("info", event, payload);
}

export function logWarn(event: string, payload: Record<string, unknown> = {}) {
  write("warn", event, payload);
}

export function logError(event: string, payload: Record<string, unknown> = {}) {
  write("error", event, payload);
}

