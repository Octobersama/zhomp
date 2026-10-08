import * as ts from "typescript";

export type Dictionary = Record<string, string>;

export function parseDictionaryText(source: string): Dictionary {
	const syntax = ts.parseJsonText("dictionary.json", source);
	const root = syntax.statements[0]?.expression;
	if (!root || !ts.isObjectLiteralExpression(root)) {
		throw new Error("Dictionary must be a JSON object.");
	}

	const keys = new Set<string>();
	for (const property of root.properties) {
		if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) {
			throw new Error("Dictionary keys must be JSON strings.");
		}
		const key = property.name.text;
		if (keys.has(key)) throw new Error(`Duplicate dictionary key ${JSON.stringify(key)}.`);
		keys.add(key);
	}

	const parsed: unknown = JSON.parse(source);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Dictionary must be a JSON object.");
	}
	const dictionary = parsed as Record<string, unknown>;
	for (const [key, translation] of Object.entries(dictionary)) {
		if (typeof translation !== "string" || translation.length === 0) {
			throw new Error(`Dictionary translation for ${JSON.stringify(key)} must be a nonempty string.`);
		}
	}
	return dictionary as Dictionary;
}
