/**
 * Capture web dashboard screenshots for the user manual.
 * Launches a fresh Chromium browser with Playwright.
 */
const { chromium } = require('playwright');

const BASE_URL = process.env.CM_URL || 'http://localhost:8080';
const API_KEY = process.env.CM_API_KEY || '';
const OUT = './docs/screenshots';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Set shorter timeout
  page.setDefaultTimeout(10000);

  // Navigate, set API key, reload
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key) => { localStorage.setItem('cm-api-key', key); }, API_KEY);

  // 1. Dashboard
  console.log('1. Dashboard');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/web_dashboard.png`, timeout: 5000 });

  // Get data
  const agents = await page.evaluate(async (key) => {
    const r = await fetch('/api/agents', { headers: { 'Authorization': `Bearer ${key}` } });
    const data = await r.json();
    return data.data || data;
  }, API_KEY);

  // 2. Agent Detail
  const agent = agents.find(a => a.project_id && !['archived','completed'].includes(a.status)) || agents[0];
  if (agent) {
    console.log(`2. Agent Detail: ${agent.title}`);
    await page.goto(`${BASE_URL}/agent/${agent.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/web_agent_detail.png`, timeout: 5000 });
  }

  // 3. Projects
  console.log('3. Projects');
  await page.goto(`${BASE_URL}/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/web_projects.png`, timeout: 5000 });

  // 4. Project Detail
  const projects = await page.evaluate(async (key) => {
    const r = await fetch('/api/projects', { headers: { 'Authorization': `Bearer ${key}` } });
    const data = await r.json();
    return data.data || data;
  }, API_KEY);

  if (projects.length > 0) {
    console.log(`4. Project Detail: ${projects[0].name}`);
    await page.goto(`${BASE_URL}/projects/${projects[0].id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/web_project_detail.png`, timeout: 5000 });
  }

  // 5. Settings
  console.log('5. Settings');
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/web_settings.png`, timeout: 5000 });

  // 6. Workflows
  console.log('6. Workflows');
  await page.goto(`${BASE_URL}/workflows`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/web_workflows.png`, timeout: 5000 });

  console.log('Done!');
  await browser.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
