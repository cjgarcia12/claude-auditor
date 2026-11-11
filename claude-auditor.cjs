#!/usr/bin/env node
// Read-only MCP auditor. Node.js 18+, no dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let home = os.homedir(), project = process.cwd(), configs = [];
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (option === '--help') {
    console.log('Usage: claude-auditor.cjs [--home DIR] [--project DIR] [--config FILE ...]\nExplicit configs replace known-location discovery. Exit: 0 clean, 1 findings, 2 usage error.');
    process.exit(0);
  }
  if (!['--home', '--project', '--config'].includes(option) || !process.argv[i + 1]) {
    console.error(`Invalid option or missing value: ${option}`); process.exit(2);
  }
  const value = path.resolve(process.argv[++i]);
  if (option === '--home') home = value;
  else if (option === '--project') project = value;
  else configs.push(value);
}
const explicit = configs.length > 0;
if (!explicit) configs = [
  path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
  path.join(home, '.config/Claude/claude_desktop_config.json'),
  path.join(home, '.claude.json'),
  path.join(project, '.claude/settings.json'),
  path.join(project, '.claude/settings.local.json'),
  path.join(project, '.mcp.json'),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'Claude/claude_desktop_config.json')] : [])
];
configs = [...new Set(configs)];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const canonical = x => JSON.stringify(object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x ?? null);
const fields = ['command', 'args', 'env', 'url'];
const entries = [], errors = [], skipped = [];
for (const file of configs) {
  if (!fs.existsSync(file)) {
    skipped.push(file);
    if (explicit) errors.push(`${file}: requested file is missing`);
    continue;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (!object(data)) throw new Error('root must be an object');
    const base = path.basename(path.dirname(file)) === '.claude' ? path.dirname(path.dirname(file)) : path.dirname(file);
    const scopes = [{ config: data, label: 'mcpServers', base }];
    if (data.projects !== undefined && !object(data.projects)) throw new Error('projects must be an object');
    for (const [directory, config] of Object.entries(data.projects || {})) {
      if (!object(config)) { errors.push(`${file}: project config must be an object`); continue; }
      scopes.push({ config, label: `projects[${JSON.stringify(directory)}].mcpServers`, base: path.resolve(directory) });
    }
    for (const scope of scopes) {
      if (scope.config.mcpServers === undefined) continue;
      if (!object(scope.config.mcpServers)) { errors.push(`${file} :: ${scope.label}: must be an object`); continue; }
      for (const [name, server] of Object.entries(scope.config.mcpServers)) {
        const source = `${file} :: ${scope.label} :: ${name}`;
        if (!object(server) || ['command', 'url'].some(k => server[k] !== undefined && typeof server[k] !== 'string') ||
            (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(x => typeof x !== 'string'))) ||
            (server.env !== undefined && (!object(server.env) || Object.values(server.env).some(x => typeof x !== 'string')))) {
          errors.push(`${source}: invalid server or command/args/env/url types`); continue;
        }
        entries.push({ name, server, source, base: scope.base });
      }
    }
  } catch (error) { errors.push(`${file}: ${error instanceof SyntaxError ? 'invalid JSON' : error.message}`); }
}
console.log('Claude / MCP configuration audit');
console.log(`Files checked: ${configs.length}; missing: ${skipped.length}; server entries: ${entries.length}`);
for (const file of configs) console.log(`  ${skipped.includes(file) ? 'SKIPPED' : 'READ'} ${file}`);
let findings = 0;
const groups = new Map();
for (const entry of entries) groups.set(entry.name, [...(groups.get(entry.name) || []), entry]);
for (const [name, group] of groups) {
  if (group.length < 2) continue;
  const differing = fields.filter(k => new Set(group.map(e => canonical(e.server[k]))).size > 1);
  console.log(`\n${differing.length ? 'CONFLICT' : 'DUPLICATE (harmless)'}: ${name}`);
  for (const entry of group) {
    console.log(`  ${entry.source}`);
    for (const field of differing) console.log(`    ${field}: ${field === 'env' ? '<redacted; values differ>' : canonical(entry.server[field])}`);
  }
  if (differing.length) findings++;
}
for (const { name, server, source, base } of entries) {
  const env = { ...process.env, ...server.env };
  const expand = raw => raw.replace(/^~(?=[/\\]|$)/, home).replace(/\$\{([^}]+)\}|\$(\w+)/g, (all, a, b) => env[a || b] ?? all);
  const resolve = raw => path.resolve(base, expand(raw));
  const executable = p => { try { return fs.statSync(p).isFile() && (fs.accessSync(p, fs.constants.X_OK), true); } catch { return false; } };
  const issues = [];
  if (server.command) {
    const cmd = expand(server.command);
    const found = /[/\\]/.test(cmd) ? executable(resolve(cmd)) :
      (env.PATH || '').split(path.delimiter).some(dir => executable(path.resolve(dir || base, cmd)));
    if (!found) issues.push('command missing or not executable (checked file/PATH)');
  }
  for (const [i, arg] of (server.args || []).entries()) {
    const candidate = arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    if (/^(\/|\.\.?[/\\]|~[/\\]|\$)/.test(candidate) && !candidate.includes('://') && !fs.existsSync(resolve(candidate)))
      issues.push(`args[${i}] references a missing path`);
  }
  if (issues.length) { findings++; console.log(`\nBROKEN: ${name}\n  ${source}\n  ${issues.join('\n  ')}`); }
}
for (const error of errors) console.log(`\nCONFIG ERROR: ${error}`);
if (!findings && !errors.length) console.log('\nNo conflicts or broken references detected.');
console.log(`\nSummary: ${findings} problematic server/group(s), ${errors.length} config error(s).`);
process.exitCode = findings || errors.length ? 1 : 0;
