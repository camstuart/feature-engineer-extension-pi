import { describe, expect, it } from "vitest";
import {
  buildTechDesignPhase1Prompt,
  buildTechDesignPhase2Prompt,
  type TechDesignPromptInputs,
} from "@/prompts/tech-design";

const TEMPLATE = "# Technical Architecture\n<!-- AI: ... -->";
const REQUIREMENT = "# Requirement: X\n\nSome text.";
const STRUCTURE = "# Project Structure\n\nsrc/...";
const TECH_STACK = "# Tech Stack\n\nTypeScript...";
const QA_ENG = "# QA Engineering\n\nBe careful...";

const BASE_STATE = {
  featureId: 1,
  featureSlug: "x",
  featureDir: "/x",
  step: "tech-design" as const,
};

const BASE_INPUTS: TechDesignPromptInputs = {
  template: TEMPLATE,
  requirement: REQUIREMENT,
  structure: STRUCTURE,
  techStack: TECH_STACK,
  qaEngineering: QA_ENG,
  existingArchitecture: null,
  state: BASE_STATE,
  rejectionFeedback: null,
  outputPath: "/x/technical-architecture.md",
  relevantComponentsPath: "/x/relevant-components.md",
};

describe("prompts/tech-design phase 1 (codebase scan)", () => {
  it("inlines the requirement and config files", () => {
    const prompt = buildTechDesignPhase1Prompt(BASE_INPUTS);
    expect(prompt).toContain(REQUIREMENT);
    expect(prompt).toContain(STRUCTURE);
    expect(prompt).toContain(TECH_STACK);
    expect(prompt).toContain(QA_ENG);
  });

  it("identifies phase 1 and references the inventory file", () => {
    const prompt = buildTechDesignPhase1Prompt(BASE_INPUTS);
    expect(prompt).toContain("Phase 1");
    expect(prompt).toContain("/x/relevant-components.md");
  });

  it("specifies the inventory format (path::Name — role)", () => {
    const prompt = buildTechDesignPhase1Prompt(BASE_INPUTS);
    // Format uses a placeholder for ComponentName, so we look for the
    // surrounding template structure.
    expect(prompt).toMatch(/::/);
    expect(prompt).toMatch(/ComponentName/);
    expect(prompt).toMatch(/role/);
  });

  it("says to end the turn after writing the inventory (runner compacts)", () => {
    const prompt = buildTechDesignPhase1Prompt(BASE_INPUTS);
    expect(prompt).toMatch(/end your turn/i);
    expect(prompt).toMatch(/compact/i);
  });

  it("does NOT include the approval gate (phase 1 is intermediate)", () => {
    const prompt = buildTechDesignPhase1Prompt(BASE_INPUTS);
    expect(prompt).not.toMatch(/Architecture approved/i);
  });

  it("does not include review concerns when absent", () => {
    const prompt = buildTechDesignPhase1Prompt(BASE_INPUTS);
    expect(prompt).not.toContain("## Review Concerns To Address");
  });

  it("includes review concerns when present", () => {
    const prompt = buildTechDesignPhase1Prompt({
      ...BASE_INPUTS,
      reviewConcerns: "The caching layer bypasses the auth check.",
    });
    expect(prompt).toContain("## Review Concerns To Address");
    expect(prompt).toContain("The caching layer bypasses the auth check.");
  });
});

describe("prompts/tech-design phase 2 (architecture draft)", () => {
  it("inlines the template", () => {
    const prompt = buildTechDesignPhase2Prompt(BASE_INPUTS);
    expect(prompt).toContain(TEMPLATE);
    // Phase 2 does NOT inline config files — those are in Phase 1. The
    // runner compacts Phase 1's context before sending Phase 2.
    expect(prompt).toContain("Compacted Codebase Inventory");
  });

  it("identifies phase 2 and references both output paths", () => {
    const prompt = buildTechDesignPhase2Prompt(BASE_INPUTS);
    expect(prompt).toContain("Phase 2");
    expect(prompt).toContain("/x/technical-architecture.md");
    expect(prompt).toContain("/x/relevant-components.md");
  });

  it("includes a worked example for the Reused Components section", () => {
    const prompt = buildTechDesignPhase2Prompt(BASE_INPUTS);
    expect(prompt).toContain("## Example — Reused Components");
    expect(prompt).toMatch(/::/);
  });

  it("uses the interactive approval reminder", () => {
    const prompt = buildTechDesignPhase2Prompt(BASE_INPUTS);
    expect(prompt).toMatch(/Self-check/i);
    expect(prompt).toMatch(/\/feature approve/);
  });

  it("inlines existing architecture for EXISTING features", () => {
    const existing = "# Old Architecture\n\nstuff";
    const prompt = buildTechDesignPhase2Prompt({ ...BASE_INPUTS, existingArchitecture: existing });
    expect(prompt).toContain(existing);
    expect(prompt).toMatch(/modification/i);
  });

  it("includes rejection feedback when present", () => {
    const prompt = buildTechDesignPhase2Prompt({ ...BASE_INPUTS, rejectionFeedback: "missing error handling" });
    expect(prompt).toContain("Revision Feedback");
    expect(prompt).toContain("missing error handling");
  });

  it("does not include review concerns when absent", () => {
    const prompt = buildTechDesignPhase2Prompt(BASE_INPUTS);
    expect(prompt).not.toContain("## Review Concerns To Address");
  });

  it("includes review concerns when present", () => {
    const prompt = buildTechDesignPhase2Prompt({
      ...BASE_INPUTS,
      reviewConcerns: "The caching layer bypasses the auth check.",
    });
    expect(prompt).toContain("## Review Concerns To Address");
    expect(prompt).toContain("The caching layer bypasses the auth check.");
  });

  describe("{{VERSION}} placeholder handling (PRD §7.3)", () => {
    it("tells the LLM the current requirement version (default 1)", () => {
      const prompt = buildTechDesignPhase2Prompt(BASE_INPUTS);
      expect(prompt).toMatch(/requirement.*version.*\*\*1\*\*/i);
      expect(prompt).toMatch(/fill.*1/i);
    });

    it("tells the LLM the current requirement version (state-supplied)", () => {
      const prompt = buildTechDesignPhase2Prompt({
        ...BASE_INPUTS,
        state: { ...BASE_STATE, requirementVersion: 3 },
      });
      expect(prompt).toMatch(/requirement.*version.*\*\*3\*\*/i);
      expect(prompt).toMatch(/fill.*3/i);
      // Must NOT include a stale "1" alongside the real "3" — the LLM
      // would otherwise pick the wrong number.
      expect(prompt).not.toMatch(/fill.*1/);
    });

    it("tells the LLM to fill {{VERSION}} with the integer only (no 'v' prefix)", () => {
      const prompt = buildTechDesignPhase2Prompt({
        ...BASE_INPUTS,
        state: { ...BASE_STATE, requirementVersion: 2 },
      });
      // The template already writes "requirement.md v" before the
      // placeholder, so the LLM must only supply the integer.
      expect(prompt).toMatch(/integer.*2/);
    });
  });
});