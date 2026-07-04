/**
 * Requirement Gathering skill prompt builder.
 *
 * Two modes selected by the user before the skill starts:
 *
 * - **direct** — the user has a clear, detailed requirement. The LLM captures
 *   it faithfully and asks at most 1-2 critical questions only when truly
 *   necessary. No discovery Q&A.
 *
 * - **vague** — the user has a rough idea. The LLM runs a structured
 *   discovery Q&A loop before drafting, then writes the document. The
 *   default when no mode is specified (backward compatibility).
 *
 * Both modes share the same template, actors, output path, and approval
 * gate. They differ in the process section: direct is short, vague is the
 * full discovery flow.
 *
 * Pure function: takes the assembled inputs and returns the full prompt
 * string sent to the LLM when the skill session starts.
 */

import { type FeatureState, type RequirementMode } from "../state.js";
import {
  codeBlock,
  exampleBlock,
  existingArtifactBlock,
  interactiveApprovalReminder,
  revisionFeedbackBlock,
  skillHeader,
  templatePopulationReminder,
} from "./common.js";

export interface ReqGatheringPromptInputs {
  template: string;
  actors: string;
  existingRequirement: string | null;
  state: FeatureState;
  rejectionFeedback: string | null;
  outputPath: string;
  /**
   * How the user wants to run requirement gathering. When omitted, defaults
   * to `"vague"` (the original behaviour) for backward compatibility.
   */
  mode?: RequirementMode;
}

export function buildReqGatheringPrompt(inputs: ReqGatheringPromptInputs): string {
  const mode: RequirementMode = inputs.mode ?? "vague";
  return mode === "direct" ? buildDirectPrompt(inputs) : buildVaguePrompt(inputs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fragments
// ─────────────────────────────────────────────────────────────────────────────

function buildHeader(state: FeatureState, mode: RequirementMode): string[] {
  const label = mode === "direct" ? "Requirement Gathering (Direct Mode)" : "Requirement Gathering";
  return [skillHeader(state, label), ""];
}

function buildIntro(mode: RequirementMode, existingRequirement: string | null): string[] {
  const isExisting = existingRequirement !== null;
  const lines: string[] = [];
  if (mode === "direct") {
    lines.push(
      isExisting
        ? `This is a **modification** of an existing feature. The user has a clear, detailed update ready — your job is to capture it faithfully against the prior \`01-requirement.md\`. Do NOT do discovery Q&A.`
        : `This is a **new feature**. The user has a clear, detailed requirement ready to write down — your job is to capture it faithfully, asking at most 1-2 critical questions only when you cannot infer the answer. Do NOT do discovery Q&A.`,
    );
  } else {
    lines.push(
      isExisting
        ? `This is a **modification** of an existing feature. The prior \`01-requirement.md\` is provided as a baseline. Walk the user through the proposed changes (per-section diff) before re-drafting.`
        : `This is a **new feature**. Run a structured discovery and brainstorming Q&A loop with the user before drafting — explore the problem space, identify the primary users, derive goals, and translate them into testable requirements.`,
    );
  }
  return [...lines, ""];
}

function buildInputFiles(
  template: string,
  actors: string,
  existingRequirement: string | null,
  rejectionFeedback: string | null,
  outputPath: string,
): string[] {
  return [
    "## Output Path",
    `Write the final document to: \`${outputPath}\``,
    "",
    "## Output Template",
    "Use the following template structure to generate the 01-requirement.md file. Preserve every section header — populate them with content specific to this feature.",
    ...codeBlock("Template", template),
    "",
    "## Actors Reference",
    "Use this list of system actors when generating user stories.",
    ...codeBlock("Actors", actors),
    ...existingArtifactBlock("Existing Requirements (baseline)", existingRequirement),
    ...revisionFeedbackBlock(rejectionFeedback),
  ];
}

function buildWorkedExample(): string[] {
  return [
    "",
    "## Worked Example (one section, fully populated)",
    "Use this as a guide for the level of specificity expected in each section:",
    ...exampleBlock(
      "Goals",
      [
        "- Users can reset their password in under 60 seconds without contacting support",
        "- Reset links are valid for 15 minutes and become invalid after first use",
        "- The flow works on both desktop and mobile browsers",
        "- Failed reset attempts are rate-limited to 5 per hour per email address",
      ].join("\n"),
      "Four concrete, testable bullets. Each maps to one or more functional requirements below.",
    ),
  ];
}

function buildInSessionEditingNote(): string[] {
  return [
    "",
    "## In-Session Editing",
    "",
    "If the user asks for a change in this session, edit the file in place using your `edit` tool. Do not re-draft the document from scratch for small changes. After each in-session edit, run the self-check and present the diff briefly.",
    "",
    "If the change is structural (e.g., \"split goals into primary and secondary\"), re-draft the affected sections only and confirm with `ui.confirm` before saving.",
  ];
}

function buildCancellationNote(): string[] {
  return [
    "",
    "## UI Cancellation",
    "",
    "If a `ui.input` or `ui.select` call returns `undefined` (user cancelled or pressed Esc), do NOT invent a value. Re-ask the question once, or — if the user is unresponsive — write `<user did not answer>` in the relevant section and continue. Never guess at user intent.",
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct mode: capture a clear requirement with minimal Q&A
// ─────────────────────────────────────────────────────────────────────────────

function buildDirectPrompt(inputs: ReqGatheringPromptInputs): string {
  const { template, actors, existingRequirement, state, rejectionFeedback, outputPath } = inputs;

  const lines: string[] = [
    ...buildHeader(state, "direct"),
    ...buildIntro("direct", existingRequirement),
    ...buildInputFiles(template, actors, existingRequirement, rejectionFeedback, outputPath),
    ...buildWorkedExample(),
    ...templatePopulationReminder(),
    ...buildInSessionEditingNote(),
    ...buildCancellationNote(),
    "",
    "---",
    "",
    "**Process**",
    "",
    "1. **Capture the requirement.** If the user has already provided the requirement in this session (pasted spec, link, or detailed description), use that as the primary source. Otherwise, ask them to describe the requirement in their own words via `ui.input`.",
    "2. **Ask at most 1-2 critical questions.** Only ask about things you genuinely cannot infer from the description. Use `ui.confirm` for yes/no, `ui.select` for choice. Never ask more than 2 questions in total.",
    "3. **Translate to the template.** Walk through every section and populate it with content from the requirement. Do not leave sections blank. Do not invent user stories or requirements that are not grounded in the user's input.",
    "4. **Write the document.** Save to the output path with the `write` tool.",
    "5. **Self-check and present.** Run the self-check in the approval-gate reminder. Fix any failures. Then tell the user the output path, the populated section headings, and a 2-3 sentence summary of what you understood.",
    "6. **End your turn.** The user will type `/feature approve` to advance or `/feature reject <feedback>` to revise.",
    "",
    ...interactiveApprovalReminder("Requirements approved"),
  ];

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Vague mode: brainstorm with the user, then draft
// ─────────────────────────────────────────────────────────────────────────────

function buildVaguePrompt(inputs: ReqGatheringPromptInputs): string {
  const { template, actors, existingRequirement, state, rejectionFeedback, outputPath } = inputs;

  const lines: string[] = [
    ...buildHeader(state, "vague"),
    ...buildIntro("vague", existingRequirement),
    ...buildInputFiles(template, actors, existingRequirement, rejectionFeedback, outputPath),
    ...buildWorkedExample(),
    ...templatePopulationReminder(),
    ...buildInSessionEditingNote(),
    ...buildCancellationNote(),
    "",
    "---",
    "",
    "**Discovery Process (do this BEFORE writing)**",
    "",
    "Run a structured discovery Q&A loop with the user. Use `ui.input` for open-ended questions, `ui.select` for multi-choice, and `ui.confirm` for yes/no. Ask 2-3 questions per round, wait for the user's answers, then proceed. The goal is to validate your understanding of the feature before writing the document.",
    "",
    "**STEP 1 — Problem & Motivation**",
    "",
    "Start here. Ask the user:",
    "",
    "- What problem does this feature solve, and for whom?",
    "- What is the painful status quo (the current workaround)?",
    "- Why now? What triggered this feature request?",
    "",
    "Use `ui.input` to capture their answer verbatim. Synthesise what you heard back into a single sentence in your head before moving on. This becomes the `## Overview`.",
    "",
    "**STEP 2 — Primary Users & Key Journeys**",
    "",
    "For each relevant actor from `01-actors.md`, walk through the primary use case as a mini story:",
    "",
    "- What does this actor do, in what order?",
    "- What is the most common path through the feature?",
    "- What is the painful edge case they hit today?",
    "",
    "Use `ui.input` to capture each narrative. These become the basis for user stories in STEP 4.",
    "",
    "**STEP 3 — Success Criteria & Constraints**",
    "",
    "Ask the user:",
    "",
    "- What does success look like? How will you know it worked?",
    "- Are there hard constraints (deadline, budget, regulatory, performance targets)?",
    "- What is explicitly out of scope? (This becomes the `## Out of Scope` section.)",
    "",
    "Use `ui.confirm` to verify each criterion before moving on.",
    "",
    "**STEP 4 — User Story Drafting**",
    "",
    "For each actor and journey from STEP 2, draft 1-3 user stories using the As/I want/so that format. For each story, draft 2-4 acceptance criteria. Use `ui.confirm` per story to verify it captures the intent. Adjust the wording based on feedback before moving on.",
    "",
    "**STEP 5 — Goals & Requirements (with traceability)**",
    "",
    "Derive 3-6 goals from the user stories. Each goal should map to at least one user story. Use `ui.confirm` to verify each goal as you write it.",
    "",
    "Then translate each goal into 1+ functional requirements. **Each functional requirement MUST reference the user story and acceptance criterion it implements.** Format:",
    "",
    "```",
    "1. <Requirement statement>. (Story: \"As a <actor>, I want to <action>\"; AC: <criterion>)",
    "```",
    "",
    "This traceability is what lets the technical design and implementation phases verify completeness.",
    "",
    "**STEP 6 — Edge Cases & Failure Modes**",
    "",
    "Walk through failure modes with the user. For each, use `ui.select` to decide:",
    "",
    "- \"Handle in this feature\" — document the behaviour in functional requirements",
    "- \"Defer to technical design\" — add to `## Open Questions`",
    "- \"Out of scope\" — move to `## Out of Scope`",
    "",
    "**STEP 7 — Resolve Open Questions Interactively**",
    "",
    "Before writing, walk the user through any unresolved questions. For each, use `ui.select` with options:",
    "",
    "- \"Resolve now (you'll tell me the answer)\"",
    "- \"Defer to technical design\"",
    "- \"Out of scope — remove from feature\"",
    "",
    "Capture resolved answers in the relevant section. Deferred items go in `## Open Questions`. Removed items go in `## Out of Scope`.",
    "",
    "**STEP 8 — Summary and Confirmation**",
    "",
    "Present the user with a 2-3 sentence summary of what you understood the feature to be. List the goals and the primary user story per actor. Then call `ui.confirm(\"Is this what you meant?\", \"Confirm to write the document, or reject to clarify.\")`.",
    "",
    "If confirmed, proceed to STEP 9. If rejected, ask what to clarify and re-run the relevant discovery steps.",
    "",
    "**STEP 9 — Write & Self-Check**",
    "",
    "Write the document to the output path. Run the self-check in the approval-gate reminder. Fix any failures. Then tell the user:",
    "",
    "1. The output path you wrote to.",
    "2. A list of the section headings you populated.",
    "3. A 2-3 sentence summary of the document's content.",
    "",
    "End your turn. The user will type `/feature approve` to advance or `/feature reject <feedback>` to revise.",
    "",
    ...interactiveApprovalReminder("Requirements approved"),
  ];

  return lines.join("\n");
}