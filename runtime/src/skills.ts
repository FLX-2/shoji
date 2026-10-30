import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeHome, describedAs, parseFrontmatter } from "./frontmatter";
import type { Workspace } from "./workspace";

/** Where a project keeps its skills, as Claude Code does: a folder for each, holding SKILL.md. */
export const SKILLS_FOLDER = ".claude/skills";

const SKILL_FILE = "SKILL.md";
/** Most skills listed with a task, so a big collection can't crowd it out. */
const MOST_SKILLS = 40;
const MOST_CHARS = 40_000;

interface Skill {
  name: string;
  description: string;
  dir: string;
  /** Set for the project's own skills, whose files the person's private patterns cover. */
  inProject: boolean;
}

/** The skills a run can use, and the tool that reads them. */
export interface Skills {
  /** What to tell a role about them, empty when there are none. */
  note: string;
  tools: Anthropic.Tool[];
  owns(tool: string): boolean;
  read(name: string, file: string): string;
}

export const NO_SKILLS: Skills = { note: "", tools: [], owns: () => false, read: () => "Error: there are no skills." };

const READ_SKILL: Anthropic.Tool = {
  name: "read_skill",
  description:
    "Read one of the skills listed with the task: its SKILL.md, or another file in its folder that SKILL.md points to.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The skill's name, as listed" },
      file: { type: "string", description: "SKILL.md, or a path inside the skill's folder" },
    },
    required: ["name", "file"],
    additionalProperties: false,
  },
};

function skillsIn(dir: string, inProject: boolean, skip: (full: string) => boolean): Skill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Skill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(dir, entry.name);
    const file = path.join(folder, SKILL_FILE);
    if (!entry.isDirectory() || skip(file)) continue;
    try {
      const { fields, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const name = (fields.name || entry.name).replace(/\s+/g, "-");
      found.push({ name, description: describedAs(fields, body), dir: folder, inProject });
    } catch {
      // A folder without a SKILL.md isn't a skill.
    }
  }
  return found;
}

/** The project's skills and the person's own, the project's first where both have one of a name. */
export function findSkills(workspace: Workspace, home = claudeHome()): Skills {
  const hidden = (full: string) => workspace.isPrivate(workspace.relative(full));
  const all = [
    ...skillsIn(path.join(workspace.root, SKILLS_FOLDER), true, hidden),
    ...skillsIn(path.join(home, "skills"), false, () => false),
  ];
  const skills = all.filter((s, i) => all.findIndex((t) => t.name === s.name) === i).slice(0, MOST_SKILLS);
  if (!skills.length) return NO_SKILLS;

  const note = `\n\nSkills, which hold know-how for particular kinds of work. When the task calls for one, read it with read_skill and follow it:\n${skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n")}`;
  return {
    note,
    tools: [READ_SKILL],
    owns: (tool) => tool === READ_SKILL.name,
    read(name, file) {
      const skill = skills.find((s) => s.name === name);
      if (!skill) return `Error: there is no skill called ${name}.`;
      const full = path.resolve(skill.dir, file || SKILL_FILE);
      const rel = path.relative(skill.dir, full);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return "Error: that file is outside the skill's folder.";
      try {
        // The project's own skill files are read as any project file is: never private ones, nor through a link out.
        if (skill.inProject) workspace.resolve(workspace.relative(full));
        if (skill.inProject && hidden(full)) return `Error: ${file} is private: the person keeps it from models.`;
        if (fs.statSync(full).isDirectory()) {
          return fs.readdirSync(full).sort().join("\n") || "(no files)";
        }
        const text = fs.readFileSync(full, "utf8");
        return text.length > MOST_CHARS ? `${text.slice(0, MOST_CHARS)}\n…(cut at ${MOST_CHARS} characters)` : text;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return `Error: the ${name} skill has no ${file}.`;
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}
