require('console-stamp')(console, 'HH:MM:ss.l');

const chokidar = require('chokidar');
const { spawn } = require('child_process');

let ignoreOnStartup = true;

// to overcome bug causing "add" events on startup
setTimeout(() => ignoreOnStartup = false, 2000);

chokidar.watch('./src/').on('all', (event, path) => {
	if (ignoreOnStartup) {
		return;
	}
	
	const res = spawn('npm', ['run', 'build'], {
		stdio: (process.argv.indexOf('--verbose') > -1) ? 'inherit' : null
	});

	res.on('close', (exitCode) => {
		console.log(`Finished with exit code: ${exitCode}`);
	})
});