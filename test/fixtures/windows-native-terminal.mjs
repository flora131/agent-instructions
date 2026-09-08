const watchdog = setTimeout(() => process.exit(91), 12000);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(`READY:${process.stdin.isTTY}:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}\r\n`);
process.stdin.on("data", (bytes) => {
	const text = bytes.toString("utf8");
	if (text.includes("size")) {
		const [columns, rows] = process.stdout.getWindowSize();
		process.stdout.write(`SIZE:${columns}x${rows}\r\n`);
	}
	if (text.includes("hello")) process.stdout.write("INPUT:hello\r\n");
	if (text.includes("done")) {
		process.stdout.write("TERMINAL_DONE\r\n", () => {
			clearTimeout(watchdog);
			process.exit(7);
		});
	}
});
