/* eslint-disable no-console */

let debugEnabled = false;

type Logger = typeof console.log;

function timeString(): string {
	return new Date().toISOString();
}
function dolog(logger: Logger, parts: unknown[]) {
	logger.apply(console, [timeString() as unknown].concat(parts));
}
type Level = "error" | "info" | "debug";

function log(level: Level, msg: unknown[]) {
	if (level == "error") return dolog(console.error, ["ERROR" as unknown].concat(msg));
	if (level == "info") return dolog(console.log, msg);
	if (level == "debug" && debugEnabled) return dolog(console.log, ["DEBUG" as unknown].concat(msg));
}

const logger = {
	enableDebug: () => (debugEnabled = true),
	info: function (...msg: unknown[]) {
		log("info", msg);
	},
	error: function (...msg: unknown[]) {
		log("error", msg);
	},
	debug: function (...msg: unknown[]) {
		log("debug", msg);
	},
};

export default logger;
