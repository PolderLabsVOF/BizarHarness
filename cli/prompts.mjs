import inquirer from 'inquirer';

const AGENTS_LIST = [
  { name: 'Odin ᛟ  — MiniMax-M3 (Router)', value: 'odin.md', checked: true },
  { name: 'Frigg ᚠ  — DeepSeek (Codebase Q&A, read-only)', value: 'frigg.md', checked: true },
  { name: 'Vör ᚡ  — DeepSeek (Clarification)', value: 'vor.md', checked: true },
  { name: 'Mimir ᛗ — DeepSeek (Research)', value: 'mimir.md', checked: true },
  { name: 'Heimdall ᚹ — DeepSeek (Simple tasks)', value: 'heimdall.md', checked: true },
  { name: 'Hermod ᚱ — MiniMax-M2.7 (Git ops)', value: 'hermod.md', checked: true },
  { name: 'Thor ᚦ  — MiniMax-M2.7 (Mid impl.)', value: 'thor.md', checked: true },
  { name: 'Baldr ᛒ  — MiniMax-M2.7 (Design)', value: 'baldr.md', checked: true },
  { name: 'Tyr ᛏ  — MiniMax-M3 (Complex impl.)', value: 'tyr.md', checked: true },
  { name: 'Vidarr ᛉ — GPT-5.5 (Last resort)', value: 'vidarr.md', checked: false },
  { name: 'Forseti ᚨ — MiniMax-M3 (Plan audit)', value: 'forseti.md', checked: true },
];

export async function promptComponents() {
  const { components } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'components',
    message: 'What would you like to install?',
    choices: [
      { name: 'Agent definitions (all 11 agents)', value: 'agents', checked: true },
      { name: 'AGENTS.md routing table', value: 'agents-md', checked: true },
      new inquirer.Separator(),
      { name: 'BizarHarness skill', value: 'skill-bizar', checked: true },
      { name: 'Self-improvement skill', value: 'skill-improve', checked: true },
      new inquirer.Separator(),
      { name: 'Always-on rules (5 rule files)', value: 'rules', checked: true },
      { name: 'Hook system (behavioral hooks)', value: 'hooks', checked: true },
      { name: 'Slash commands (/explain, /audit, /learn, /pr-review, /init)', value: 'commands', checked: true },
      new inquirer.Separator(),
      { name: 'opencode.json (provider + MCP config)', value: 'opencode-json', checked: true },
      { name: '.bizar/ folder (self-improvement log)', value: 'bizar', checked: true },
    ],
    pageSize: 10,
    validate(answer) {
      if (answer.length === 0) return 'Select at least one component.';
      return true;
    },
  }]);
  return components;
}

export async function promptInstallMode() {
  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'Installation mode:',
    choices: [
      { name: 'Fresh install  — overwrite existing config files', value: 'fresh' },
      { name: 'Merge  — keep your existing config, add missing files only', value: 'merge' },
    ],
  }]);
  return mode;
}

export async function promptAgents() {
  const { agents } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'agents',
    message: 'Select agents to install:',
    choices: AGENTS_LIST,
    pageSize: 12,
    validate(answer) {
      if (answer.length === 0) return 'Select at least one agent.';
      return true;
    },
  }]);
  return agents;
}

export async function promptApiKeys() {
  const { setup } = await inquirer.prompt([{
    type: 'confirm',
    name: 'setup',
    message: 'Configure API keys now?',
    default: false,
  }]);
  if (!setup) return {};

  const keys = await inquirer.prompt([
    {
      type: 'input',
      name: 'opencodeZen',
      message: 'OpenCode Zen API key (DeepSeek V4 Flash Free):',
      validate: v => v.length > 0 || 'Required for free-tier agents (Mimir, Heimdall, Vör)',
    },
    {
      type: 'input',
      name: 'minimax',
      message: 'MiniMax API key (M2.7 + M3):',
      validate: v => v.length > 0 || 'Required for Odin, Thor, Hermod, Baldr, Tyr, Forseti',
    },
    {
      type: 'input',
      name: 'openai',
      message: 'OpenAI API key (GPT-5.5 — optional for Vidarr):',
    },
    {
      type: 'input',
      name: 'hindsight',
      message: 'Hindsight API key (memory persistence):',
      validate: v => v.length > 0 || 'Required for cross-session memory',
    },
    {
      type: 'input',
      name: 'semble',
      message: 'Semble API key (code search — or leave blank for local only):',
    },
  ]);
  return keys;
}

export async function promptConfirmInstall(summary) {
  const { ok } = await inquirer.prompt([{
    type: 'confirm',
    name: 'ok',
    message: `Install ${summary.components} ${summary.agents} into ${summary.target}?`,
    default: true,
  }]);
  return ok;
}

export async function promptRestartOpenCode() {
  const { restart } = await inquirer.prompt([{
    type: 'confirm',
    name: 'restart',
    message: 'Restart opencode now to pick up changes?',
    default: true,
  }]);
  return restart;
}

export async function promptSkillPacks() {
  const { usePacks } = await inquirer.prompt([{
    type: 'confirm',
    name: 'usePacks',
    message: 'Install curated skills from skills.sh ecosystem? (find-skills, React, Supabase, TDD, design, etc.)',
    default: true,
  }]);
  if (!usePacks) return [];

  const { packs } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'packs',
    message: 'Select skill packs to install:',
    choices: [
      { name: 'Core — find-skills, skill-creator, write-a-skill', value: 'core', checked: true },
      { name: 'Frontend — React, web-design, composition, a11y, shadcn/ui', value: 'frontend', checked: false },
      { name: 'Backend — Supabase, Postgres, API patterns, auth', value: 'backend', checked: false },
      { name: 'Testing — TDD, E2E, Playwright, test patterns', value: 'testing', checked: false },
      { name: 'Design — frontend-design, UI/UX, taste skills', value: 'design', checked: false },
    ],
    pageSize: 8,
  }]);
  return packs;
}
