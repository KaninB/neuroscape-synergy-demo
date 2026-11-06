    const $ = id => document.getElementById(id);
    // Custom steppers: − / + buttons flank each number input (native spinners hidden).
    // Hold to repeat; keyboard activation (Enter/Space → click with detail 0) steps once.
    for (const btn of document.querySelectorAll('.step-btn')) {
      const input = $(btn.dataset.for), min = Number(btn.dataset.min), max = Number(btn.dataset.max);
      const dir = btn.classList.contains('plus') ? 1 : -1;
      const apply = () => {
        const current = Number(input.value);
        const base = Number.isFinite(current) ? current : min;
        const next = Math.min(max, Math.max(min, base + dir));
        if (next !== base || input.value === '') {
          input.value = next;
          input.dispatchEvent(new Event('input', {bubbles:true}));
        }
      };
      let timer = null, repeat = null;
      const stop = () => { clearTimeout(timer); clearInterval(repeat); timer = repeat = null; };
      btn.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        apply();
        timer = setTimeout(() => { repeat = setInterval(apply, 90); }, 420);
      });
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('click', event => { if (event.detail === 0) apply(); });
    }
    const colors = ['#24C8A5','#E25C8D','#F4B942','#8B7CF6','#56B4E9','#F0785A'];
    const chartRedraws = [];
    const catalog = globalThis.NEUROSCAPE_CATALOG;
    const engine = globalThis.NEUROSCAPE_ENGINE;
    let latest = null, currentParse = null;
    const pct = value => `${(100 * value).toFixed(1)}%`;
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function svgNode(tag, attrs = {}, text = '') {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text) el.textContent = text;
      return el;
    }
    function render(result) {
      latest = result; $('placeholder').hidden = true; $('status').hidden = true; $('results').hidden = false;
      const mf = result.mainframe, tiers = mf.tiers, curves = result.curves, draw = result.draw_only;
      const tierNums = tiers.map(tier => tier.tier);
      const trials = result.settings.trials_per_position, maxTurn = result.settings.turns;
      let positionView = 'first';
      $('resultTitle').textContent = `${mf.name} · ${result.deck_size} cards`;
      $('resultSubtitle').textContent = `n = ${trials.toLocaleString()} simulated games per position · ${maxTurn} own turns · RAM budget ${result.settings.ram_target} (${result.settings.ram_target_selection})`;
      function medianFirstHit(tier, position) {
        const rows = curves.filter(r => r.tier === tier && r.position === position).sort((a,b) => a.turn - b.turn);
        const firstTurns = [];
        let previous = 0;
        for (const r of rows) {
          if (r.reached_count > previous) firstTurns.push(...Array(r.reached_count - previous).fill(r.turn));
          previous = Math.max(previous, r.reached_count);
        }
        return firstTurns.length ? firstTurns[Math.floor((firstTurns.length - 1) / 2)] : null;
      }
      // --- verdict strip: when each tier typically comes online ---
      $('verdict').innerHTML = tiers.map(tier => {
        const m1 = medianFirstHit(tier.tier,'first'), m2 = medianFirstHit(tier.tier,'second');
        const fmt = m => m === null ? 'not reached' : `turn ${m}`;
        return `<div class="card"><small><span class="swatch" style="background:${colors[(tier.tier-1)%colors.length]}"></span>Tier ${tier.tier} · typically online</small>`+
          `<b>${esc(fmt(m1))}</b><small>going first · ${esc(fmt(m2))} going second</small></div>`;
      }).join('');
      // --- composition (moved to top) ---
      const highTier = result.source_summary_by_tier[String(tiers.at(-1).tier)];
      $('composition').innerHTML = tiers.map(tier=>{const s=result.source_summary_by_tier[String(tier.tier)];
        const overlap=Object.keys(tier.faction_requirements).length>1 ?
          ` ${s.multi_required_faction_sources} cards carry both required factions.` : '';
        return `<p><strong>Tier ${tier.tier}:</strong> ${s.source_cards} qualifying persistent cards (${pct(s.source_fraction)} of the deck); `+
          `${Object.entries(s.icons_by_faction).map(([f,n])=>`${n} ${esc(f)} icons`).join(', ')}.${overlap}</p>`;
      }).join('')+`<p><strong>High-tier sources by RAM cost:</strong> `+
        Object.entries(highTier.source_by_ram_cost).map(([cost,n])=>`<span class="pill">Cost ${esc(cost)}: ${n}</span>`).join('')+`</p>`+
        `<p class="hint">${highTier.persistent_cards} non-RAM persistents; ${highTier.script_cards} scripts. Source types: `+
        Object.entries(highTier.source_by_type).map(([type,n])=>`${n} ${esc(type.toLowerCase())}`).join(', ')+`.</p>`;
      // --- source-count lines above the curve chart ---
      $('sourceLines').innerHTML = tiers.map(tier => {
        const s = result.source_summary_by_tier[String(tier.tier)];
        const need = Object.entries(tier.faction_requirements).map(([f,n]) => `${n} ${f.toLowerCase()}`).join(' + ');
        const have = Object.entries(s.icons_by_faction).map(([f,n]) => `${n} ${f.toLowerCase()}`).join(', ');
        return `<p class="src-line"><b>Tier ${tier.tier}</b> needs <span class="req">${esc(need)} icons + ${tier.board_requirement} board</span> — deck carries <b>${esc(have)}</b> on ${s.source_cards} persistent sources (${pct(s.source_fraction)} of the deck).</p>`;
      }).join('');
      // --- cumulative curve chart: one chart, Going first / Going second toggle ---
      const curveHost = $('curveChart');
      const drawCurve = () => {
        curveHost.replaceChildren();
        const tall = curveHost.clientWidth > 0 && curveHost.clientWidth < 430;
        const w = tall ? 340 : 960, h = tall ? 430 : 400, l = tall ? 46 : 52, r = tall ? 16 : 84, t = 20, b = 46;
        const fs = 14;
        const fillAxis = '#E8ECF1', fillGrid = '#39424A', fillX = '#96A2AC';
        const sx = x => l + (x - 1) / Math.max(1, maxTurn - 1) * (w - l - r);
        const sy = y => t + (1 - y) * (h - t - b);
        const svg = svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img',
          'aria-label':`Cumulative probability each tier is online, by own turn, going ${positionView === 'first' ? 'first' : 'second'}`});
        for (const value of [0,.25,.5,.75,1]) {
          if (value) svg.append(svgNode('line',{x1:l,y1:sy(value),x2:w-r,y2:sy(value),stroke:fillGrid}));
          svg.append(svgNode('text',{x:l-9,y:sy(value)+5,'text-anchor':'end',fill:fillAxis,'font-size':fs},`${value*100}%`));
        }
        const stride = maxTurn > 16 ? 4 : maxTurn > 8 ? 2 : 1;
        for (let x = 1; x <= maxTurn; x += stride) {
          svg.append(svgNode('line',{x1:sx(x),y1:h-b,x2:sx(x),y2:h-b+6,stroke:fillGrid}));
          svg.append(svgNode('text',{x:sx(x),y:h-b+24,'text-anchor':'middle',fill:fillX,'font-size':fs},String(x)));
        }
        svg.append(svgNode('text',{x:l+22,y:h-4,'text-anchor':'start',fill:fillX,'font-size':fs},'Turn'));
        // Tier labels ride the lines (Tufte: label the data, skip the legend)
        for (const tier of tierNums) {
          const series = curves.filter(r2 => r2.tier === tier && r2.position === positionView).sort((a,b2) => a.turn - b2.turn);
          if (!series.length) continue;
          const parts = [`M ${sx(series[0].turn)} ${sy(series[0].probability)}`];
          for (let i = 1; i < series.length; i++)
            parts.push(`H ${sx(series[i].turn)} V ${sy(series[i].probability)}`);
          svg.append(svgNode('path',{d:parts.join(' '),fill:'none',stroke:colors[(tier-1)%colors.length],
            'stroke-width':2.5,'stroke-linejoin':'round'}));
          const last = series[series.length - 1], med = medianFirstHit(tier, positionView);
          const lx = sx(last.turn) + 9;
          svg.append(svgNode('text',{x:lx,y:sy(last.probability)+5,'text-anchor':'start',
            fill:colors[(tier-1)%colors.length],'font-size':fs+1,'font-weight':700},
            `Tier ${tier}${med !== null ? ' · ' + med : ''}`));
          for (const row of series)
            svg.append(svgNode('circle',{cx:sx(row.turn),cy:sy(row.probability),r:2.6,fill:colors[(tier-1)%colors.length]}));
        }
        const cross = svgNode('line',{x1:0,y1:t,x2:0,y2:h-b,stroke:'#F9FAFB','stroke-dasharray':'3 4',visibility:'hidden'});
        svg.append(cross);
        curveHost.append(svg);
        curveHost.style.position = 'relative';
        const tip = document.createElement('div');
        tip.className = 'chart-tip'; tip.style.display = 'none';
        curveHost.append(tip);
        svg.addEventListener('pointermove', event => {
          const rect = svg.getBoundingClientRect();
          const mx = (event.clientX - rect.left) * w / rect.width;
          const turn = Math.max(1, Math.min(maxTurn, Math.round(1 + (mx - l) / Math.max(1, w - l - r) * (maxTurn - 1))));
          cross.setAttribute('x1', sx(turn)); cross.setAttribute('x2', sx(turn));
          cross.setAttribute('visibility','visible');
          const rows = tierNums.map(tier => {
            const series = curves.filter(r2 => r2.tier === tier && r2.position === positionView);
            const row = series.find(x => x.turn === turn);
            if (!row) return '';
            const se = Math.sqrt(row.probability * (1 - row.probability) / row.trials);
            return `<div class="row"><span><span style="color:${colors[(tier-1)%colors.length]}">■</span> Tier ${tier}</span>`+
              `<span>${pct(row.probability)} <span class="dim">± ${(100 * se).toFixed(1)}%</span></span></div>`;
          }).join('');
          tip.innerHTML = `<b>Turn ${turn} · going ${positionView === 'first' ? 'first' : 'second'}</b>` + rows;
          tip.style.display = 'block';
          const hostRect = curveHost.getBoundingClientRect();
          let tx = event.clientX - hostRect.left + 14;
          if (tx + 230 > hostRect.width) tx -= 250;
          tip.style.left = Math.max(0, tx) + 'px';
          tip.style.top = Math.max(0, event.clientY - hostRect.top - 20) + 'px';
        });
        svg.addEventListener('pointerleave', () => {
          tip.style.display = 'none'; cross.setAttribute('visibility','hidden');
        });
      };
      drawCurve();
      chartRedraws.push(drawCurve);
      // --- position toggle (first / second only) ---
      let applyPositionView = () => {
        for (const b of document.querySelectorAll('#positionToggle button')) {
          const on = b.dataset.pos === positionView;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }
        drawCurve(); renderRam(); renderChips(); renderSplash();
      };
      for (const b of document.querySelectorAll('#positionToggle button'))
        b.addEventListener('click', () => { positionView = b.dataset.pos; applyPositionView(); });
      // --- dedicated splash section (only when a package was tracked) ---
      $('splashSection').hidden = !result.splash;
      const splashPayoffs = result.splash ? result.splash.payoffs : [];
      // The splash section has its own Going first / Going second toggle,
      // independent of the main chart's toggle above.
      let splashPositionView = 'first';
      const markSplashToggle = () => {
        for (const b of document.querySelectorAll('#splashToggle button')) {
          const on = b.dataset.pos === splashPositionView;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }
      };
      for (const b of document.querySelectorAll('#splashToggle button'))
        b.addEventListener('click', () => { splashPositionView = b.dataset.pos; markSplashToggle(); renderSplash(); });
      let maxThreshold = 1;
      let drawSplash = () => {};
      let renderSplash = () => {};
      if (result.splash) {
      markSplashToggle();
      $('splashTitle').textContent = `Splash — ${result.splash.factions.join(' + ').toLowerCase()} package`;
      const pkgEntries = result.deck_entries.filter(entry => {
        const card = catalog.cards.find(item => item.id === entry.card_id);
        return card && result.splash.factions.some(f => card.factions.includes(f)) && card.type !== 'MAINFRAME';
      });
      const splashCardCopies = pkgEntries.reduce((sum, entry) => sum + entry.copies, 0);
      // Splash variant of the composition section: what the package holds.
      const pkgStats = pkgEntries.reduce((acc, entry) => {
        const card = catalog.cards.find(item => item.id === entry.card_id);
        acc.persistent += card.persistent ? entry.copies : 0;
        acc.scripts += card.persistent ? 0 : entry.copies;
        acc.icons += entry.copies * card.factions.filter(f => result.splash.factions.includes(f)).length;
        return acc;
      }, { persistent: 0, scripts: 0, icons: 0 });
      const splashFactionWord = esc(result.splash.factions.map(f => f.toLowerCase()).join(' + '));
      $('composition').innerHTML += `<p><strong>Splash (${splashFactionWord}):</strong> ${splashCardCopies} copies — ` +
        `${pkgStats.persistent} persistent source${pkgStats.persistent === 1 ? '' : 's'}, ${pkgStats.scripts} script${pkgStats.scripts === 1 ? '' : 's'} — carrying ${pkgStats.icons} ` +
        `${esc(result.splash.factions.map(f => f.toLowerCase()).join('/'))} icon${pkgStats.icons === 1 ? '' : 's'}. Not counted in any tier's source list above.</p>`;
      $('splashLines').innerHTML = `<p class="src-line"><b>${result.splash.factions.map(f => f.toLowerCase()).join(' / ')}</b> off-plan for this Mainframe — `+
        `<b>${splashCardCopies}</b> copies in the deck (${pct(splashCardCopies / result.deck_size)}). `+
        `${splashPayoffs.length} payoff${splashPayoffs.length === 1 ? '' : 's'} tracked — each card's requirement and play odds are in the table under the turn chips.</p>`;
      drawSplash = () => {
        const host = $('splashChart');
        host.replaceChildren();
        if (!result.splash) return;
        const tall = host.clientWidth > 0 && host.clientWidth < 430;
        const w = tall ? 340 : 960, h = tall ? 430 : 400, l = tall ? 46 : 52, r = tall ? 16 : 96, t = 20, b = 46;
        const fs = 14;
        const fillAxis = '#E8ECF1', fillGrid = '#39424A', fillX = '#96A2AC';
        const sx = x => l + (x - 1) / Math.max(1, maxTurn - 1) * (w - l - r);
        const sy = y => t + (1 - y) * (h - t - b);
        const svg = svgNode('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img',
          'aria-label': 'Splash payoff play/online curves and board-icon supply by turn' });
        for (const value of [0, .25, .5, .75, 1]) {
          if (value) svg.append(svgNode('line', { x1: l, y1: sy(value), x2: w - r, y2: sy(value), stroke: fillGrid }));
          svg.append(svgNode('text', { x: l - 9, y: sy(value) + 5, 'text-anchor': 'end', fill: fillAxis, 'font-size': fs }, (value * 100) + '%'));
        }
        const stride = maxTurn > 16 ? 4 : maxTurn > 8 ? 2 : 1;
        for (let x = 1; x <= maxTurn; x += stride) {
          svg.append(svgNode('line', { x1: sx(x), y1: h - b, x2: sx(x), y2: h - b + 6, stroke: fillGrid }));
          svg.append(svgNode('text', { x: sx(x), y: h - b + 24, 'text-anchor': 'middle', fill: fillX, 'font-size': fs }, String(x)));
        }
        svg.append(svgNode('text', { x: l + 22, y: h - 4, 'text-anchor': 'start', fill: fillX, 'font-size': fs }, 'Turn'));
        // Resource context: share of games with enough icons on board (solid,
        // muted) — the supply line that explains late payoff curves.
        const iconRows = result.splash.icons[splashPositionView];
        const maxThreshold = Math.max(...splashPayoffs.map(p =>
          Math.max(...Object.values(p.requirement || { x: 1 }))));
        if (iconRows.length) {
          const parts = ['M ' + sx(iconRows[0].turn) + ' ' + sy(iconRows[0].at_least.find(a2 => a2.min_icons === maxThreshold)?.probability || 0)];
          for (const row of iconRows.slice(1))
            parts.push('H ' + sx(row.turn) + ' V ' + sy(row.at_least.find(a2 => a2.min_icons === maxThreshold)?.probability || 0));
          svg.append(svgNode('path', { d: parts.join(' '), fill: 'none', stroke: '#7B8992', 'stroke-width': 2 }));
          const last = iconRows[iconRows.length - 1];
          svg.append(svgNode('text', { x: sx(last.turn) + 9, y: sy(last.at_least.find(a2 => a2.min_icons === maxThreshold)?.probability || 0) + 5,
            'text-anchor': 'start', fill: '#7B8992', 'font-size': fs }, `board has ${maxThreshold}+ icons`));
        }
        // Payoff curves: dashed for scripts (played once), solid for persistents.
        splashPayoffs.forEach((payoff, index) => {
          const series = result.splash.curves.filter(r => r.card_id === payoff.card_id && r.position === splashPositionView)
            .sort((a2, b2) => a2.turn - b2.turn);
          if (!series.length) return;
          const color = colors[(index + 4) % colors.length];
          const parts = ['M ' + sx(series[0].turn) + ' ' + sy(series[0].probability)];
          for (let i = 1; i < series.length; i++)
            parts.push('H ' + sx(series[i].turn) + ' V ' + sy(series[i].probability));
          const attrs = { d: parts.join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' };
          if (!payoff.persistent) attrs['stroke-dasharray'] = '8 5';          svg.append(svgNode('path', attrs));
          const last = series[series.length - 1];
          svg.append(svgNode('text', { x: sx(last.turn) + 9, y: sy(last.probability) + 5, 'text-anchor': 'start',
            fill: color, 'font-size': fs + 1, 'font-weight': 700 },
            payoff.name + ' · ' + last.turn));
        });
        host.append(svg);
      };
      drawSplash();
      chartRedraws.push(drawSplash);
      renderSplash = () => {
        drawSplash();
        if (!result.splash) { $('splashChips').innerHTML = ''; $('splashTaxChips').innerHTML = ''; $('splashNote').textContent = ''; return; }
        const turn = Math.max(1, Math.min(maxTurn, Math.round(Number($('milestoneTurn').value) || 6)));
        $('splashChips').innerHTML = splashPayoffs.map(payoff => {
          const row = result.splash.curves.find(r => r.card_id === payoff.card_id && r.position === splashPositionView && r.turn === turn);
          if (!row) return '';
          const se = Math.sqrt(row.probability * (1 - row.probability) / row.trials);
          const color = colors[(splashPayoffs.indexOf(payoff) + 4) % colors.length];
          return '<div class="chip" title="' + esc(payoff.name) + ' ' + (payoff.persistent ? 'online' : 'played') +
            ' by turn ' + turn + ', going ' + splashPositionView + ': ' + pct(row.probability) + ' ± ' + (100 * se).toFixed(1) + '% (standard error)">' +
            '<span class="k">' + esc(payoff.name) + (payoff.persistent ? ' online' : ' played') + ' · turn ' + turn + ' · ' + splashPositionView + '</span>' +
            '<span class="v" style="color:' + color + '">' + pct(row.probability) + '</span>' +
            '<span class="sub">' + (payoff.persistent ? 'installed on board' : 'script, played once') + '</span></div>';
        }).join('') +
          (() => {
            const iconRow = result.splash.icons[splashPositionView].find(r => r.turn === turn);
            if (!iconRow) return '';
            return '<div class="chip"><span class="k">' + esc(result.splash.factions.join(' + ').toLowerCase()) +
              ' icons on board · turn ' + turn + ' · ' + splashPositionView + '</span>' +
              '<span class="v">' + iconRow.mean_icons.toFixed(1) + '</span>' +
              '<span class="sub">average; ' + pct(iconRow.at_least.find(a2 => a2.min_icons === maxThreshold)?.probability || 0) +
              ' of games reach ' + maxThreshold + '+</span></div>';
          })();
        // Splash tax: real deck vs neutral-filler swap at the same budget.
        const taxRows = result.splash.tax ? tiers.map(tier => {
          const base = curves.find(r => r.tier === tier.tier && r.position === splashPositionView && r.turn === turn);
          const neutral = result.splash.tax.curves.find(r => r.tier === tier.tier && r.position === splashPositionView && r.turn === turn);
          return { tier, base, neutral };
        }).filter(r => r.base && r.neutral) : [];
        $('splashTaxChips').innerHTML = taxRows.length ? taxRows.map(row => {
          const delta = (row.neutral.probability - row.base.probability) * 100;
          const verdict = delta <= 0.05 ? 'no cost' : 'costs ' + delta.toFixed(1) + 'pts';
          return '<div class="chip"><span class="k">splash tax · tier ' + row.tier.tier + ' · by turn ' + turn + ' · ' + splashPositionView + '</span>' +
            '<span class="v">' + (delta <= 0.05 ? '±0.0' : '+' + delta.toFixed(1)) + 'pts</span>' +
            '<span class="sub">tiers reach ' + pct(row.base.probability) + ' here vs ' + pct(row.neutral.probability) + ' without the package</span></div>';
        }).join('') : '';
        $('splashNote').textContent = 'Payoff curves are dashed for scripts (played once, then gone) and solid for persistents (installed). ' +
          'The gray supply line is the share of games whose board carried enough icons for the largest payoff. ' +
          'Tracking nudges the simulated player to deploy splash pieces, protects them in the opening-hand keep, and raises the auto RAM budget when a payoff needs the headroom. ' +
          'Splash tax compares this deck against the same deck with the package swapped for neutral fillers at the same RAM budget — ' +
          'it is what the package costs your tiers, not what it pays you back.';
      };
      }
      renderSplash();
      // --- milestone chips (F-1/S-1/F-2/S-2 … at a picked turn) ---
      function renderChips() {
        const turn = Math.max(1, Math.min(maxTurn, Math.round(Number($('milestoneTurn').value) || 6)));
        $('milestoneChips').innerHTML = tierNums.flatMap(tier => ['first','second'].map(pos => {
          const row = curves.find(x => x.tier === tier && x.position === pos && x.turn === turn);
          if (!row) return '';
          const posWord = pos === 'first' ? 'first' : 'second';
          const se = Math.sqrt(row.probability * (1 - row.probability) / row.trials);
          return `<div class="chip" title="Tier ${tier} by turn ${turn}, going ${pos}: ${pct(row.probability)} ± ${(100 * se).toFixed(1)}% (standard error), from ${row.trials.toLocaleString()} simulated games">`+
            `<span class="k">Tier ${tier} · turn ${turn} · ${posWord}</span>`+
            `<span class="v" style="color:${colors[(tier-1)%colors.length]}">${pct(row.probability)}</span>`+
            `<span class="ci">± ${(100 * se).toFixed(1)}%</span></div>`;
        })).join('');
      }
      $('milestoneTurn').addEventListener('input', renderChips);
      renderChips();
      // --- requirement table: every requirement-bearing card in the deck ---
      const reqRows = result.card_first_play || [];
      const reqNames = [...new Set(reqRows.map(r => r.name))].sort((a, b) => a.localeCompare(b));
      function renderReqTable() {
        const turn = Math.max(1, Math.min(maxTurn, Math.round(Number($('milestoneTurn').value) || 6)));
        const posWord = positionView === 'first' ? 'first' : 'second';
        if (!reqNames.length) { $('reqTable').innerHTML = '<p class="hint">No cards in this deck carry printed faction requirements.</p>'; return; }
        $('reqTable').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Card</th><th>Kind</th><th>Faction</th><th>Needs</th><th>Cost</th><th>Played/online by turn ${turn} (${posWord})</th></tr></thead><tbody>` +
          reqNames.map(name => {
            const r0 = reqRows.find(r => r.name === name);
            const row = reqRows.find(r => r.name === name && r.position === positionView && r.turn === turn);
            const need = Object.entries(r0.requirement || {}).map(([f, c]) => `${c} ${f.toLowerCase()}`).join(' + ');
            const faction = (r0.factions || []).map(f => f.toLowerCase()).join(' / ');
            return `<tr><td>${esc(name)}</td><td>${r0.persistent ? 'persistent' : 'script'}</td><td>${esc(faction)}</td><td>${esc(need)}</td><td>${r0.cost ?? '—'}</td>` +
              `<td>${row ? (row.probability ? pct(row.probability) : '0%') : '—'}</td></tr>`;
          }).join('') + '</tbody></table></div>' +
          '<p class="hint">Simulation odds at the turn picked above, going ' + posWord + '. ' +
          'Scripts are PLAYED (their effects are not simulated); persistents are INSTALLED and stay online. ' +
          'Curves per card live in the splash section only for tracked packages.</p>';
      }
      renderReqTable();
      $('milestoneTurn').addEventListener('input', renderReqTable);
      applyPositionView = (orig => () => { orig(); renderReqTable(); })(applyPositionView);
      // --- opening hand lines (exact hypergeometric mean/SD + exact qualify share) ---
      const N = result.deck_size, n = 5;
      $('handLines').innerHTML = tiers.map(tier => {
        const s = result.source_summary_by_tier[String(tier.tier)];
        const K = s.source_cards;
        const mean = n * K / N;
        const sd = Math.sqrt(n * (K/N) * (1 - K/N) * (N - n) / (N - 1));
        const joint = draw.find(r => r.tier === tier.tier && r.cards_seen === n);
        if (!joint) return '';
        const need = Object.entries(tier.faction_requirements).map(([f,c]) => `${c} ${f.toLowerCase()}`).join(' + ');
        return `<p class="hand-line"><b>Tier ${tier.tier}</b> — opening 5 holds <span class="big">${mean.toFixed(1)} ± ${sd.toFixed(1)}</span> of the ${K} qualifying sources `+
          `<span class="hint">(needs ${esc(need)} + ${tier.board_requirement} board)</span> — <span class="big">${pct(joint.joint_threshold_probability)}</span> of hands already qualify.</p>`;
      }).join('');
      if (result.splash) {
        // Splash variant of the opening-hand section: package pieces in a
        // random opening 5, exact hypergeometric math like the tier lines.
        // Derived from result.deck_entries so render() stays self-contained.
        const pkgDeck = result.deck_entries.flatMap(entry => {
          const card = catalog.cards.find(item => item.id === entry.card_id);
          return card && result.splash.factions.some(f => card.factions.includes(f)) && card.type !== 'MAINFRAME'
            ? Array(entry.copies).fill(card) : [];
        });
        if (pkgDeck.length) {
          const K = pkgDeck.length, mean = n * K / N, sd = Math.sqrt(n * (K/N) * (1 - K/N) * (N - n) / (N - 1));
          const pk = k => engine.choose(K, k) * engine.choose(N - K, n - k) / engine.choose(N, n);
          const pAny = 1 - pk(0);
          const splashWord = esc(result.splash.factions.map(f => f.toLowerCase()).join(' + '));
          $('handLines').innerHTML += `<p class="hand-line"><b>Splash (${splashWord})</b> — opening 5 holds <span class="big">${mean.toFixed(1)} ± ${sd.toFixed(1)}</span> package cards `+
            `<span class="hint">(${K} in the deck)</span> — <span class="big">${pct(pAny)}</span> of hands hold at least one.</p>`;
        }
      }
      // --- installed RAM when the synergy came online (one tier at a time) ---
      const ramData = result.ram_to_tier || null;
      const medianOf = bins => {
        const total = Object.values(bins).reduce((a, c) => a + c, 0);
        let cum = 0;
        for (const k of Object.keys(bins).map(Number).sort((a, b) => a - b)) {
          cum += bins[k];
          if (cum >= total / 2) return k;
        }
        return null;
      };
      let ramTierView = null;
      const splashRamData = result.splash_ram || null;
      $('ramTierToggle').innerHTML = tierNums.map(tier =>
        `<button type="button" data-tier="${tier}" aria-pressed="false">Tier ${tier}</button>`).join('') +
        ((splashRamData && (splashRamData.note_n.first + splashRamData.note_n.second) > 0) ?
          '<button type="button" data-tier="splash" aria-pressed="false">Splash</button>' : '');
      const markRamToggle = () => {
        for (const b of document.querySelectorAll('#ramTierToggle button')) {
          const on = String(b.dataset.tier) === String(ramTierView);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }
      };
      for (const b of document.querySelectorAll('#ramTierToggle button'))
        b.addEventListener('click', () => {
          ramTierView = b.dataset.tier === 'splash' ? 'splash' : Number(b.dataset.tier);
          markRamToggle();
          renderRam();
        });
      const renderRam = () => {
        const host = $('ramChart');
        host.replaceChildren();
        if (!ramData) { host.innerHTML = '<p class="hint">RAM telemetry unavailable for this run.</p>'; return; }
        const data = tierNums.map(tier => {
          const d = ramData[positionView][String(tier)];
          return d && d.installed_bins ? { tier, bins: d.installed_bins, n: d.n } : null;
        }).filter(Boolean);
        if (splashRamData) {
          const bins = splashRamData.installed_bins[positionView] || {};
          const n = Object.values(bins).reduce((a, c) => a + c, 0);
          if (n) data.push({ tier: 'splash', bins, n });
        }
        const toggle = $('ramTierToggle');
        if (!data.length) {
          toggle.hidden = true;
          $('ramNote').textContent = `No games reached any tier going ${positionView === 'first' ? 'first' : 'second'} in this configuration.`;
          return;
        }
        toggle.hidden = false;
        if (!data.some(d => d.tier === ramTierView)) ramTierView = data[0].tier;
        markRamToggle();
        const fillAxis = '#E8ECF1', fillGrid = '#39424A', fillX = '#96A2AC';
        const d = data.find(x => x.tier === ramTierView);
        const isSplashView = d.tier === 'splash';
        const color = isSplashView ? '#7B8992' : colors[(d.tier-1)%colors.length];
        const total = Object.values(d.bins).reduce((a, c) => a + c, 0);
        const shareOf = v => (d.bins[v] || 0) / total;
        const med = medianOf(d.bins);
        $('ramNote').textContent = isSplashView ?
          `How much RAM the simulated player had installed when the first splash payoff came online — going ${positionView === 'first' ? 'first' : 'second'} (n = ${d.n.toLocaleString()} of ${trials.toLocaleString()} games). Dashed line: typical (median) RAM${med !== null ? ' = ' + med : ''}. This describes the tracked package, not a tier.` :
          `How much RAM the simulated player had installed when Tier ${d.tier}'s synergy clicked — going ${positionView === 'first' ? 'first' : 'second'} (n = ${d.n.toLocaleString()} of ${trials.toLocaleString()} reaching games). Dashed line: typical (median) RAM${med !== null ? ' = ' + med : ''}. Bars far right = the tier waits on RAM installs; a late curve with bars far left = the tier waits on pieces.`;
        // Plot the full plausible range 0 → max observed, including empty
        // slots: gaps between spikes are real structure (those RAM values are
        // rarely held at click time), not missing data, so show them at zero.
        const maxRam = Math.max(...Object.keys(d.bins).map(Number));
        const minRam = 0;
        const tall = host.clientWidth > 0 && host.clientWidth < 430;
        const w = tall ? 340 : 960, h = tall ? 380 : 300, l = tall ? 60 : 66, r = tall ? 16 : 20, t = 20, b = 46, fs = 14;
        const slots = Math.max(1, maxRam - minRam + 1);
        const groupW = (w - l - r) / slots;
        const sx = v => l + (v - minRam) / slots * (w - l - r);
        const maxShare = Math.max(...Object.keys(d.bins).map(Number).map(shareOf));
        // Nice y ticks: the largest step that keeps ~5 or fewer gridlines.
        const yMaxRaw = Math.max(0.05, maxShare);
        const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find(s => yMaxRaw / s <= 5) || 1;
        const yMax = Math.min(1, Math.ceil(yMaxRaw / step - 1e-9) * step);
        const sy = y => t + (1 - y / yMax) * (h - t - b);
        const svg = svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':`Installed RAM when tier ${d.tier}'s synergy came online`});
        for (let v = 0; v <= yMax + 1e-9; v += step) {
          if (v) svg.append(svgNode('line',{x1:l,y1:sy(v),x2:w-r,y2:sy(v),stroke:fillGrid}));
          svg.append(svgNode('text',{x:l-9,y:sy(v)+5,'text-anchor':'end',fill:fillAxis,'font-size':fs},`${Math.round(v*100)}%`));
        }
        svg.append(svgNode('text',{x:14,y:(t+h-b)/2,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs,
          transform:`rotate(-90 14 ${(t+h-b)/2})`},'% of the tier\u2019s reaching games'));
        const stride = tall ? Math.ceil(slots / 9) : slots > 16 ? 2 : 1;
        for (let v = minRam; v <= maxRam; v += stride)
          svg.append(svgNode('text',{x:sx(v) + groupW/2,y:h-b+24,'text-anchor':'middle',fill:fillX,'font-size':fs},String(v)));
        svg.append(svgNode('text',{x:l-2,y:h-4,'text-anchor':'start',fill:fillX,'font-size':fs},'RAM'));
        for (let v = minRam; v <= maxRam; v++) {
          const count = d.bins[v] || 0;
          if (!count) continue;
          const share = shareOf(v);
          const x = sx(v) + 1, y = sy(share), bw = Math.max(3, groupW - 2);
          const rect = svgNode('rect',{x,y,width:bw,height:Math.max(0,h - b - y),fill:color,opacity:'.9'});
          svg.append(rect);
        }
        if (med !== null && med !== undefined) {
          const x = sx(med) + groupW/2;
          svg.append(svgNode('line',{x1:x,y1:t,x2:x,y2:h-b,stroke:color,'stroke-width':1.5,'stroke-dasharray':'4 3'}));
          svg.append(svgNode('text',{x:Math.min(w - r - 24, Math.max(l + 24, x)),y:t + 12,'text-anchor':'middle',fill:color,'font-size':fs,'font-weight':700},`typical ${med}`));
        }
        // Hover: highlight the bar under the pointer and show its values.
        const hover = svgNode('rect',{x:0,y:t,width:0,height:0,fill:'none',stroke:'#F9FAFB','stroke-width':1.5,visibility:'hidden'});
        svg.append(hover);
        host.append(svg);
        host.style.position = 'relative';
        const tip = document.createElement('div');
        tip.className = 'chart-tip'; tip.style.display = 'none';
        host.append(tip);
        svg.addEventListener('pointermove', event => {
          const rect = svg.getBoundingClientRect();
          const mx = (event.clientX - rect.left) * w / rect.width;
          const v = Math.min(maxRam, Math.max(minRam, minRam + Math.floor((mx - l) / groupW)));
          const count = d.bins[v] || 0;
          hover.setAttribute('x', sx(v) + 1); hover.setAttribute('width', Math.max(3, groupW - 2));
          hover.setAttribute('y', sy(count ? shareOf(v) : 0));
          hover.setAttribute('height', Math.max(0, h - b - sy(count ? shareOf(v) : 0)));
          hover.setAttribute('visibility', 'visible');
          tip.innerHTML = `<b style="color:${color}">${isSplashView ? 'Splash payoff' : 'Tier ' + d.tier} · ${v} installed RAM</b>` +
            `<div class="row"><span>Share of its reaching games</span><span>${pct(shareOf(v))} <span class="dim">(${count.toLocaleString()}/${total.toLocaleString()})</span></span></div>`;
          tip.style.display = 'block';
          const hostRect = host.getBoundingClientRect();
          let tx = event.clientX - hostRect.left + 14;
          if (tx + 230 > hostRect.width) tx -= 250;
          tip.style.left = Math.max(0, tx) + 'px';
          tip.style.top = Math.max(0, event.clientY - hostRect.top - 20) + 'px';
        });
        svg.addEventListener('pointerleave', () => {
          tip.style.display = 'none'; hover.setAttribute('visibility','hidden');
        });
      };
      renderRam();
      chartRedraws.push(renderRam);
      // --- force quit line ---
      if (result.force_quit) {
        const q = result.force_quit;
        $('quitLine').textContent = `Force quits: ${pct(q.first.share_trials_with_quit)} of games going first included a character force quit (mean ${q.first.mean_character_quits.toFixed(2)} per game); `+
          `${pct(q.second.share_trials_with_quit)} going second (mean ${q.second.mean_character_quits.toFixed(2)}). A quit removes the character and everything hosted on it — one reason curves can plateau below 100%.`;
      }
      // --- CSV download of the full turn table ---
      $('csvDownload').addEventListener('click', () => {
        if (!latest) return;
        const rows = [['tier','position','turn','probability','wilson_95_low','wilson_95_high','games_reached','trials']];
        for (const r of latest.curves)
          rows.push([r.tier, r.position, r.turn, r.probability.toFixed(6),
            r.wilson_95_low.toFixed(6), r.wilson_95_high.toFixed(6), r.reached_count, r.trials]);
        const blob=new Blob([rows.map(r => r.join(',')).join('\n')],{type:'text/csv'});
        const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;
        link.download=`${latest.mainframe.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-turn-table.csv`;
        link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      $('warnings').innerHTML = result.warnings.map(w=>`<div>${esc(w)}</div>`).join('');
      $('results').scrollIntoView({behavior:'smooth',block:'start'});
    }
    let resizeTimer = null;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { for (const redraw of chartRedraws) redraw(); }, 160);
    });
    let progressState = null;
    function status(p) {
      $('status').hidden=false;
      if (!progressState) progressState = { mainTotal:0, first:0, second:0 };
      const s = progressState;
      if (p.stage === 'pilot') {
        // Pilot games are a separate small phase; show them without a percent
        // so the bar never jumps backward when the main phase begins.
        $('phase').textContent = p.phase || 'Calculating';
        $('progressFill').style.width = '8%';
        $('progressText').textContent = `${p.completed} / ${p.total} pilot games`;
        return;
      }
      s.mainTotal = p.total;
      s[p.position] = p.completed;
      const done = s.first + s.second, total = 2 * s.mainTotal;
      const fraction = total ? Math.min(1, done / total) : 0;
      $('phase').textContent = p.phase || 'Calculating';
      $('progressFill').style.width = `${Math.round(100 * fraction)}%`;
      $('progressText').textContent = total > 1 ?
        `${done.toLocaleString()} / ${total.toLocaleString()} games${p.position === 'first' ? ' · going first' : ' · going second'} · ${Math.round(100 * fraction)}%` :
        'Exact combinatorial calculation';
    }
    function updateDeckCount() {
      currentParse = engine.parseDecklist($('decklist').value, catalog);
      const parsed = currentParse, box = $('deckCount');
      const validSize = parsed.deckCount >= 50 && parsed.deckCount <= 255;
      if (parsed.mainframe) $('mainframe').value = parsed.mainframe.name;
      box.classList.toggle('invalid', !!$('decklist').value.trim() && (!validSize || parsed.errors.length>0));
      const parts = [`${parsed.uniqueCount} unique cards`];
      if (parsed.mainframe) parts.push(`Mainframe detected: ${parsed.mainframe.name}`);
      if (parsed.sections.includes('sideboard')) parts.push(`Sideboard: ${parsed.sideboardCount}`);
      if (parsed.sections.includes('ram')) parts.push(`RAM: ${parsed.ramCount}`);
      if (parsed.errors.length) parts.push(parsed.errors[0]);
      else if ($('decklist').value.trim() && !validSize) parts.push('A legal Cyberdeck has 50–255 cards.');
      box.innerHTML=`<strong>${parsed.deckCount} cyberdeck ${parsed.deckCount===1?'card':'cards'}</strong>`+
        `<small>${esc(parts.join(' · '))}</small>`;
      $('analyze').disabled = !validSize || parsed.errors.length > 0;
      refreshSplashChoices();
    }
    // --- splash package detection: factions off-plan for this Mainframe ---
    function refreshSplashChoices() {
      const wrap = $('splashOptions'), host = $('splashChoices');
      if (!currentParse || !currentParse.deck || !catalog || currentParse.errors.length) {
        wrap.hidden = true; host.innerHTML = ''; return;
      }
      const mfName = $('mainframe').value.trim().toLowerCase();
      const mainframe = catalog.cards.find(card => card.type === 'MAINFRAME' && card.name.toLowerCase() === mfName)
        || catalog.cards.find(card => card.type === 'MAINFRAME' && card.name.toLowerCase().includes(mfName));
      if (!mainframe) { wrap.hidden = true; host.innerHTML = ''; return; }
      const tierFactions = new Set(mainframe.tiers.flatMap(tier => Object.keys(tier.faction_requirements)));
      const counts = {};
      for (const card of currentParse.deck) {
        if (card.type === 'MAINFRAME') continue;
        for (const faction of card.factions)
          if (!tierFactions.has(faction)) counts[faction] = (counts[faction] || 0) + 1;
      }
      const packages = Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
      if (!packages.length) { wrap.hidden = true; host.innerHTML = ''; return; }
      const payoffsByFaction = {};
      for (const card of currentParse.deck) {
        if (card.type === 'MAINFRAME' || !Object.keys(card.requirements || {}).length) continue;
        for (const faction of card.factions)
          if (counts[faction]) (payoffsByFaction[faction] = payoffsByFaction[faction] || new Set()).add(card.name);
      }
      wrap.hidden = false;
      const previous = new Set([...host.querySelectorAll('input:checked')].map(input => input.value));
      host.innerHTML = packages.map(([faction, n]) => {
        const payoffs = [...(payoffsByFaction[faction] || [])].sort();
        return `<label class="splash-choice"><input type="checkbox" value="${esc(faction)}" ${previous.has(faction) ? 'checked' : ''}>`+
          `<span><b>${esc(faction.toLowerCase())} splash · ${n} cards</b>`+
          `<span class="sub">${payoffs.length ? 'payoff potential: ' + esc(payoffs.join(', ')) : 'no requirement-bearing payoffs'}</span></span></label>`;
      }).join('');
    }
    const selectedSplashFactions = () => [...document.querySelectorAll('#splashChoices input:checked')].map(input => input.value);
    function showError(message) {$('inputError').hidden=false;$('inputError').textContent=message;}
    // --- Mainframe combobox: type-to-filter, ArrowUp/Down + Enter selection, Escape closes ---
    function initMainframeCombo(names) {
      const input=$('mainframe'), list=$('mainframeList');
      let open=false, filtered=names, active=-1;
      const close=()=>{open=false;list.hidden=true;input.setAttribute('aria-expanded','false');};
      const setActive=i=>{
        active=i;
        [...list.children].forEach((li,idx)=>li.setAttribute('aria-selected',String(idx===i)));
        if(i>=0&&list.children[i]){list.children[i].scrollIntoView({block:'nearest'});}
      };
      const choose=name=>{
        input.value=name;
        delete input.dataset.typed;
        close();
        updateDeckCount();
        refreshSplashChoices();
        input.focus();
        input.select();
      };
      const render=()=>{
        const q=input.dataset.typed?input.value.trim().toLowerCase():'';
        filtered=q?names.filter(n=>n.toLowerCase().includes(q)):names;
        active=-1;
        list.innerHTML=filtered.length
          ?filtered.map(n=>`<li role="option" aria-selected="false">${esc(n)}</li>`).join('')
          :'<li class="empty" role="option" aria-selected="false" aria-disabled="true">No Mainframe matches.</li>';
        list.hidden=false;
        open=true;
        input.setAttribute('aria-expanded','true');
      };
      input.addEventListener('input',()=>{input.dataset.typed='1';render();});
      // Click or focus with an untouched field shows the full list for browsing;
      // typing always filters.
      input.addEventListener('focus',()=>{if(!open&&!input.dataset.typed)render();});
      input.addEventListener('click',()=>{if(!open)render();});
      input.addEventListener('keydown',event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();
          if(!open)render();
          else{
            const count=list.children.length, empty=list.querySelector('.empty');
            const usable=empty?0:count;
            if(!usable)return;
            active=active<0?(event.key==='ArrowDown'?0:usable-1)
              :Math.min(usable-1,Math.max(0,active+(event.key==='ArrowDown'?1:-1)));
            setActive(active);
          }
        } else if(event.key==='Enter'){
          event.preventDefault();
          if(open&&active>=0&&filtered[active])choose(filtered[active]);
          else if(open&&filtered.length===1)choose(filtered[0]);
          else close();
        } else if(event.key==='Escape'&&open){
          event.stopPropagation();
          close();
        } else if(event.key==='Tab'&&open) close();
      });
      list.addEventListener('mousedown',event=>{
        const li=event.target.closest('li');
        if(li&&!li.classList.contains('empty')){event.preventDefault();choose(li.textContent);}
      });
      input.addEventListener('blur',()=>setTimeout(()=>{if(open)close();},120));
    }
    $('analyze').addEventListener('click',async()=>{
      $('inputError').hidden=true; $('analyze').disabled=true; $('results').hidden=true;
      $('placeholder').hidden=true; $('status').hidden=false; progressState = null;
      $('phase').textContent='Validating decklist'; $('progressFill').style.width='0%'; $('progressText').textContent='';
      try {
        updateDeckCount();
        const turns = Math.max(1, Math.min(40, Math.round(Number($('turns').value) || 6)));
        const wanted=$('mainframe').value.trim().toLowerCase();
        const mainframe=catalog.cards.find(card=>card.type==='MAINFRAME'&&card.name.toLowerCase()===wanted)
          || catalog.cards.find(card=>card.type==='MAINFRAME'&&card.name.toLowerCase().includes(wanted));
        const result=await engine.analyze(currentParse,mainframe,
          {trials:5000,turns,ram_target:$('ramTarget').value,
          splash_factions:selectedSplashFactions()},status);
        render(result);
      } catch(error) {$('status').hidden=true;showError(error.message);}
      updateDeckCount();
    });
    // One import button: a pasted link imports from the web; an empty field
    // opens the file picker instead.
    $('importLink').addEventListener('click',()=>{
      const url=$('decklink').value.trim();
      if (url) importDeckLink(url);
      else $('deckfile').click();
    });
    $('deckfile').addEventListener('change',async event=>{const file=event.target.files?.[0];
      if(!file)return;
      $('fileError').hidden=true;
      try {
        const text=await file.text();
        $('decklist').value=text;
        updateDeckCount();
      } catch(error) {
        $('fileError').hidden=false;
        $('fileError').textContent=`Could not read ${file.name}. The previous decklist was preserved.`;
      } finally {
        event.target.value='';
      }
    });
    function fetchWithTimeout(target, ms) {
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(), ms);
      return fetch(target,{redirect:'follow',signal:controller.signal}).finally(()=>clearTimeout(timer));
    }
    async function importDeckLink(rawUrl) {
      $('fileError').hidden=true;
      const trimmed=rawUrl.trim();
      let url;
      try { url=new URL(trimmed); } catch { url=null; }
      if (!url || !/^https?:$/.test(url.protocol)) {
        $('fileError').hidden=false;
        $('fileError').textContent='Enter a full https:// link to a decklist.';
        return;
      }
      const deckMatch=engine.AZUNIVERSE_DECK_URL.exec(trimmed);
      const apiUrl=deckMatch ? `https://azuniverse.net/api/decks/${deckMatch[2]}` : null;
      // azuniverse.net sends no CORS header, so browser imports race the direct
      // API against relays in parallel; the fastest healthy source wins.
      const targets=apiUrl ? [
        ['azuniverse.net', apiUrl],
        ['r.jina.ai', `https://r.jina.ai/${apiUrl}`],
        ['allorigins', `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`],
        ['cors.lol', `https://api.cors.lol/?url=${encodeURIComponent(apiUrl)}`]
      ] : [[new URL(trimmed).host, trimmed]];
      const button=$('importLink');
      button.disabled=true;
      const original=button.textContent;
      button.textContent='Importing…';
      const attempts=[];
      try {
        const deckText=await Promise.any(targets.map(async ([name,target])=>{
          const started=Date.now();
          try {
            const response=await fetchWithTimeout(target,15000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text=await response.text();
            const converted=deckMatch ? engine.decklistFromAzuniverse(text) : text;
            if (!converted.trim()) throw new Error('empty response');
            attempts.push(`${name} won in ${Date.now()-started}ms`);
            return converted;
          } catch (error) {
            attempts.push(`${name}: ${error.name==='AbortError' ? 'timed out' : (error.message||'blocked')}`);
            throw error;
          }
        }));
        $('decklist').value=deckText;
        $('decklink').value='';
        updateDeckCount();
      } catch (error) {
        const first=error && error.errors && error.errors[0];
        const detail=(first || error || {}).message || '';
        $('fileError').textContent=/not a readable deck|did not contain|no Cyberdeck/i.test(detail) ?
          `Could not import that link. ${detail}` :
          `Could not import that link. Tried: ${attempts.join('; ')}. You can download the deck file and press Import to choose it, or paste the list directly.`;
      } finally {
        button.disabled=false;
        button.textContent=original;
      }
    }
    $('importLink').addEventListener('click',()=>$('decklink').value.trim() && importDeckLink($('decklink').value));
    $('decklink').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('decklink').value.trim() && importDeckLink($('decklink').value);}});
    $('decklist').addEventListener('input',updateDeckCount);
    $('example').addEventListener('click',()=>{$('mainframe').value=catalog.example_mainframe;
      $('decklist').value=catalog.example_decklist;$('inputError').hidden=true;$('fileError').hidden=true;updateDeckCount();});
    $('download').addEventListener('click',()=>{if(!latest)return;
      const blob=new Blob([JSON.stringify(latest,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;
      link.download=`${latest.mainframe.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${latest.deck_size}-synergy.json`;
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    for (const button of document.querySelectorAll('.info-button')) {
      const wrap=button.closest('.info-wrap');
      button.addEventListener('click',event=>{
        event.stopPropagation();
        document.querySelectorAll('.info-wrap.open').forEach(item=>{item.classList.remove('open');item.querySelector('.info-button').setAttribute('aria-expanded','false');});
        wrap.classList.add('open');button.setAttribute('aria-expanded','true');
      });
      button.addEventListener('focus',()=>{
        document.querySelectorAll('.info-wrap.open').forEach(item=>{if(item!==wrap){item.classList.remove('open');item.querySelector('.info-button').setAttribute('aria-expanded','false');}});
        wrap.classList.add('open');button.setAttribute('aria-expanded','true');
      });
      wrap.addEventListener('focusout',()=>setTimeout(()=>{
        if(!wrap.contains(document.activeElement)){wrap.classList.remove('open');button.setAttribute('aria-expanded','false');}
      },0));
    }
    document.addEventListener('click',()=>document.querySelectorAll('.info-wrap.open').forEach(item=>{item.classList.remove('open');item.querySelector('.info-button').setAttribute('aria-expanded','false');}));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.info-wrap.open').forEach(item=>{item.classList.remove('open');item.querySelector('.info-button').setAttribute('aria-expanded','false');});});
    if (!catalog || !engine) showError('The local catalog or calculator script did not load. Keep index.html, catalog.js, engine.js, app.js, and the assets folder together.');
    else {
      const mainframes=catalog.cards.filter(card=>card.type==='MAINFRAME').map(card=>card.name);
      initMainframeCombo(mainframes);
      $('mainframe').value=catalog.example_mainframe;
      updateDeckCount();
    }
