import { deepStrictEqual } from "node:assert";
import { afterEach, beforeEach, describe, test } from "bun:test";
import { reportDiagnostic, setDiagnosticReporter } from "../runtime/diagnostics";

function clearDiagnostics(): void {
	setDiagnosticReporter(() => {});
	setDiagnosticReporter(undefined);
}

beforeEach(clearDiagnostics);
afterEach(clearDiagnostics);

describe("runtime diagnostic delivery", () => {
	test("buffers before UI attachment, adds one prefix, and does not repeat successful notifications", () => {
		const received: string[] = [];
		reportDiagnostic("model source unsupported");
		reportDiagnostic("[zhomp] settings source unsupported");
		const receive = (message: string): void => { received.push(message); };
		setDiagnosticReporter(receive);
		deepStrictEqual(received, ["[zhomp] model source unsupported", "[zhomp] settings source unsupported"]);
		setDiagnosticReporter(receive);
		deepStrictEqual(received, ["[zhomp] model source unsupported", "[zhomp] settings source unsupported"]);
	});

	test("retains a failed notification and its successors without replaying successful deliveries", () => {
		const received: string[] = [];
		reportDiagnostic("first");
		reportDiagnostic("second");
		reportDiagnostic("third");
		setDiagnosticReporter(message => {
			if (message === "[zhomp] second") throw new Error("UI unavailable");
			received.push(message);
		});
		deepStrictEqual(received, ["[zhomp] first"]);
		setDiagnosticReporter(message => { received.push(message); });
		deepStrictEqual(received, ["[zhomp] first", "[zhomp] second", "[zhomp] third"]);
	});

	test("detaches the old session and preserves FIFO when a reporter adds another diagnostic", () => {
		const oldSession: string[] = [];
		const newSession: string[] = [];
		setDiagnosticReporter(message => { oldSession.push(message); });
		reportDiagnostic("old session");
		setDiagnosticReporter(undefined);
		reportDiagnostic("queued first");
		reportDiagnostic("queued second");
		deepStrictEqual(oldSession, ["[zhomp] old session"]);
		setDiagnosticReporter(message => {
			newSession.push(message);
			if (message === "[zhomp] queued first") reportDiagnostic("from reporter");
		});
		deepStrictEqual(newSession, ["[zhomp] queued first", "[zhomp] queued second", "[zhomp] from reporter"]);
		deepStrictEqual(oldSession, ["[zhomp] old session"]);
	});
});
