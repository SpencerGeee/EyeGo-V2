#!/usr/bin/env node
/**
 * Frees the Prisma query engine before `prisma generate` runs.
 *
 * On Windows a running process that has loaded query_engine-windows.dll.node keeps
 * an exclusive handle on it, so generate cannot rename its freshly-written engine
 * over the old one and dies with:
 *
 *   EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp12656'
 *     -> '...query_engine-windows.dll.node'
 *
 * Every failed attempt also abandons a ~19MB .tmpNNNN copy; they accumulate fast
 * (37 of them = 703MB when this script was written).
 *
 * So: kill whatever is holding the engine, then sweep the abandoned temps.
 *
 * Scoping is by loaded module, not by process name or command line — we only kill
 * processes that actually have THIS checkout's engine mapped, so an unrelated node
 * server or another repo's dev server is never touched. Note that `prisma studio`
 * holds the engine too, and will be stopped for the same reason.
 *
 * POSIX renames over open files happily, so the kill is a no-op off Windows.
 * Wired into `predev` only — never `prestart`/`postinstall`, which run in
 * production where killing the live server would be an outage.
 *
 * Always exits 0: freeing the lock is best-effort, and generate reports the real
 * error if it still cannot write.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLIENT_DIRS = [
  path.join(__dirname, '..', 'node_modules', '.prisma', 'client'),
  path.join(__dirname, '..', '..', 'node_modules', '.prisma', 'client'),
].filter((dir) => fs.existsSync(dir));

/** PIDs of processes with an engine binary from `dirs` currently mapped. */
function holdersWindows(dirs) {
  const patterns = dirs.map((dir) => `'${path.resolve(dir).replace(/'/g, "''")}\\query_engine-*'`);
  const script = `
    $hits = @()
    Get-Process -Name node,prisma,query-engine -ErrorAction SilentlyContinue | ForEach-Object {
      $proc = $_
      try {
        foreach ($m in $proc.Modules) {
          if (${patterns.map((p) => `$m.FileName -like ${p}`).join(' -or ')}) { $hits += $proc.Id; break }
        }
      } catch { }
    }
    $hits | Sort-Object -Unique
  `;

  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
    });
    return out
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && pid !== process.ppid);
  } catch {
    // No PowerShell, blocked by policy, or enumeration denied — fall through to the sweep.
    return [];
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, we just cannot signal it
  }
}

/** Terminate `pids` and wait for the OS to actually release their handles. */
function stop(pids) {
  const stopped = [];

  for (const pid of pids) {
    try {
      process.kill(pid);
      stopped.push(pid);
    } catch (err) {
      if (err.code !== 'ESRCH') {
        console.warn(`[free-prisma-engine] could not stop pid ${pid}: ${err.code || err.message}`);
      }
    }
  }

  // Handles drop at process exit, not at the kill call.
  const deadline = Date.now() + 5000;
  while (stopped.some(alive) && Date.now() < deadline) {
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},100)'], { stdio: 'ignore' });
  }

  const stubborn = stopped.filter(alive);
  if (stubborn.length) {
    console.warn(`[free-prisma-engine] pid(s) ${stubborn.join(', ')} did not exit; generate may still fail`);
  }

  return stopped;
}

/** Delete engine temps abandoned by previous failed renames. */
function sweepTemps(dirs) {
  let freedBytes = 0;
  let count = 0;

  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (!name.startsWith('query_engine-') || !/\.tmp\d+$/.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const { size } = fs.statSync(file);
        fs.unlinkSync(file);
        freedBytes += size;
        count += 1;
      } catch {
        // Still locked, or already gone. Next run gets it.
      }
    }
  }

  return { count, mb: Math.round(freedBytes / 1048576) };
}

function main() {
  if (process.env.CI || process.env.NODE_ENV === 'production') return;
  if (!CLIENT_DIRS.length) return;

  if (process.platform === 'win32') {
    const stopped = stop(holdersWindows(CLIENT_DIRS));
    if (stopped.length) {
      console.log(`[free-prisma-engine] stopped ${stopped.length} process(es) holding the query engine: ${stopped.join(', ')}`);
    }
  }

  const { count, mb } = sweepTemps(CLIENT_DIRS);
  if (count) {
    console.log(`[free-prisma-engine] removed ${count} abandoned engine temp file(s), freeing ~${mb}MB`);
  }
}

try {
  main();
} catch (err) {
  console.warn(`[free-prisma-engine] skipped: ${err.message}`);
}
