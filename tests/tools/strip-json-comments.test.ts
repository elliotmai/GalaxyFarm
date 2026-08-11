import { describe, expect, it } from "vitest";

import { stripJsonComments } from "../../tools/workspace.js";

/**
 * Reading JSONC.
 *
 * `tsconfig.json` has always accepted comments, and the reason a compiler
 * option is set belongs next to the option. The risk in stripping them is
 * doing it inside a string — a path containing `//` is ordinary, and a
 * stripper that ate the rest of the line would silently corrupt the config it
 * was reading.
 */

describe("stripJsonComments", () => {
  it("leaves ordinary JSON alone", () => {
    const json = '{"a": 1, "b": [2, 3]}';
    expect(JSON.parse(stripJsonComments(json))).toEqual({ a: 1, b: [2, 3] });
  });

  it("removes a line comment", () => {
    const parsed = JSON.parse(stripJsonComments('{\n  // why\n  "a": 1\n}'));
    expect(parsed).toEqual({ a: 1 });
  });

  it("removes a trailing line comment without eating the line", () => {
    expect(JSON.parse(stripJsonComments('{ "a": 1 } // done'))).toEqual({ a: 1 });
  });

  it("removes a block comment, including one spanning lines", () => {
    expect(JSON.parse(stripJsonComments('{ /* why */ "a": 1 }'))).toEqual({ a: 1 });
    expect(JSON.parse(stripJsonComments('{\n/*\n why\n*/\n"a": 1 }'))).toEqual({ a: 1 });
  });

  it("does not touch a // inside a string", () => {
    // The failure mode: a URL or a path in a config, and everything after it
    // on that line quietly disappearing.
    const json = '{ "url": "https://example.com/x", "a": 1 }';
    expect(JSON.parse(stripJsonComments(json))).toEqual({
      url: "https://example.com/x",
      a: 1,
    });
  });

  it("does not touch a /* inside a string", () => {
    const json = '{ "glob": "src/**/*", "a": 1 }';
    expect(JSON.parse(stripJsonComments(json))).toEqual({ glob: "src/**/*", a: 1 });
  });

  it("handles an escaped quote inside a string", () => {
    // Getting this wrong makes the parser think the string ended, and
    // everything after it is read as structure.
    const json = '{ "quoted": "say \\"hi\\" // now", "a": 1 }';
    expect(JSON.parse(stripJsonComments(json))).toEqual({ quoted: 'say "hi" // now', a: 1 });
  });

  it("handles an escaped backslash before a closing quote", () => {
    const json = '{ "path": "C:\\\\", "a": 1 }';
    expect(JSON.parse(stripJsonComments(json))).toEqual({ path: "C:\\", a: 1 });
  });
});
