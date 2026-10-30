const cursorPositionReportPattern = /\x1b\[\d+;\d+R/;

export function createPtyReplyWriter(
	write: (data: string) => void,
	platform: NodeJS.Platform = process.platform,
): (reply: string) => void {
	let ignoredWindowsHandshake = false;
	return reply => {
		if (platform !== "win32" || ignoredWindowsHandshake) {
			write(reply);
			return;
		}

		const match = cursorPositionReportPattern.exec(reply);
		if (!match) {
			write(reply);
			return;
		}

		ignoredWindowsHandshake = true;
		const before = reply.slice(0, match.index);
		const after = reply.slice(match.index + match[0].length);
		if (before || after) write(before + after);
	};
}
