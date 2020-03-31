/* eslint-disable no-console */

let debugEnabled = false;


function timeString() {
  return (new Date()).toISOString();
}
function dolog(logger, parts) {
  logger.apply(console, [timeString()].concat(parts));
}

function log(level, msg) {
  if (level == 'error') return dolog(console.error, ['ERROR'].concat(msg));
  if (level == 'info') return dolog(console.log, msg);
  if (level == 'debug' && debugEnabled) return dolog(console.log, ['DEBUG'].concat(msg));
}

module.exports = {
  enableDebug: () => debugEnabled = true,
  info  : function(...msg) { log('info', msg); },
  error  : function(...msg) { log('error', msg); },
  debug  : function(...msg) { log('debug', msg); }
};