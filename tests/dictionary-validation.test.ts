import { deepStrictEqual, throws } from "node:assert";
import { describe, test } from "bun:test";
import { parseDictionaryText } from "./dictionary-validation";

describe("dictionary JSON validation", () => {
	test("parses a JSON object with nonempty string translations", () => {
		deepStrictEqual(parseDictionaryText('{"source":"译文"}'), { source: "译文" });
	});

	test("rejects duplicate keys after JSON escape decoding", () => {
		throws(() => parseDictionaryText('{"key":"first","\\u006bey":"second"}'));
	});

	test("rejects invalid JSON, non-object roots, and invalid translation values", () => {
		for (const source of [
			'{"source":}',
			"null",
			"[]",
			'{"source":null}',
			'{"source":1}',
			'{"source":""}',
		]) {
			throws(() => parseDictionaryText(source), /.+/);
		}
	});
});
