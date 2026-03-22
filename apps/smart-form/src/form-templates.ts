/**
 * Smart Form V1 — Mobile-first HTML template functions.
 *
 * Server-rendered HTML with minimal inline JS for progressive reveal.
 * No frontend framework, no build toolchain beyond TypeScript.
 */

import type { FieldError, ParsedSmartFormBody } from './validation.js';
import type { ReferenceDataCatalog } from '@unit-talk/contracts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function val(values: ParsedSmartFormBody, field: keyof ParsedSmartFormBody): string {
  return escapeHtml(values[field] ?? '');
}

function hasError(errorMap: Map<string, FieldError>, field: string): boolean {
  const err = errorMap.get(field);
  return err !== undefined && err.severity === 'error';
}

function hasWarning(errorMap: Map<string, FieldError>, field: string): boolean {
  const err = errorMap.get(field);
  return err !== undefined && err.severity === 'warning';
}

function fieldClass(errorMap: Map<string, FieldError>, field: string): string {
  if (hasError(errorMap, field)) return ' field-error';
  if (hasWarning(errorMap, field)) return ' field-warn';
  return '';
}

function errorHint(errorMap: Map<string, FieldError>, field: string): string {
  const err = errorMap.get(field);
  if (!err) return '';
  const cls = err.severity === 'error' ? 'hint-error' : 'hint-warn';
  return `<span class="hint ${cls}">${escapeHtml(err.message)}</span>`;
}

function buildErrorMap(errors: FieldError[]): Map<string, FieldError> {
  const map = new Map<string, FieldError>();
  for (const e of errors) {
    if (!map.has(e.field)) map.set(e.field, e);
  }
  return map;
}

// --- Segmented control renderer ---
function segmented(name: string, options: string[], selected: string | undefined): string {
  return `<div class="segmented" role="radiogroup">
${options
  .map(
    (opt) =>
      `<label class="seg-option${selected === opt ? ' seg-selected' : ''}">
  <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(opt)}"${selected === opt ? ' checked' : ''} />
  <span>${escapeHtml(opt)}</span>
</label>`,
  )
  .join('\n')}
</div>`;
}

// --- Main form page ---

export function renderSmartFormPage(options: {
  values?: ParsedSmartFormBody;
  errors?: FieldError[];
  catalog: ReferenceDataCatalog;
}): string {
  const v = options.values ?? {};
  const catalog = options.catalog;
  const errorMap = buildErrorMap(options.errors ?? []);
  const blockingErrors = (options.errors ?? []).filter((e) => e.severity === 'error');
  const warnings = (options.errors ?? []).filter((e) => e.severity === 'warning');
  const selectedMarket = v.marketType ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const sportIds = catalog.sports.map((s) => s.id);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unit Talk — Smart Form</title>
  <style>${CSS}</style>
</head>
<body>
<main>
  <section class="panel">
    <h1>Submit Pick</h1>
${blockingErrors.length > 0 ? `<div class="notice error">
  <strong>Please fix ${blockingErrors.length} error${blockingErrors.length > 1 ? 's' : ''} below.</strong>
  <ul class="error-list">${blockingErrors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul>
</div>` : ''}
${warnings.length > 0 ? `<div class="notice warn">
  <strong>${warnings.length} warning${warnings.length > 1 ? 's' : ''}:</strong>
  <ul class="error-list">${warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>
</div>` : ''}
    <form method="post" action="/submit">

      <!-- Section 1: Ticket Basics -->
      <fieldset>
        <legend>Ticket Basics</legend>

        <label class="field${fieldClass(errorMap, 'capper')}">
          <span class="field-label">Capper <span class="req">*</span></span>
          <input name="capper" type="text" placeholder="griff843" value="${val(v, 'capper')}" autocomplete="off" />
          ${errorHint(errorMap, 'capper')}
        </label>

        <label class="field${fieldClass(errorMap, 'date')}">
          <span class="field-label">Date <span class="req">*</span></span>
          <input name="date" type="date" value="${val(v, 'date') || today}" />
          ${errorHint(errorMap, 'date')}
        </label>

        <label class="field${fieldClass(errorMap, 'sport')}">
          <span class="field-label">Sport <span class="req">*</span></span>
          <select name="sport" id="sf-sport">
            <option value="">Select sport...</option>
            ${sportIds.map((s) => `<option value="${escapeHtml(s)}"${v.sport === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('\n            ')}
            <option value="Other"${v.sport && !sportIds.includes(v.sport) && v.sport !== '' ? ' selected' : ''}>Other</option>
          </select>
          ${v.sport && !sportIds.includes(v.sport) && v.sport !== '' ? `<input name="sportOther" type="text" placeholder="Enter sport" value="${escapeHtml(v.sport)}" class="other-input" />` : ''}
          ${errorHint(errorMap, 'sport')}
        </label>

        <label class="field${fieldClass(errorMap, 'sportsbook')}">
          <span class="field-label">Sportsbook</span>
          <select name="sportsbook">
            <option value="">Select sportsbook...</option>
            ${catalog.sportsbooks.map((sb) => `<option value="${escapeHtml(sb.id)}"${v.sportsbook === sb.id ? ' selected' : ''}>${escapeHtml(sb.name)}</option>`).join('\n            ')}
          </select>
          ${errorHint(errorMap, 'sportsbook')}
        </label>

        <label class="field${fieldClass(errorMap, 'units')}">
          <span class="field-label">Units <span class="req">*</span></span>
          <input name="units" type="number" step="0.5" min="0.5" max="5" inputmode="decimal" placeholder="1.0" value="${val(v, 'units') || '1.0'}" />
          ${errorHint(errorMap, 'units')}
        </label>

        <div class="field${fieldClass(errorMap, 'oddsFormat')}">
          <span class="field-label">Odds Format</span>
          ${segmented('oddsFormat', ['American', 'Decimal'], v.oddsFormat || 'American')}
        </div>

        <label class="field${fieldClass(errorMap, 'odds')}">
          <span class="field-label">Odds <span class="req">*</span></span>
          <input name="odds" type="number" step="1" inputmode="numeric" placeholder="-110" value="${val(v, 'odds')}" />
          ${errorHint(errorMap, 'odds')}
        </label>

      </fieldset>

      <!-- Ticket Type (V1: single only, read-only) -->
      <fieldset>
        <legend>Ticket Type</legend>
        <div class="field">
          <span class="ticket-type-badge">Single</span>
          <span class="hint">V1 supports single-leg tickets only.</span>
        </div>
      </fieldset>

      <!-- Section 2: Market Type -->
      <fieldset>
        <legend>Market Type <span class="req">*</span></legend>
        ${segmented('marketType', ['player-prop', 'moneyline', 'spread', 'total', 'team-total'], selectedMarket || undefined)}
        ${errorHint(errorMap, 'marketType')}
      </fieldset>

      <!-- Section 3: Bet Details (conditional) -->
      ${renderBetDetails(v, errorMap, selectedMarket, catalog)}

      <button type="submit">Submit Pick</button>
    </form>
  </section>
</main>
<script>
var __SF_SPORTS = ${JSON.stringify(Object.fromEntries(catalog.sports.map((s) => [s.id, { statTypes: s.statTypes, teams: s.teams }])))};
${CLIENT_JS}
</script>
</body>
</html>`;
}

function renderBetDetails(v: ParsedSmartFormBody, errorMap: Map<string, FieldError>, marketType: string, catalog: ReferenceDataCatalog): string {
  const marketTypes = ['player-prop', 'moneyline', 'spread', 'total', 'team-total'];
  const sections = marketTypes.map((mt) => {
    const show = marketType === mt;
    return `<fieldset class="bet-details" id="details-${mt}" ${show ? '' : 'style="display:none"'}>
  <legend>Bet Details</legend>
  ${renderMarketFields(mt, v, errorMap, catalog)}
</fieldset>`;
  });
  return sections.join('\n');
}

function renderMarketFields(mt: string, v: ParsedSmartFormBody, errorMap: Map<string, FieldError>, catalog: ReferenceDataCatalog): string {
  const sport = catalog.sports.find((s) => s.id === v.sport);
  const statTypes = sport?.statTypes ?? [];
  const teams = sport?.teams ?? [];
  const teamDatalist = teams.length > 0
    ? `<datalist id="teams-list">${teams.map((t) => `<option value="${escapeHtml(t)}">`).join('')}</datalist>`
    : '';

  function teamInput(label: string, placeholder: string): string {
    return `
  <label class="field${fieldClass(errorMap, 'team')}">
    <span class="field-label">${label} <span class="req">*</span></span>
    <input name="team" type="text" placeholder="${placeholder}" value="${val(v, 'team')}" list="teams-list" autocomplete="off" />
    ${teamDatalist}
    ${errorHint(errorMap, 'team')}
  </label>`;
  }

  switch (mt) {
    case 'player-prop':
      return `
  <label class="field${fieldClass(errorMap, 'player')}">
    <span class="field-label">Player <span class="req">*</span></span>
    <input name="player" type="text" placeholder="Jalen Brunson" value="${val(v, 'player')}" />
    ${errorHint(errorMap, 'player')}
  </label>
  <label class="field${fieldClass(errorMap, 'matchup')}">
    <span class="field-label">Matchup <span class="req">*</span></span>
    <input name="matchup" type="text" placeholder="Knicks vs Heat" value="${val(v, 'matchup')}" />
    ${errorHint(errorMap, 'matchup')}
  </label>
  <label class="field${fieldClass(errorMap, 'statType')}">
    <span class="field-label">Stat Type <span class="req">*</span></span>
    <select name="statType" id="sf-statType">
      <option value="">Select stat...</option>
      ${statTypes.map((s) => `<option value="${escapeHtml(s)}"${v.statType === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('\n      ')}
      <option value="Other"${v.statType && !statTypes.includes(v.statType) && v.statType !== '' ? ' selected' : ''}>Other</option>
    </select>
    ${v.statType && !statTypes.includes(v.statType) && v.statType !== '' && v.statType !== 'Other' ? `<input name="statTypeOther" type="text" placeholder="Enter stat type" value="${escapeHtml(v.statType)}" class="other-input" />` : ''}
    ${errorHint(errorMap, 'statType')}
  </label>
  <div class="field${fieldClass(errorMap, 'overUnder')}">
    <span class="field-label">Over / Under <span class="req">*</span></span>
    ${segmented('overUnder', ['Over', 'Under'], v.overUnder || undefined)}
    ${errorHint(errorMap, 'overUnder')}
  </div>
  <label class="field${fieldClass(errorMap, 'line')}">
    <span class="field-label">Line <span class="req">*</span></span>
    <input name="line" type="number" step="0.5" min="-999.5" max="999.5" inputmode="decimal" placeholder="24.5" value="${val(v, 'line')}" />
    ${errorHint(errorMap, 'line')}
  </label>`;

    case 'moneyline':
      return `
  <label class="field${fieldClass(errorMap, 'matchup')}">
    <span class="field-label">Matchup <span class="req">*</span></span>
    <input name="matchup" type="text" placeholder="Knicks vs Heat" value="${val(v, 'matchup')}" />
    ${errorHint(errorMap, 'matchup')}
  </label>
  ${teamInput('Team / Side', 'Knicks')}`;

    case 'spread':
      return `
  <label class="field${fieldClass(errorMap, 'matchup')}">
    <span class="field-label">Matchup <span class="req">*</span></span>
    <input name="matchup" type="text" placeholder="Knicks vs Heat" value="${val(v, 'matchup')}" />
    ${errorHint(errorMap, 'matchup')}
  </label>
  ${teamInput('Team / Side', 'Knicks')}
  <label class="field${fieldClass(errorMap, 'line')}">
    <span class="field-label">Line <span class="req">*</span></span>
    <input name="line" type="number" step="0.5" min="-999.5" max="999.5" inputmode="decimal" placeholder="-3.5" value="${val(v, 'line')}" />
    ${errorHint(errorMap, 'line')}
  </label>`;

    case 'total':
      return `
  <label class="field${fieldClass(errorMap, 'matchup')}">
    <span class="field-label">Matchup <span class="req">*</span></span>
    <input name="matchup" type="text" placeholder="Knicks vs Heat" value="${val(v, 'matchup')}" />
    ${errorHint(errorMap, 'matchup')}
  </label>
  <div class="field${fieldClass(errorMap, 'overUnder')}">
    <span class="field-label">Over / Under <span class="req">*</span></span>
    ${segmented('overUnder', ['Over', 'Under'], v.overUnder || undefined)}
    ${errorHint(errorMap, 'overUnder')}
  </div>
  <label class="field${fieldClass(errorMap, 'line')}">
    <span class="field-label">Line <span class="req">*</span></span>
    <input name="line" type="number" step="0.5" min="-999.5" max="999.5" inputmode="decimal" placeholder="215.5" value="${val(v, 'line')}" />
    ${errorHint(errorMap, 'line')}
  </label>`;

    case 'team-total':
      return `
  <label class="field${fieldClass(errorMap, 'matchup')}">
    <span class="field-label">Matchup <span class="req">*</span></span>
    <input name="matchup" type="text" placeholder="Knicks vs Heat" value="${val(v, 'matchup')}" />
    ${errorHint(errorMap, 'matchup')}
  </label>
  ${teamInput('Team', 'Knicks')}
  <div class="field${fieldClass(errorMap, 'overUnder')}">
    <span class="field-label">Over / Under <span class="req">*</span></span>
    ${segmented('overUnder', ['Over', 'Under'], v.overUnder || undefined)}
    ${errorHint(errorMap, 'overUnder')}
  </div>
  <label class="field${fieldClass(errorMap, 'line')}">
    <span class="field-label">Line <span class="req">*</span></span>
    <input name="line" type="number" step="0.5" min="-999.5" max="999.5" inputmode="decimal" placeholder="108.5" value="${val(v, 'line')}" />
    ${errorHint(errorMap, 'line')}
  </label>`;

    default:
      return '';
  }
}

// --- Success page ---

export function renderSmartFormSuccessPage(options: {
  values: ParsedSmartFormBody;
  submissionId: string;
  pickId: string;
  lifecycleState: string;
  domainAnalysis?: string;
  promotion?: string;
}): string {
  const market = options.values.sport && options.values.marketType
    ? `${options.values.sport} ${options.values.marketType}`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pick Created | Unit Talk</title>
  <style>${CSS}</style>
</head>
<body>
<main>
  <section class="panel">
    <div class="notice success">
      <strong>Pick created.</strong>
    </div>
    <div class="review-card">
      <dl>
        <dt>Pick ID</dt><dd><code>${escapeHtml(options.pickId)}</code></dd>
        <dt>Lifecycle</dt><dd>${escapeHtml(options.lifecycleState)}</dd>
        ${market ? `<dt>Market</dt><dd>${escapeHtml(market)}</dd>` : ''}
        ${options.domainAnalysis ? `<dt>Domain Analysis</dt><dd>${escapeHtml(options.domainAnalysis)}</dd>` : ''}
        ${options.promotion ? `<dt>Promotion</dt><dd>${escapeHtml(options.promotion)}</dd>` : ''}
      </dl>
    </div>
    <div class="actions">
      <a class="btn-primary" href="/">Submit Another</a>
    </div>
  </section>
</main>
</body>
</html>`;
}

// --- CSS ---
const CSS = `
:root {
  color-scheme: light;
  --bg: #f3ede3;
  --panel: #fffdf8;
  --ink: #1f2933;
  --muted: #6b7280;
  --line: #d7d0c3;
  --accent: #0f4c81;
  --error: #be123c;
  --error-bg: #fff1f2;
  --warn: #b45309;
  --warn-bg: #fffbeb;
  --success: #166534;
  --success-bg: #ecfdf3;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--ink);
  -webkit-text-size-adjust: 100%;
}
main {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 12px 48px;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 20px 16px;
  box-shadow: 0 8px 24px rgba(31,41,51,0.06);
}
h1 {
  margin: 0 0 12px;
  font-size: 1.25rem;
}
.notice {
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 0.9rem;
}
.notice.error { background: var(--error-bg); border: 1px solid #fecdd3; color: var(--error); }
.notice.warn { background: var(--warn-bg); border: 1px solid #fde68a; color: var(--warn); }
.notice.success { background: var(--success-bg); border: 1px solid #bbf7d0; color: var(--success); }
.error-list { margin: 6px 0 0; padding-left: 18px; }
form { display: grid; gap: 0; }
fieldset {
  border: none;
  padding: 0;
  margin: 0 0 16px;
}
legend {
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 10px;
  color: var(--ink);
}
.field {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
}
.field-label {
  font-weight: 600;
  font-size: 0.875rem;
}
.req { color: var(--error); }
input, select, textarea {
  font: inherit;
  font-size: 1rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  min-height: 44px;
  width: 100%;
}
select { appearance: auto; }
.field-error input, .field-error select { border-color: var(--error); background: var(--error-bg); }
.field-warn input, .field-warn select { border-color: var(--warn); background: var(--warn-bg); }
.hint { font-size: 0.8rem; color: var(--muted); }
.hint-error { color: var(--error); font-weight: 600; }
.hint-warn { color: var(--warn); }
.other-input { margin-top: 6px; }
.segmented {
  display: flex;
  gap: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.seg-option {
  flex: 1;
  text-align: center;
  cursor: pointer;
  padding: 10px 6px;
  font-size: 0.85rem;
  font-weight: 600;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--line);
  background: #fff;
  transition: background 0.15s;
}
.seg-option:last-child { border-right: none; }
.seg-option input { display: none; }
.seg-selected { background: var(--accent); color: #fff; }
button {
  font: inherit;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 14px 18px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  min-height: 48px;
  margin-top: 8px;
}
button:active { opacity: 0.9; }
.review-card { margin: 16px 0; }
.review-card dl {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 6px 10px;
}
.review-card dt { font-weight: 700; font-size: 0.875rem; }
.review-card dd { margin: 0; color: var(--muted); font-size: 0.875rem; }
code { font-family: Consolas, monospace; font-size: 0.85rem; }
.ticket-type-badge {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 4px 12px;
  font-weight: 700;
  font-size: 0.85rem;
}
.actions { margin-top: 16px; }
.btn-primary {
  display: inline-block;
  text-decoration: none;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  padding: 12px 20px;
  font-weight: 700;
}
`;

// --- Minimal client-side JS for progressive reveal + sport filtering ---
const CLIENT_JS = `
(function() {
  var types = ['player-prop','moneyline','spread','total','team-total'];
  var radios = document.querySelectorAll('input[name="marketType"]');

  function showDetails(selected) {
    types.forEach(function(t) {
      var el = document.getElementById('details-' + t);
      if (el) el.style.display = t === selected ? '' : 'none';
    });
  }

  radios.forEach(function(r) {
    r.addEventListener('change', function() { showDetails(this.value); });
  });

  // Segmented control click highlighting
  document.querySelectorAll('.segmented').forEach(function(seg) {
    seg.querySelectorAll('input[type="radio"]').forEach(function(r) {
      r.addEventListener('change', function() {
        seg.querySelectorAll('.seg-option').forEach(function(o) {
          o.classList.toggle('seg-selected', o.querySelector('input').checked);
        });
      });
    });
  });

  // Sport-driven filtering
  var sportSelect = document.getElementById('sf-sport');
  var statTypeSelect = document.getElementById('sf-statType');
  if (sportSelect) {
    sportSelect.addEventListener('change', function() {
      var sportId = this.value;
      var data = (typeof __SF_SPORTS !== 'undefined' && __SF_SPORTS[sportId]) || null;

      // Update stat type options
      if (statTypeSelect && data) {
        var current = statTypeSelect.value;
        statTypeSelect.innerHTML = '<option value="">Select stat...</option>';
        data.statTypes.forEach(function(st) {
          var opt = document.createElement('option');
          opt.value = st; opt.textContent = st;
          if (st === current) opt.selected = true;
          statTypeSelect.appendChild(opt);
        });
        var otherOpt = document.createElement('option');
        otherOpt.value = 'Other'; otherOpt.textContent = 'Other';
        statTypeSelect.appendChild(otherOpt);
      }

      // Update team datalists
      document.querySelectorAll('datalist#teams-list').forEach(function(dl) {
        dl.innerHTML = '';
        if (data && data.teams) {
          data.teams.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t;
            dl.appendChild(opt);
          });
        }
      });
    });
  }
})();
`;
