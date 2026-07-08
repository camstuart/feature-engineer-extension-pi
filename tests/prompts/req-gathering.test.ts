import { describe, expect, it } from "vitest";
import { buildReqGatheringPrompt } from "@/prompts/req-gathering";

const TEMPLATE = `# Feature: {{FEATURE_NAME}}

**Feature ID:** {{FEATURE_ID}}
**Date:** {{DATE}}
**Status:** Draft

## Overview
<!-- AI: ... -->

## User Stories
<!-- AI: ... -->
`;

const ACTORS = `# System Actors

## User
A logged-in end user.

## Admin
A privileged operator.
`;

const BASE_STATE = {
  featureId: 3,
  featureSlug: "checkout-flow",
  featureDir: "/abs/.feature-engineer/feature-003-checkout-flow",
  step: "req-gathering" as const,
};

const BASE_INPUTS = {
  template: TEMPLATE,
  actors: ACTORS,
  existingRequirement: null,
  state: BASE_STATE,
  rejectionFeedback: null,
  outputPath: "/abs/.feature-engineer/feature-003-checkout-flow/requirement.md",
};

describe("prompts/req-gathering", () => {
  describe("default mode (backward compat)", () => {
    it("defaults to vague mode when no mode is specified", () => {
      // No mode specified → prompt must contain the vague-mode discovery
      // process and NOT contain the direct-mode header.
      const prompt = buildReqGatheringPrompt(BASE_INPUTS);
      expect(prompt).toMatch(/discovery.*Q&A loop/i);
      expect(prompt).not.toContain("Direct Mode");
    });
  });

  describe("mode contract (orchestrator is the source of truth)", () => {
    it("explicit 'vague' produces the discovery flow", () => {
      const prompt = buildReqGatheringPrompt({ ...BASE_INPUTS, mode: "vague" });
      expect(prompt).toMatch(/discovery.*Q&A loop/i);
      expect(prompt).not.toContain("Direct Mode");
    });

    it("explicit 'direct' produces the direct flow", () => {
      const prompt = buildReqGatheringPrompt({ ...BASE_INPUTS, mode: "direct" });
      expect(prompt).toContain("Direct Mode");
    });

    it("omitting mode still defaults to vague (defensive — orchestrator must always set it)", () => {
      // The orchestrator is the source of truth for `requirementMode`.
      // The skill prompt builder keeps a `?? "vague"` defensive default
      // so direct callers don't crash, but the orchestrator is expected
      // to never call without a mode. This test pins that contract.
      const prompt = buildReqGatheringPrompt(BASE_INPUTS);
      expect(prompt).toMatch(/discovery.*Q&A loop/i);
    });
  });

  describe("vague mode (brainstorming)", () => {
    const inputs = { ...BASE_INPUTS, mode: "vague" as const };

    it("renders a new-feature prompt", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain("# Requirement Gathering — Feature 003: checkout-flow");
      expect(prompt).not.toContain("Direct Mode");
      expect(prompt).toContain("new feature");
      expect(prompt).toContain(TEMPLATE);
      expect(prompt).toContain(ACTORS);
      expect(prompt).toContain("requirement.md");
      expect(prompt).toContain(inputs.outputPath);
    });

    it("renders a modification prompt when existing requirement is provided", () => {
      const existing = "## Overview\nLegacy content.\n";
      const prompt = buildReqGatheringPrompt({ ...inputs, existingRequirement: existing });
      expect(prompt).toContain("modification");
      expect(prompt).toContain("Existing Requirements");
      expect(prompt).toContain(existing);
    });

    it("includes the rejection feedback when present", () => {
      const prompt = buildReqGatheringPrompt({
        ...inputs,
        state: { ...BASE_STATE, rejectionFeedback: "Add acceptance criteria for offline mode" },
        rejectionFeedback: "Add acceptance criteria for offline mode",
      });
      expect(prompt).toContain("Revision Feedback");
      expect(prompt).toContain("Add acceptance criteria for offline mode");
    });

    it("tells the agent the output path", () => {
      const prompt = buildReqGatheringPrompt({
        ...inputs,
        outputPath: "/custom/output/path.md",
      });
      expect(prompt).toContain("/custom/output/path.md");
    });

    it("includes a worked example for one section", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain("## Example — Goals");
    });

    it("includes the template population reminder", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/Template Population Reminder/i);
    });

    it("uses the new approval gate reminder (no ui.confirm gate)", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/orchestrator validates/i);
      expect(prompt).toContain("/feature approve");
      // The approval gate no longer instructs the LLM to call ui.confirm —
      // the orchestrator handles the gate via /feature approve.
      expect(prompt).not.toContain('ui.confirm("Requirements approved?"');
    });

    it("describes the discovery Q&A loop", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/discovery/i);
      expect(prompt).toMatch(/brainstorm/i);
    });

    it("encourages multi-turn Q&A via ui.input / ui.select / ui.confirm", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/ui\.input/);
      expect(prompt).toMatch(/ui\.select/);
      expect(prompt).toMatch(/ui\.confirm/);
    });

    it("includes traceability guidance for requirements", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/traceability|map.*user story|user story.*ac/i);
    });

    it("includes a Summary and Confirm step", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/Summary.*Confirm/i);
    });

    it("handles UI cancellation explicitly", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/cancelled|undefined/i);
      expect(prompt).toMatch(/do NOT invent|never guess/i);
    });

    it("allows in-session document editing", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/in-session edit|in this session, edit|edit the file in place/i);
    });

    it("STEP 3 batches success-criteria confirmation into one confirm per round", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain(
        "use ONE `ui.confirm` to verify the whole summary before moving on — do not confirm each criterion individually.",
      );
      expect(prompt).not.toContain("verify each criterion");
    });

    it("STEP 4 batches user-story confirmation into one confirm per round (no per-story confirm)", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain(
        "use ONE `ui.confirm` to verify the full set captures the intent — do not confirm each story individually.",
      );
      expect(prompt).not.toContain("ui.confirm` per story");
      expect(prompt).not.toContain("per story to verify");
    });

    it("STEP 5 batches goal confirmation into one confirm per round", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain(
        "use ONE `ui.confirm` to verify the full set — do not confirm each goal individually.",
      );
      expect(prompt).not.toContain("verify each goal");
    });

    it("STEP 8's final summary confirmation is unchanged", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain(
        'ui.confirm("Is this what you meant?", "Confirm to write the document, or reject to clarify.")',
      );
    });
  });

  describe("direct mode (clear requirement)", () => {
    const inputs = { ...BASE_INPUTS, mode: "direct" as const };

    it("labels the prompt with the mode", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain("Direct Mode");
    });

    it("renders a new-feature prompt", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain("# Requirement Gathering (Direct Mode) — Feature 003: checkout-flow");
      expect(prompt).toContain(TEMPLATE);
      expect(prompt).toContain(ACTORS);
      expect(prompt).toContain(inputs.outputPath);
    });

    it("renders a modification prompt when existing requirement is provided", () => {
      const existing = "## Overview\nLegacy content.\n";
      const prompt = buildReqGatheringPrompt({ ...inputs, existingRequirement: existing });
      expect(prompt).toContain("modification");
      expect(prompt).toContain(existing);
    });

    it("tells the agent NOT to do discovery Q&A", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/do NOT do discovery/i);
    });

    it("limits questions to 1-2 critical ones", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/at most 1-2|at most.*questions/i);
    });

    it("instructs the agent to capture the user's full requirement via ui.input", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/ui\.input/);
    });

    it("includes the rejection feedback when present", () => {
      const prompt = buildReqGatheringPrompt({
        ...inputs,
        state: { ...BASE_STATE, rejectionFeedback: "make goals more specific" },
        rejectionFeedback: "make goals more specific",
      });
      expect(prompt).toContain("Revision Feedback");
      expect(prompt).toContain("make goals more specific");
    });

    it("includes a worked example for one section", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toContain("## Example — Goals");
    });

    it("includes the template population reminder", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/Template Population Reminder/i);
    });

    it("uses the new approval gate reminder (no ui.confirm gate)", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/orchestrator validates/i);
      expect(prompt).toContain("/feature approve");
      expect(prompt).not.toContain('ui.confirm("Requirements approved?"');
    });

    it("handles UI cancellation explicitly", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/cancelled|undefined/i);
    });

    it("allows in-session document editing", () => {
      const prompt = buildReqGatheringPrompt(inputs);
      expect(prompt).toMatch(/in-session edit|in this session, edit|edit the file in place/i);
    });

    it("is shorter than vague mode (no full discovery flow)", () => {
      const direct = buildReqGatheringPrompt(inputs);
      const vague = buildReqGatheringPrompt({ ...BASE_INPUTS, mode: "vague" as const });
      expect(direct.length).toBeLessThan(vague.length);
    });
  });
});