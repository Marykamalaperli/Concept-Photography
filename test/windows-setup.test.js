import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { parseEnv, promisify } from 'node:util';

const run = promisify(execFile);

test('Windows setup prepares separate storage paths and preserves existing configuration', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'concept-windows-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'source workspace');
  const data = join(directory, 'private data');
  const backup = join(directory, 'backup volume');
  const dotenv = join(root, '.env');
  const script = join(root, 'scripts', 'setup-office.ps1');
  await mkdir(join(root, 'scripts'), { recursive: true });
  for (const filename of ['package.json', 'package-lock.json', 'scripts/setup-office.ps1']) {
    await copyFile(new URL('../' + filename, import.meta.url), join(root, filename));
  }
  const setup = (...args) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', script, ...args],
    { timeout: 120_000, windowsHide: true });
  const configure = ['-Mode', 'Configure', '-DataDirectory', data, '-BackupDirectory', backup, '-Port', '3487'];

  assert.match((await setup('-CheckOnly')).stdout, /Temporary rehearsal/);
  assert.match((await setup(...configure, '-CheckOnly')).stdout, /Setup check passed/);
  await assert.rejects(stat(dotenv), { code: 'ENOENT' });
  await assert.rejects(stat(data), { code: 'ENOENT' });
  await assert.rejects(setup('-Mode', 'Configure', '-CheckOnly', '-DataDirectory', data, '-BackupDirectory', data),
    /non-overlapping/);
  await assert.rejects(setup('-Mode', 'Configure', '-CheckOnly', '-DataDirectory', join(root, 'data'), '-BackupDirectory', backup),
    /outside the source checkout/);

  await setup(...configure);
  const saved = await readFile(dotenv, 'utf8');
  const { DATABASE_PATH: databasePath, BACKUP_DIRECTORY: backupPath, ...settings } = parseEnv(saved);
  assert.deepEqual(settings, { ENABLE_WEB_PUSH: '0', HOST: '127.0.0.1', PORT: '3487' }, 'Unexpected loopback settings');
  assert.equal(basename(databasePath), 'workforce.sqlite', 'Unexpected SQLite filename');
  assert.equal(await realpath(dirname(databasePath)), await realpath(data), 'Unexpected SQLite directory');
  assert.equal(await realpath(backupPath), await realpath(backup), 'Unexpected backup directory');
  assert.equal((await stat(data)).isDirectory(), true);
  assert.equal((await stat(backup)).isDirectory(), true);
  assert.match((await setup(...configure.slice(0, -2), '-Port', '3488')).stdout, /Existing configuration preserved/);
  assert.equal(await readFile(dotenv, 'utf8'), saved);
});

test('Windows update restores the previous release when dependency installation fails', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'concept-update-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scripts = join(directory, 'scripts');
  await mkdir(scripts);
  await copyFile(new URL('../scripts/update.ps1', import.meta.url), join(scripts, 'update.ps1'));
  await writeFile(join(scripts, 'backup.ps1'), "Add-Content $env:CONCEPT_TEST_UPDATE_LOG 'backup'\n");
  const previous = 'a'.repeat(40);
  const approved = 'b'.repeat(40);
  const scenario = join(directory, 'scenario.ps1');
  await writeFile(scenario, `
function global:git {
    $global:LASTEXITCODE = 0
    switch ($args[0]) {
        'rev-parse' { '${previous}' }
        'checkout' { Add-Content $env:CONCEPT_TEST_UPDATE_LOG ('checkout ' + $args[2]) }
    }
}
function global:npm.cmd {
    if ($global:TestInstallAttempted) {
        Add-Content $env:CONCEPT_TEST_UPDATE_LOG 'restore dependencies'
        $global:LASTEXITCODE = 0
    } else {
        $global:TestInstallAttempted = $true
        Add-Content $env:CONCEPT_TEST_UPDATE_LOG 'install failed'
        $global:LASTEXITCODE = 17
    }
}
function global:Get-ScheduledTask {}
function global:Read-Host { 'STOPPED' }
& (Join-Path $PSScriptRoot 'scripts/update.ps1') -ApprovedCommit '${approved}'
`);
  const log = join(directory, 'events.txt');
  await assert.rejects(run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', scenario],
    { timeout: 30_000, windowsHide: true, env: { ...process.env, CONCEPT_TEST_UPDATE_LOG: log } }), /previous checkout and dependencies were restored/);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split(/\r?\n/),
    ['backup', 'checkout ' + approved, 'install failed', 'checkout ' + previous, 'restore dependencies']);
});
