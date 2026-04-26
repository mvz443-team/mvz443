#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const defaults = {
  repoDir: 'proto-repo-temp',
  outDir: 'src/pb',
};

const args = parseArgs(process.argv.slice(2));
const repoUrl = args.repo || process.env.PROTO_REPO_URL || args._[0];
const repoDir = path.resolve(projectRoot, args['repo-dir'] || process.env.PROTO_REPO_DIR || defaults.repoDir);
const outDir = path.resolve(projectRoot, args['out-dir'] || process.env.PROTO_OUT_DIR || defaults.outDir);
const branch = args.branch || process.env.PROTO_REPO_BRANCH;
const protoDir = args['proto-dir'] || process.env.PROTO_DIR;
const skipPull = Boolean(args['skip-pull'] || process.env.PROTO_SKIP_PULL);

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

ensureGitignoreEntries([
  toGitignorePattern(repoDir),
  toGitignorePattern(outDir),
]);

if (!fs.existsSync(repoDir)) {
  if (!repoUrl) {
    fail([
      '[prepare-protos] Contract repo is missing and no repo URL was provided.',
      `  Expected repo dir: ${repoDir}`,
      '  Usage: node scripts/prepare-protos.mjs --repo <git-url>',
      '  Or set: PROTO_REPO_URL=<git-url>',
    ].join('\n'));
  }

  const cloneArgs = ['clone'];
  if (branch) {
    cloneArgs.push('--branch', branch);
  }
  cloneArgs.push(repoUrl, repoDir);
  run('git', cloneArgs, projectRoot);
} else if (isGitRepo(repoDir) && !skipPull) {
  run('git', ['-C', repoDir, 'pull', '--ff-only'], projectRoot);
}

if (!fs.existsSync(path.join(repoDir, 'Makefile'))) {
  fail(`[prepare-protos] Makefile not found in contract repo: ${repoDir}`);
}

fs.mkdirSync(outDir, { recursive: true });

const makeOutDir = path.relative(repoDir, outDir).replaceAll(path.sep, '/');
const makeArgs = ['typescript', `OUT_DIR=${makeOutDir}`];
if (protoDir) {
  makeArgs.push(`PROTO_DIR=${protoDir}`);
}

run('make', makeArgs, repoDir);

process.stdout.write(`[prepare-protos] Generated TypeScript protobuf files in ${outDir}\n`);

function parseArgs(rawArgs) {
  const parsed = { _: [] };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');

    if (equalsIndex !== -1) {
      const key = withoutPrefix.slice(0, equalsIndex);
      parsed[key] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const next = rawArgs[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[withoutPrefix] = true;
      continue;
    }

    parsed[withoutPrefix] = next;
    i += 1;
  }

  return parsed;
}

function run(command, commandArgs, cwd) {
  process.stdout.write(`[prepare-protos] Running: ${command} ${commandArgs.join(' ')}\n`);
  const env = withLocalBinOnPath(process.env);
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });

  if (result.error) {
    fail(`[prepare-protos] Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`[prepare-protos] ${command} exited with code ${result.status ?? 'unknown'}.`);
  }
}

function withLocalBinOnPath(env) {
  const nextEnv = { ...env };
  const pathKey = Object.keys(nextEnv).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const localBin = path.join(projectRoot, 'node_modules', '.bin');
  nextEnv[pathKey] = [localBin, nextEnv[pathKey]].filter(Boolean).join(path.delimiter);
  return nextEnv;
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function ensureGitignoreEntries(entries) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const normalizedExisting = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missing = entries.filter((entry) => !normalizedExisting.has(entry));

  if (missing.length === 0) {
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}\n# Generated protocol contracts\n${missing.join('\n')}\n`;
  fs.appendFileSync(gitignorePath, block);
}

function toGitignorePattern(targetPath) {
  const relative = path.relative(projectRoot, targetPath).replaceAll(path.sep, '/');
  return `${relative.replace(/\/$/, '')}/`;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/prepare-protos.mjs --repo <git-url>

Options:
  --repo <git-url>       Type contract git repository URL.
  --repo-dir <path>      Local copy path. Default: ${defaults.repoDir}
  --out-dir <path>       Generated TypeScript output path. Default: ${defaults.outDir}
  --branch <name>        Branch to clone when repo-dir does not exist.
  --proto-dir <path>     PROTO_DIR passed to make.
  --skip-pull            Do not pull an existing git repo.

Environment:
  PROTO_REPO_URL, PROTO_REPO_DIR, PROTO_OUT_DIR, PROTO_REPO_BRANCH, PROTO_DIR
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
