/**
 * Technical Design skill prompt builders.
 *
 * The skill is two phases, driven by the runner:
 *   Phase 1: scan the codebase, write `02-relevant-components.md` inventory.
 *   [Orchestrator compacts context, preserving only the inventory summary.]
 *   Phase 2: draft `03-technical-architecture.md` from the requirement + the
 *            (now-compacted) inventory.
 *
 * Splitting the prompt into two phases (rather than asking the LLM to do
 * both in one turn) lets the orchestrator own the compaction step
 * deterministically — the LLM is not trusted to call `ctx.compact`.
 */

import type { FeatureState } from "../state.js";
import {
  codeBlock,
  exampleBlock,
  existingArtifactBlock,
  interactiveApprovalReminder,
  revisionFeedbackBlock,
  reviewConcernsBlock,
  skillHeader,
  templatePopulationReminder,
} from "./common.js";

export interface TechDesignPromptInputs {
  template: string;
  requirement: string;
  structure: string;
  techStack: string;
  qaEngineering: string;
  existingArchitecture: string | null;
  state: FeatureState;
  rejectionFeedback: string | null;
  outputPath: string;
  relevantComponentsPath: string;
  /**
   * Outstanding review concerns routed here by an ARCHITECTURAL
   * severity-gate decision. Rendered as a `## Review Concerns To Address`
   * block alongside the existing-architecture baseline.
   */
  reviewConcerns?: string | null;
}

export function buildTechDesignPhase1Prompt(inputs: TechDesignPromptInputs): string {
  const {
    template,
    requirement,
    structure,
    techStack,
    qaEngineering,
    existingArchitecture,
    state,
    rejectionFeedback,
    outputPath,
    relevantComponentsPath,
    reviewConcerns,
  } = inputs;
  const isExisting = existingArchitecture !== null;

  const lines: string[] = [
    skillHeader(state, "Technical Design — Phase 1 (Codebase Scan)"),
    "",
    isExisting
      ? `This is a **modification** of an existing feature. The prior \`03-technical-architecture.md\` is provided as a baseline. Update or replace sections as needed.`
      : `This is a **new feature**. Generate a fresh technical architecture from the requirement.`,
    "",
    "## Output Paths (set up by this skill, used across phases)",
    `- Phase 1 writes: \`${relevantComponentsPath}\``,
    `- Phase 2 writes: \`${outputPath}\``,
    "",
    "## Input Files",
    ...codeBlock("01-requirement.md", requirement),
    ...codeBlock("02-structure.md", structure),
    ...codeBlock("03-tech-stack.md", techStack),
    ...codeBlock("05-qa-engineering.md", qaEngineering),
    ...existingArtifactBlock("Existing 03-technical-architecture.md (baseline)", existingArchitecture),
    ...revisionFeedbackBlock(rejectionFeedback),
    ...reviewConcernsBlock(reviewConcerns),
    "",
    "## Output Template (for the FINAL architecture file, written in Phase 2)",
    "Read this now to understand what components Phase 2 will need to reference.",
    ...codeBlock("Template: 03-technical-architecture.md", template),
    "",
    "---",
    "",
    "**PHASE 1 — Codebase Scan and Inventory**",
    "",
    "Scan the project for components, modules, or utilities that this feature will reuse. Write a concise inventory to `02-relevant-components.md` at the path above.",
    "",
    "**Inventory format** (one entry per line):",
    "",
    "```",
    "<absolute-or-repo-relative-path>::<ComponentName> — <one-line role>",
    "```",
    "",
    "Group related entries under a `## <area>` heading. Do not write prose between entries. Keep the file under ~80 lines.",
    "",
    "**What to include:**",
    "",
    "- Existing functions or types that this feature will call",
    "- Existing UI components that this feature will compose or extend",
    "- Existing data-access helpers (repositories, ORM models, key-value stores)",
    "- Existing error/loading patterns this feature should follow",
    "",
    "**What to exclude:**",
    "",
    "- Anything you cannot ground in a concrete file path",
    "- Speculative future additions",
    "- Standard library or framework primitives (the LLM already knows them)",
    "",
    "When the inventory file is written, end your turn. The orchestrator will compact context and start Phase 2.",
  ];

  return lines.join("\n");
}

export function buildTechDesignPhase2Prompt(inputs: TechDesignPromptInputs): string {
  const {
    template,
    existingArchitecture,
    state,
    rejectionFeedback,
    outputPath,
    relevantComponentsPath,
    reviewConcerns,
  } = inputs;
  const isExisting = existingArchitecture !== null;
  // The architecture template carries a `requirement.md v{{VERSION}}`
  // marker so reviewers can trace the architecture back to the exact
  // requirement draft it was authored against (PRD §7.3). The version
  // is bumped by the orchestrator every time the user rejects at
  // req-gathering — see `FeatureState.requirementVersion`.
  const requirementVersion: number = state.requirementVersion ?? 1;

  const lines: string[] = [
    skillHeader(state, "Technical Design — Phase 2 (Architecture Draft)"),
    "",
    isExisting
      ? `This is a **modification** of an existing feature. Update or replace sections of the prior \`03-technical-architecture.md\` as needed.`
      : `Generate a fresh technical architecture from the requirement and the codebase inventory.`,
    "",
    "## Output Path",
    `Write the final architecture to: \`${outputPath}\``,
    "",
    `## Requirement Version`,
    `The architecture is being authored against \`01-requirement.md\` version **${requirementVersion}**. Fill the \`{{VERSION}}\` placeholder in the template with the integer \`${requirementVersion}\` (do not include the word "version" or a "v" prefix — the template already says "requirement.md v" before the placeholder).`,
    "",
    "## Input: Compacted Codebase Inventory",
    "The previous phase scanned the codebase and wrote an inventory. The orchestrator has compacted the context to preserve only this summary — re-read the full inventory at the path below before drafting.",
    "",
    `Inventory file: \`${relevantComponentsPath}\` — read it with your file-reading tool before continuing.`,
    "",
    "## Output Template",
    "Use this template for the final `03-technical-architecture.md`. Every section header must appear in the output.",
    ...codeBlock("Template: 03-technical-architecture.md", template),
    "",
    "## Worked Example (one section, fully populated)",
    "Use this as a guide for how concrete and specific each section should be:",
    ...exampleBlock(
      "Reused Components",
      [
        "src/auth/token-service.ts::TokenService — verifies JWT signatures, returns user claims",
        "src/api/error-middleware.ts::errorMiddleware — formats HTTP errors per 05-qa-engineering.md",
        "src/components/Modal.tsx::Modal — base modal component with focus-trap and a11y attributes",
      ].join("\n"),
      "Each entry is a concrete file path with a one-line role. The next phase (Implementation) will grep for these exact strings.",
    ),
    ...existingArtifactBlock("Existing 03-technical-architecture.md (baseline)", existingArchitecture),
    ...revisionFeedbackBlock(rejectionFeedback),
    ...reviewConcernsBlock(reviewConcerns),
    ...templatePopulationReminder(),
    "",
    "**PHASE 2 — Draft Architecture**",
    "",
    "1. Read the compacted inventory at the path above.",
    "2. For each section of the template, write content specific to this feature. Do not leave any section blank or filled with placeholder filler.",
    "3. Reference each reused component using its `path::Name` form so the Implementation phase can locate it with a single grep.",
    "4. If review concerns are listed above, ensure your revised architecture resolves each one.",
    "5. Run the self-check (in the approval-gate reminder below) before declaring done.",
    "",
    ...interactiveApprovalReminder("Architecture approved"),
  ];

  return lines.join("\n");
}