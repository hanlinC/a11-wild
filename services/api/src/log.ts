/**
 * JSON line logger. Pass only named, safe fields: never a header, a cookie,
 * a token or a tool argument.
 */
type Fields = Record<string, string | number | boolean | undefined>;

function write(level: "info" | "warn" | "error", event: string, fields: Fields): void {
  process.stdout.write(JSON.stringify({ level, event, ...fields }) + "\n");
}

export const log = {
  info: (event: string, fields: Fields = {}) => write("info", event, fields),
  warn: (event: string, fields: Fields = {}) => write("warn", event, fields),
  error: (event: string, fields: Fields = {}) => write("error", event, fields),
};
