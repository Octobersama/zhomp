import { deepStrictEqual } from "node:assert";
import { describe, test } from "bun:test";
import { createPtyReplyWriter } from "./terminal-replies";

describe("PTY terminal reply forwarding", () => {
	test("suppresses only the first Windows cursor-position reply", () => {
		const writes: string[] = [];
		const writeReply = createPtyReplyWriter(reply => { writes.push(reply); }, "win32");

		writeReply("\x1b[?1;2R\x1b[?1u\x1b[7;19R\x1b[?2004h");
		writeReply("\x1b[8;20R");

		deepStrictEqual(writes, ["\x1b[?1;2R\x1b[?1u\x1b[?2004h", "\x1b[8;20R"]);
	});

	test("forwards cursor-position replies on POSIX", () => {
		for (const platform of ["linux", "darwin"] as const) {
			const writes: string[] = [];
			const writeReply = createPtyReplyWriter(reply => { writes.push(reply); }, platform);
			const reply = "\x1b[?1u\x1b[7;19R\x1b[?2004h";

			writeReply(reply);

			deepStrictEqual(writes, [reply]);
		}
	});
});
