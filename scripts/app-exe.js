// Prints the program to run the server with: runtime\StartPage.exe (built if needed), or Node.
// "node scripts/app-exe.js test" gives the test environment's StartPage-Test.exe instead.
// Also builds the tray icon program, so any problem shows up here rather than at sign-in.
const { ensureAppExe } = require('../lib/appexe');
const { ensureTray } = require('../lib/tray');
const env = process.argv[2] === 'test' ? 'test' : 'live';
Promise.all([ensureAppExe(process.execPath, env), ensureTray(env)]).then(([app]) => console.log(app));
