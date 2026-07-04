import { describe, expect, it } from "vitest";
import { buildAnalyseCodebasePrompt } from "@/prompts/analyse-codebase";

const TEMPLATES = {
  actors: "# Actors\n<!-- AI: list actors -->",
  structure: "# Structure\n<!-- AI: list dirs -->",
  "tech-stack": "# Tech Stack\n<!-- AI: list tools -->",
  "qa-static-tools": "# QA\n<!-- AI: list commands -->",
  "qa-engineering": "# QA Eng\n<!-- AI: list principles -->",
  "git-strategy": "# Git\n<!-- AI: list strategy -->",
};

const CONTEXT = {
  readme: "# Readme\nstuff",
  claude: null,
  agents: null,
  prd: null,
};

describe("prompts/analyse-codebase", () => {
  it("renders a full-reinit prompt when all config files are missing", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: [
        "actors",
        "structure",
        "tech-stack",
        "qa-static-tools",
        "qa-engineering",
        "git-strategy",
      ],
    });

    expect(prompt).toContain("Feature Engineer — Analyse Codebase");
    expect(prompt).toContain("not been initialised");
    expect(prompt).toContain("actors");
    expect(prompt).toContain("structure");
    expect(prompt).toContain("tech-stack");
  });

  it("renders a partial-reinit prompt when only some files are missing", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });

    expect(prompt).toContain("partially initialised");
    expect(prompt).toContain("actors");
    // `structure` may appear in the Output Paths list (which lists all six
    // files for reference) but it must NOT appear in the Missing/Empty list.
    const missingSection =
      prompt.split("## Missing / Empty Config Files")[1]?.split("## ")[0] ?? "";
    expect(missingSection).toContain("actors");
    expect(missingSection).not.toContain("structure");
  });

  it("includes the approval gate reminder", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    expect(prompt).toMatch(/Self-check/i);
    expect(prompt).toMatch(/\/feature approve/);
  });

  it("includes the template population reminder (placeholders + AI comments)", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    expect(prompt).toMatch(/\{\{placeholder\}\}/);
    expect(prompt).toMatch(/<!-- AI/);
  });

  it("inlines context files and handles missing ones gracefully", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    expect(prompt).toContain("Readme");
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toMatch(/not found/i);
  });

  it("specifies a concrete summary length (3-5 bullets)", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    expect(prompt).toMatch(/3-5 bullet/i);
  });

  it("instructs the agent to infer from the codebase and NOT ask the user", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    // The agent should pre-fill using codebase scan, not a fixed Q&A.
    expect(prompt).toMatch(/do as much as you can without asking/i);
    expect(prompt).toMatch(/do NOT ask/i);
    expect(prompt).toMatch(/codebase scan/i);
  });

  it("lists specific things the agent should infer (type, stack, QA, git, principles)", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    expect(prompt).toMatch(/type of application/i);
    expect(prompt).toMatch(/languages\s*\/\s*frameworks/i);
    expect(prompt).toMatch(/qa tooling/i);
    expect(prompt).toMatch(/git strategy/i);
    expect(prompt).toMatch(/engineering principles/i);
  });

  it("lists concrete signals to scan (manifests, QA configs, git log, source style)", () => {
    const prompt = buildAnalyseCodebasePrompt({
      templates: TEMPLATES,
      contextFiles: CONTEXT,
      missingConfigFiles: ["actors"],
    });
    expect(prompt).toMatch(/package\.json/);
    expect(prompt).toMatch(/eslint/);
    expect(prompt).toMatch(/git log/);
    expect(prompt).toMatch(/git branch/);
  });
});
