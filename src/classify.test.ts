import { describe, it, expect } from "vitest";
import { classify, siteOf, type CategorySignatures, type PageProbe } from "./classify.js";

function probe(url: string, present: string[] = []): PageProbe {
  return { url, has: (sel) => present.includes(sel) };
}

const cats: CategorySignatures[] = [
  { category: "teamtailor", signatures: [{ url_glob: "*.teamtailor.com/*" }, { selector: "[data-tt-application]" }] },
  { category: "greenhouse", signatures: [{ url_glob: "*greenhouse.io/*", selector: "#application_form" }] },
];

describe("classify", () => {
  it("siteOf returns the host", () => {
    expect(siteOf("https://careers.teamtailor.com/jobs/42")).toBe("careers.teamtailor.com");
    expect(siteOf("not a url")).toBe("");
  });

  it("matches a category by URL glob", async () => {
    expect(await classify(probe("https://careers.teamtailor.com/jobs/42"), cats)).toEqual({
      site: "careers.teamtailor.com",
      category: "teamtailor",
    });
  });

  it("matches a category by DOM selector when the URL doesn't", async () => {
    expect(await classify(probe("https://jobs.acme.se/apply", ["[data-tt-application]"]), cats)).toEqual({
      site: "jobs.acme.se",
      category: "teamtailor",
    });
  });

  it("requires ALL present conditions of a signature (glob AND selector)", async () => {
    // greenhouse signature needs both the glob AND #application_form
    expect((await classify(probe("https://boards.greenhouse.io/x"), cats)).category).toBe("");
    expect((await classify(probe("https://boards.greenhouse.io/x", ["#application_form"]), cats)).category).toBe(
      "greenhouse",
    );
  });

  it("returns an empty category when nothing matches (site still resolved)", async () => {
    expect(await classify(probe("https://unknown.se/apply"), cats)).toEqual({
      site: "unknown.se",
      category: "",
    });
  });
});
