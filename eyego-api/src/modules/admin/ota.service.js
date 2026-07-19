'use strict';

// ── Admin OTA deploy console ─────────────────────────────────────────────
// Powers the admin "OTA Deploy" page. Three integrations:
//   1. EAS GraphQL API (read-only): published update groups + channels per app.
//   2. GitHub workflow-dispatch: triggers .github/workflows/ota-update.yml,
//      which runs `eas update` (publish latest pushed code) or
//      `eas update:republish` (rollback to a previous update group).
//   3. GitHub runs API: live status of recent OTA workflow runs so the admin
//      can watch a publish go from queued → in_progress → completed.
//
// Publishing bundles the code currently on GITHUB_REF (main) — the admin
// console is a deploy trigger, not a code editor. All settings optional:
// endpoints explain exactly what's missing instead of 500ing when unset.

const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');

const EAS_GRAPHQL_URL = 'https://api.expo.dev/graphql';

// EAS project IDs from each app's app.json (extra.eas.projectId). Static by
// design — they identify the Expo projects, not an environment.
const APPS = {
  rider: { name: 'EyeGo Rider', projectId: '30035ca0-774a-4488-9ce9-0370e76c9634' },
  driver: { name: 'EyeGo Driver', projectId: '1b1842be-f2bb-43b2-8b56-37693a7e85cd' },
};

function configStatus() {
  return {
    easRead: !!env.EXPO_TOKEN,
    publish: !!(env.GITHUB_TOKEN && env.GITHUB_REPO),
    repo: env.GITHUB_REPO || null,
    ref: env.GITHUB_REF,
    workflowFile: env.OTA_WORKFLOW_FILE,
  };
}

// ── EAS reads ────────────────────────────────────────────────────────────

async function easQuery(query, variables) {
  const res = await axios.post(
    EAS_GRAPHQL_URL,
    { query, variables },
    { headers: { Authorization: `Bearer ${env.EXPO_TOKEN}` }, timeout: 15000 },
  );
  if (res.data.errors?.length) {
    throw new AppError(`EAS API error: ${res.data.errors[0].message}`, 502, 'EAS_API_ERROR');
  }
  return res.data.data;
}

const UPDATE_GROUPS_QUERY = `
  query AdminOtaUpdateGroups($appId: String!, $limit: Int!, $offset: Int!) {
    app {
      byId(appId: $appId) {
        id
        updateGroups(limit: $limit, offset: $offset) {
          id
          group
          message
          createdAt
          runtimeVersion
          platform
          gitCommitHash
          branch { id name }
        }
        updateChannels(limit: 10, offset: 0) {
          id
          name
          branchMapping
        }
      }
    }
  }
`;

/**
 * One app's OTA state: channels and recent update groups (deduped from the
 * per-platform update rows EAS returns, newest first).
 */
async function getAppUpdates(appKey, limit = 10) {
  const app = APPS[appKey];
  if (!app) throw new AppError(`Unknown app '${appKey}' — expected rider or driver`, 400);
  const data = await easQuery(UPDATE_GROUPS_QUERY, { appId: app.projectId, limit, offset: 0 });
  const node = data?.app?.byId;
  const rawGroups = node?.updateGroups ?? [];

  // updateGroups rows are per-platform (one android + one ios row per publish
  // group) — collapse to one entry per group id with a platforms list.
  const byGroup = new Map();
  for (const row of rawGroups.flat()) {
    const existing = byGroup.get(row.group);
    if (existing) {
      if (!existing.platforms.includes(row.platform)) existing.platforms.push(row.platform);
    } else {
      byGroup.set(row.group, {
        group: row.group,
        message: row.message,
        createdAt: row.createdAt,
        runtimeVersion: row.runtimeVersion,
        gitCommitHash: row.gitCommitHash,
        branch: row.branch?.name ?? null,
        platforms: [row.platform],
      });
    }
  }
  const updates = [...byGroup.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    app: appKey,
    name: app.name,
    projectId: app.projectId,
    channels: (node?.updateChannels ?? []).map((c) => ({ name: c.name, branchMapping: c.branchMapping })),
    updates,
  };
}

// ── GitHub workflow dispatch + status ────────────────────────────────────

function githubHeaders() {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function requirePublishConfig() {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new AppError(
      'OTA publishing is not configured: set GITHUB_TOKEN and GITHUB_REPO in the backend environment',
      503,
      'OTA_NOT_CONFIGURED',
    );
  }
}

/**
 * Trigger the OTA workflow. action 'publish' ships the latest code on
 * GITHUB_REF to `channel`; action 'republish' rolls the given update group
 * back out (app must be a single app for republish — a group belongs to one).
 */
async function dispatchOta({ action = 'publish', app = 'both', channel = 'production', message, group }, adminId) {
  requirePublishConfig();
  if (!['publish', 'republish'].includes(action)) throw new AppError("action must be 'publish' or 'republish'", 400);
  if (!['rider', 'driver', 'both'].includes(app)) throw new AppError("app must be 'rider', 'driver', or 'both'", 400);
  if (!['production', 'preview'].includes(channel)) throw new AppError("channel must be 'production' or 'preview'", 400);
  if (action === 'republish') {
    if (!group) throw new AppError('group (update group ID) is required for a rollback', 400);
    if (app === 'both') throw new AppError('Rollback targets one app — an update group belongs to a single app', 400);
  }
  if (action === 'publish' && (!message || !message.trim())) {
    throw new AppError('message is required — describe what this update changes', 400);
  }

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.OTA_WORKFLOW_FILE}/dispatches`;
  try {
    await axios.post(
      url,
      {
        ref: env.GITHUB_REF,
        inputs: {
          action,
          app,
          channel,
          message: (message || `Rollback by ${adminId}`).trim().slice(0, 200),
          group: group || '',
        },
      },
      { headers: githubHeaders(), timeout: 15000 },
    );
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.message;
    if (status === 404) {
      throw new AppError(
        `GitHub returned 404 — check GITHUB_REPO (${env.GITHUB_REPO}), that ${env.OTA_WORKFLOW_FILE} exists on ${env.GITHUB_REF}, and that the token can access the repo`,
        502, 'OTA_DISPATCH_FAILED',
      );
    }
    if (status === 401 || status === 403) {
      throw new AppError('GitHub rejected the token — it needs Actions read/write on the repo', 502, 'OTA_DISPATCH_FAILED');
    }
    throw new AppError(`Failed to dispatch OTA workflow: ${detail}`, 502, 'OTA_DISPATCH_FAILED');
  }

  logger.info(`[ADMIN] OTA ${action} dispatched by ${adminId}: app=${app} channel=${channel}${group ? ` group=${group}` : ''}`);
  return { dispatched: true, action, app, channel, ref: env.GITHUB_REF };
}

/** Recent OTA workflow runs with live status for the admin page. */
async function getOtaRuns(limit = 8) {
  requirePublishConfig();
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.OTA_WORKFLOW_FILE}/runs`;
  const res = await axios.get(url, {
    headers: githubHeaders(),
    params: { per_page: Math.min(limit, 20) },
    timeout: 15000,
  });
  return (res.data.workflow_runs ?? []).map((r) => ({
    id: r.id,
    status: r.status, // queued | in_progress | completed
    conclusion: r.conclusion, // success | failure | cancelled | null
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    title: r.display_title,
  }));
}

/** Everything the OTA Deploy page needs in one call. */
async function getOverview() {
  const config = configStatus();
  const result = { config, apps: [], runs: [], errors: [] };

  if (config.easRead) {
    const settled = await Promise.allSettled([getAppUpdates('rider'), getAppUpdates('driver')]);
    for (const [i, s] of settled.entries()) {
      if (s.status === 'fulfilled') result.apps.push(s.value);
      else {
        const key = i === 0 ? 'rider' : 'driver';
        result.apps.push({ app: key, name: APPS[key].name, channels: [], updates: [], error: s.reason?.message });
        result.errors.push(`${key}: ${s.reason?.message}`);
      }
    }
  }

  if (config.publish) {
    try {
      result.runs = await getOtaRuns();
    } catch (err) {
      result.errors.push(`runs: ${err.message}`);
    }
  }

  return result;
}

module.exports = { getOverview, getAppUpdates, dispatchOta, getOtaRuns, configStatus };
