// This fork's packaged builds keep their own data and never take upstream's updates. The macOS
// installer sets the same values through LSEnvironment; Windows and Linux have no equivalent.
const { app } = require("electron");
if (app.isPackaged) {
  const path = require("node:path");
  process.env.T3CODE_HOME ??= path.join(require("node:os").homedir(), ".t3-fork");
  process.env.T3CODE_DESKTOP_USER_DATA_DIR ??= path.join(app.getPath("appData"), "t3code-fork");
  process.env.T3CODE_DISABLE_AUTO_UPDATE ??= "1";
}
require("./compileCache.cjs");
require("./main.cjs");
