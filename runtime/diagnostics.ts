type DiagnosticReporter = (message: string) => void;

const pendingDiagnostics: string[] = [];
let diagnosticReporter: DiagnosticReporter | undefined;
let draining = false;

/** Stop at a failed delivery so later notifications cannot overtake it. */
function drainDiagnostics(): void {
	if (!diagnosticReporter || draining) return;
	draining = true;
	let delivered = 0;
	try {
		while (delivered < pendingDiagnostics.length) {
			const reporter = diagnosticReporter;
			const message = pendingDiagnostics[delivered];
			if (!reporter || message === undefined) break;
			try {
				reporter(message);
			} catch {
				break;
			}
			delivered++;
		}
	} finally {
		pendingDiagnostics.splice(0, delivered);
		draining = false;
	}
}

/** Buffer runtime diagnostics until a UI reporter can accept them. Never writes to the terminal. */
export function reportDiagnostic(message: string): void {
	pendingDiagnostics.push(message.startsWith("[zhomp] ") ? message : `[zhomp] ${message}`);
	drainDiagnostics();
}

/** Attach a live UI reporter, or detach it when the session shuts down. */
export function setDiagnosticReporter(reporter: DiagnosticReporter | undefined): void {
	diagnosticReporter = reporter;
	drainDiagnostics();
}
