/**
 * Analyse Codebase skill prompt builder.
 *
 * Pure function that assembles the prompt sent to the LLM at the start of an
 * Analyse Codebase skill session. The session is interactive — the user
 * reviews the populated files on disk and confirms via the standard
 * `/feature approve` gate.
 *
 * The LLM is responsible for:
 *   1. Scanning the codebase (file tree, package manifests, source files)
 *   2. Reading the supplied context documents (README, CLAUDE.md, AGENTS.md, PRD)
 *   3. Pre-filling each missing config file from its template
 *   4. Asking the user ONLY for gaps it genuinely cannot infer
 *   5. Writing the six config files to .feature-engineer/
 *   6. Presenting a summary for the user to review
 *
 * The user then types `/feature approve` to advance or
 * `/feature reject <feedback>` to regenerate.
 */

import type { ConfigFileName } from "../paths.js";
import {
  codeBlock,
  interactiveApprovalReminder,
  templatePopulationReminder,
} from "./common.js";

export interface AnalyseCodebasePromptInputs {
  /** Template content for each config file (keyed by config name). */
  templates: Record<ConfigFileName, string | null>;
  /** Project-wide context files the LLM may consult while populating templates. */
  contextFiles: {
    readme: string | null;
    claude: string | null;
    agents: string | null;
    prd: string | null;
  };
  /** Names of config files that are missing or empty. */
  missingConfigFiles: ConfigFileName[];
}

const ALL_CONFIG_FILES: readonly ConfigFileName[] = [
  "actors",
  "structure",
  "tech-stack",
  "qa-static-tools",
  "qa-engineering",
  "git-strategy",
];

export function buildAnalyseCodebasePrompt(inputs: AnalyseCodebasePromptInputs): string {
  const { templates, contextFiles, missingConfigFiles } = inputs;
  const isFullReinit = missingConfigFiles.length === ALL_CONFIG_FILES.length;

  const lines: string[] = [
    "# Feature Engineer — Analyse Codebase",
    "",
    isFullReinit
      ? "This project has not been initialised for Feature Engineer. You will populate the six project-wide config files from the supplied templates, grounded in the project's context documents and codebase."
      : "This project is partially initialised. You will fill in the missing config files below. Existing files in the same directory are already populated and must not be touched.",
    "",
    "## Approach",
    "",
    "Do as much as you can WITHOUT asking the user. Inspect the codebase, read the context documents, and pre-fill each missing config file with your best inference. Only ask the user about GAPS — decisions you cannot reasonably infer from the code, the templates, or the context documents.",
    "",
    "Concretely:",
    "",
    "- **Type of application** — infer from package manifests, source files, directory structure. Do NOT ask.",
    "- **Languages / frameworks** — read package.json, requirements.txt, go.mod, Cargo.toml, etc. Do NOT ask.",
    "- **QA tooling** — look for existing config files (eslint, prettier, mypy, etc.). Do NOT ask.",
    "- **Git strategy** — infer from any existing branches / commit history. Do NOT ask.",
    "- **Engineering principles** — infer from existing code style. Do NOT ask.",
    "",
    "Ask the user ONLY when the answer cannot be inferred. For example: if the project has no source files, no manifests, and no context documents, you may ask what kind of project this is and what stack it uses.",
    "",
    "When you do need to ask, use `ui.input` (text), `ui.select` (multiple choice), or `ui.confirm` (yes/no). Keep the number of questions small — one or two per file at most.",
    "",
    "## Missing / Empty Config Files",
    "",
    ...missingConfigFiles.map((f) => `- \`${f}\``),
    "",
    "## Context Documents",
    "Read these to ground your work. If a context file is missing, skip it gracefully — do not invent content based on its absence.",
    ...contextBlock("README.md", contextFiles.readme),
    ...contextBlock("CLAUDE.md", contextFiles.claude),
    ...contextBlock("AGENTS.md", contextFiles.agents),
    ...contextBlock("PRD.md", contextFiles.prd),
    "## Codebase Scan",
    "",
    "Before asking the user anything, scan the codebase:",
    "",
    "- List the top-level directory structure (`ls -la` or equivalent).",
    "- Read any package manifests: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, etc.",
    "- Read any QA config files: `.eslintrc*`, `.prettierrc*`, `tsconfig.json`, `mypy.ini`, `pyproject.toml [tool.*]`, `.golangci.yml`, etc.",
    "- Check `git log --oneline -20` and `git branch -a` for commit style and branch conventions.",
    "- Read a few representative source files to gauge style and engineering principles.",
    "",
    "Use these signals to pre-fill the templates below. Only ask the user about gaps you cannot resolve from this scan.",
    "",
    "## Templates To Populate",
    "For each missing config file below, populate the template using the codebase scan and the context documents. Write each file to its target path. Replace every `{{PLACEHOLDER}}` and remove every `<!-- AI: ... -->` comment per the template population rules below.",
    ...configTemplateBlocks(templates, missingConfigFiles),
    "",
    "## Output Paths",
    "Write each populated file to its target path inside `.feature-engineer/`. Do not overwrite files that already exist on disk and are NOT in the missing list above:",
    "",
    ...ALL_CONFIG_FILES.map(
      (name) => `- \`${name}.md\` → \`.feature-engineer/${name}.md\``,
    ),
    "",
    "## Process",
    "",
    "1. Run the codebase scan described above.",
    "2. For each missing config file, pre-fill the template with your best inference.",
    "3. Ask the user about any genuine gaps — keep the number of questions minimal.",
    "4. Write each file using your `write` tool. Verify the write succeeded with `ls` before moving to the next file.",
    "5. After all files are written, run the self-check below and fix any failures.",
    "6. Present a 3-5 bullet summary: one bullet per file with the key decision you made for it. The user will review the files on disk and type `/feature approve` to continue.",
    ...templatePopulationReminder(),
    "",
    ...interactiveApprovalReminder("Project configuration approved"),
  ];

  return lines.join("\n");
}

function contextBlock(label: string, content: string | null): string[] {
  if (content === null || content.trim().length === 0) {
    return ["", `- **${label}**: _(not found)_`];
  }
  return codeBlock(label, content);
}

function configTemplateBlocks(
  templates: Record<ConfigFileName, string | null>,
  missing: ConfigFileName[],
): string[] {
  const lines: string[] = [];
  for (const name of missing) {
    const content = templates[name];
    if (content === null || content.trim().length === 0) {
      lines.push("", `- **Template: ${name}.md**: _(not found — use the section guidance below)_`);
      continue;
    }
    lines.push(...codeBlock(`Template: ${name}.md → .feature-engineer/${name}.md`, content));
  }
  return lines;
}
