import { describe, expect, it } from "vitest";

import { escapeHtml, invitationEmail, renderEmail, testEmailMessage } from "../src/template.js";

/**
 * What a notification says (spec §5.1, §6).
 *
 * The tests worth having here are about the two properties that are easy to
 * lose and impossible to notice: that the farm name is never a literal, and
 * that the text part says everything the HTML part does.
 */

const BLOCKS = {
  farmName: "Flying Double M",
  subject: "Calving watch",
  heading: "Day 279",
  paragraphs: ["Pressure is falling.", "The moon is full on Thursday."],
};

describe("renderEmail", () => {
  it("puts the farm name in both parts", () => {
    // §5.1: the farm name is a global variable injected into every email
    // template, never a string in code. Both names are still undecided, so
    // this is the test that stops one of them being written down.
    const email = renderEmail(BLOCKS);

    expect(email.html).toContain("Flying Double M");
    expect(email.body).toContain("Flying Double M");
  });

  it("says the same thing in text as in HTML", () => {
    // The text part is what a watch, a screen reader and a phone with images
    // off actually render. Built from the same blocks rather than written
    // twice, because the copy that drifts is always this one.
    const email = renderEmail(BLOCKS);

    for (const paragraph of BLOCKS.paragraphs) {
      expect(email.body).toContain(paragraph);
      expect(email.html).toContain(paragraph);
    }
    expect(email.body).toContain("Day 279");
  });

  it("carries the subject through unchanged", () => {
    expect(renderEmail(BLOCKS).subject).toBe("Calving watch");
  });

  it("renders a link as a button in HTML and a plain URL in text", () => {
    const email = renderEmail({
      ...BLOCKS,
      action: { label: "Open the farm records", url: "https://galaxyfarm.netlify.app" },
    });

    expect(email.html).toContain('href="https://galaxyfarm.netlify.app/"');
    // Spelled out rather than hidden behind label text: a text-part reader
    // cannot click a word.
    expect(email.body).toContain("Open the farm records: https://galaxyfarm.netlify.app/");
  });

  it("drops a link that is not http", () => {
    // The URL is built by the app from its own origin, so this guards a
    // mistake rather than an attacker — but `javascript:` in an href is how a
    // template that accepts a URL becomes a way to attack whoever opens it.
    const email = renderEmail({
      ...BLOCKS,
      action: { label: "Tap here", url: "javascript:alert(1)" },
    });

    expect(email.html).not.toContain("javascript:");
    expect(email.body).not.toContain("Tap here");
  });

  it("survives a name with an angle bracket in it", () => {
    const email = renderEmail({ ...BLOCKS, farmName: "Bar <M> Ranch & Co" });

    expect(email.html).toContain("Bar &lt;M&gt; Ranch &amp; Co");
    expect(email.html).not.toContain("<M>");
    // The text part is not markup and keeps it as typed.
    expect(email.body).toContain("Bar <M> Ranch & Co");
  });

  it("leaves out the footer and the button when there are none", () => {
    const email = renderEmail(BLOCKS);

    expect(email.html).not.toContain("<a href");
    expect(email.html).toContain("</html>");
  });
});

describe("testEmailMessage", () => {
  const input = {
    farmName: "Flying Double M",
    sentBy: "Eli",
    sentAt: new Date("2026-08-14T15:04:05Z"),
    origin: "https://galaxyfarm.netlify.app",
  };

  it("says in the subject that it is a test", () => {
    // Somebody proving the wiring works will send several of these. One that
    // arrived looking like a real calving alert would be worse than no test.
    expect(testEmailMessage(input).subject).toBe("Test email from Flying Double M");
  });

  it("names who sent it and when", () => {
    const email = testEmailMessage(input);

    expect(email.body).toContain("Eli");
    expect(email.body).toContain("2026-08-14 15:04");
  });

  it("links back to the app when it knows where it is", () => {
    expect(testEmailMessage(input).html).toContain("https://galaxyfarm.netlify.app");
  });

  it("works with no origin to link to", () => {
    const email = testEmailMessage({ ...input, origin: undefined });

    expect(email.html).not.toContain("<a href");
    expect(email.subject).toBe("Test email from Flying Double M");
  });

  it("tells an unexpecting reader what happened", () => {
    // The address may belong to a housesitter who has never heard of this app.
    expect(testEmailMessage(input).body).toContain("If you were not expecting this");
  });
});

describe("invitationEmail", () => {
  const input = {
    farmName: "Flying Double M",
    name: "Sam",
    invitedBy: "Eli",
    url: "https://galaxyfarm.netlify.app/invite/abc123",
    expiresInDays: 7,
  };

  it("names who added them, which is what makes it not look like spam", () => {
    const email = invitationEmail(input);

    expect(email.subject).toBe("Eli added you to Flying Double M");
    expect(email.body).toContain("Eli");
    expect(email.body).toContain("Sam");
  });

  it("carries the link in both parts", () => {
    // The text part matters here more than anywhere else: this is the one
    // email where being unable to reach the link means being unable to sign in.
    const email = invitationEmail(input);

    expect(email.html).toContain("https://galaxyfarm.netlify.app/invite/abc123");
    expect(email.body).toContain("https://galaxyfarm.netlify.app/invite/abc123");
  });

  it("says the link is single-use and when it lapses", () => {
    expect(invitationEmail(input).body).toContain("works once and lapses after 7 days");
  });

  it("says day rather than days when there is one", () => {
    expect(invitationEmail({ ...input, expiresInDays: 1 }).body).toContain("after 1 day.");
  });

  it("promises nobody sees the password they pick", () => {
    expect(invitationEmail(input).body).toContain("Nobody at the farm ever sees the password");
  });

  it("states a housesitter's window, because outside it nothing works", () => {
    // An account that stops working on a date nobody mentioned reads as a
    // fault, and the window is the whole reason the role exists (§4.3).
    const email = invitationEmail({
      ...input,
      accessWindow: { from: "June 1, 2026", to: "June 14, 2026" },
    });

    expect(email.body).toContain("June 1, 2026 to June 14, 2026");
    expect(email.body).toContain("Outside those dates");
  });

  it("leaves the window out for everybody else", () => {
    expect(invitationEmail(input).body).not.toContain("Outside those dates");
  });

  it("reads as a reset when it is one", () => {
    // §4.3 makes re-issuing and resetting the same action, so it is the same
    // email with one sentence different — two templates would drift.
    const email = invitationEmail({ ...input, reissued: true });

    expect(email.subject).toBe("Reset your password for Flying Double M");
    expect(email.body).toContain("Any earlier one has stopped working");
    expect(email.body).toContain("https://galaxyfarm.netlify.app/invite/abc123");
  });

  it("tells an unexpecting reader nothing was set up in their name", () => {
    expect(invitationEmail(input).body).toContain("nothing was set up in your name");
  });
});

describe("escapeHtml", () => {
  it("escapes every character that changes the meaning of markup", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first, so an escape is not escaped twice", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
