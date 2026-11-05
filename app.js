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
    const lineStyles = ['', '8 5', '2 4', '', '8 5', '2 4'];
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
      $('resultSubtitle').textContent = `n = ${trials.toLocaleString()} simulated games per position · max turn ${maxTurn} · RAM budget ${result.settings.ram_target} (${result.settings.ram_target_selection})`;
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
        const w = tall ? 340 : 960, h = tall ? 430 : 380, l = tall ? 47 : 58, r = tall ? 16 : 96, t = 16, b = 46;
        const fs = tall ? 13 : 12;
        const sx = x => l + (x - 1) / Math.max(1, maxTurn - 1) * (w - l - r);
        const sy = y => t + (1 - y) * (h - t - b);
        const svg = svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img',
          'aria-label':`Cumulative probability each tier is online, by own turn, going ${positionView === 'first' ? 'first' : 'second'}`});
        for (const value of [0,.25,.5,.75,1]) {
          svg.append(svgNode('line',{x1:l,y1:sy(value),x2:w-r,y2:sy(value),stroke:'#4B565E'}));
          svg.append(svgNode('text',{x:l-8,y:sy(value)+4,'text-anchor':'end',fill:'#BCC4D0','font-size':fs},`${value*100}%`));
        }
        const stride = maxTurn > 16 ? 4 : maxTurn > 8 ? 2 : 1;
        for (let x = 1; x <= maxTurn; x += stride) {
          svg.append(svgNode('line',{x1:sx(x),y1:h-b,x2:sx(x),y2:h-b+5,stroke:'#7B8992'}));
          svg.append(svgNode('text',{x:sx(x),y:h-b+21,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs},String(x)));
        }
        svg.append(svgNode('text',{x:(l+w-r)/2,y:h-5,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs},'Own turn'));
        const tipRows = [];
        for (const tier of tierNums) {
          const series = curves.filter(r2 => r2.tier === tier && r2.position === positionView).sort((a,b2) => a.turn - b2.turn);
          if (!series.length) continue;
          const parts = [`M ${sx(series[0].turn)} ${sy(series[0].probability)}`];
          for (let i = 1; i < series.length; i++)
            parts.push(`H ${sx(series[i].turn)} V ${sy(series[i].probability)}`);
          const pathAttrs = {d:parts.join(' '),fill:'none',stroke:colors[(tier-1)%colors.length],
            'stroke-width':3,'stroke-linejoin':'round'};
          const dash = lineStyles[(tier-1)%lineStyles.length];
          if (dash) pathAttrs['stroke-dasharray'] = dash;
          svg.append(svgNode('path',pathAttrs));
          if (!tall) {
            const last = series[series.length - 1], med = medianFirstHit(tier, positionView);
            svg.append(svgNode('text',{x:sx(last.turn)+8,y:sy(last.probability)+4,'text-anchor':'start',
              fill:colors[(tier-1)%colors.length],'font-size':fs+0.5,'font-weight':700},
              `T${tier}${med !== null ? ' · med ' + med : ''}`));
          }
          for (const row of series)
            svg.append(svgNode('circle',{cx:sx(row.turn),cy:sy(row.probability),r:2.6,fill:colors[(tier-1)%colors.length]}));
          tipRows.push({ tier, series });
        }
        const cross = svgNode('line',{x1:0,y1:t,x2:0,y2:h-b,stroke:'#7B8992','stroke-dasharray':'3 3',visibility:'hidden'});
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
          tip.innerHTML = `<b>Turn ${turn} · going ${positionView === 'first' ? 'first' : 'second'}</b>` +
            tipRows.map(({tier, series}) => {
              const row = series.find(x => x.turn === turn);
              return `<div class="row"><span><span style="color:${colors[(tier-1)%colors.length]}">■</span> Tier ${tier}</span>`+
                `<span>${pct(row.probability)} <span class="dim">(${pct(row.wilson_95_low)}–${pct(row.wilson_95_high)})</span></span></div>`;
            }).join('');
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
      const applyPositionView = () => {
        for (const b of document.querySelectorAll('#positionToggle button')) {
          const on = b.dataset.pos === positionView;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }
        drawCurve(); renderRam(); renderChips();
      };
      for (const b of document.querySelectorAll('#positionToggle button'))
        b.addEventListener('click', () => { positionView = b.dataset.pos; applyPositionView(); });
      // --- milestone chips (F-1/S-1/F-2/S-2 … at a picked turn) ---
      function renderChips() {
        const turn = Math.max(1, Math.min(maxTurn, Math.round(Number($('milestoneTurn').value) || 6)));
        $('milestoneChips').innerHTML = tierNums.flatMap(tier => ['first','second'].map(pos => {
          const row = curves.find(x => x.tier === tier && x.position === pos && x.turn === turn);
          if (!row) return '';
          const key = (pos === 'first' ? 'F' : 'S') + '-' + tier;
          const name = pos === 'first' ? 'first' : 'second';
          return `<div class="chip" title="Tier ${tier} by turn ${turn}, going ${name}: ${pct(row.probability)} — Wilson 95% range ${pct(row.wilson_95_low)}–${pct(row.wilson_95_high)}, from ${row.trials.toLocaleString()} simulated games">`+
            `<span class="k">${key} · by turn ${turn}</span>`+
            `<span class="v" style="color:${colors[(tier-1)%colors.length]}">${pct(row.probability)}</span>`+
            `<span class="ci">${pct(row.wilson_95_low)}–${pct(row.wilson_95_high)}</span></div>`;
        })).join('');
      }
      $('milestoneTurn').addEventListener('input', renderChips);
      renderChips();
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
      // --- RAM-at-click histogram ---
      const ramData = result.ram_to_tier || null;
      const renderRam = () => {
        const host = $('ramChart');
        host.replaceChildren();
        if (!ramData) { host.innerHTML = '<p class="hint">RAM telemetry unavailable for this run.</p>'; return; }
        const data = tierNums.map(tier => ({ tier, bins: ramData[positionView][String(tier)] && ramData[positionView][String(tier)].installed_bins }))
          .filter(d => d.bins);
        const ns = tierNums.map(tier => {
          const d = ramData[positionView][String(tier)];
          return d ? `Tier ${tier}: n = ${d.n.toLocaleString()} of ${trials.toLocaleString()} games` : `Tier ${tier}: never reached`;
        }).join(' · ');
        $('ramNote').textContent = `Share of the games that reached each tier, by how much RAM the simulated player had installed at the moment the tier clicked — going ${positionView === 'first' ? 'first' : 'second'} (${ns}). Bars are conditioned on reaching; a long right tail means the tier usually waits on expensive pieces.`;
        if (!data.length) { host.innerHTML = '<p class="hint">No games reached any tier in this configuration.</p>'; return; }
        const maxRam = Math.max(...data.flatMap(d => Object.keys(d.bins).map(Number)));
        const minRam = Math.min(...data.flatMap(d => Object.keys(d.bins).map(Number)));
        const tall = host.clientWidth > 0 && host.clientWidth < 430;
        const w = tall ? 340 : 960, h = tall ? 380 : 300, l = tall ? 47 : 58, r = tall ? 16 : 20, t = 18, b = 46, fs = tall ? 13 : 12;
        const sx = v => l + (v - minRam) / Math.max(1, maxRam - minRam + 1) * (w - l - r);
        const totals = {};
        for (const d of data) totals[d.tier] = Object.values(d.bins).reduce((a,c) => a + c, 0);
        const maxShare = Math.max(...data.flatMap(d => Object.entries(d.bins).map(([v,c]) => c / totals[d.tier])));
        const yMax = Math.min(1, Math.ceil(maxShare * 10) / 10 + 1e-9);
        const sy = y => t + (1 - y / yMax) * (h - t - b);
        const svg = svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':'Installed RAM when each tier first came online'});
        for (const v of [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].filter(v => v <= yMax + 1e-9)) {
          svg.append(svgNode('line',{x1:l,y1:sy(v),x2:w-r,y2:sy(v),stroke:'#4B565E'}));
          svg.append(svgNode('text',{x:l-8,y:sy(v)+4,'text-anchor':'end',fill:'#BCC4D0','font-size':fs},`${Math.round(v*100)}%`));
        }
        const groupW = (w - l - r) / (maxRam - minRam + 1);
        const barW = Math.max(6, groupW / (data.length + 1));
        for (let v = minRam; v <= maxRam; v++) {
          svg.append(svgNode('text',{x:sx(v) + groupW/2,y:h-b+21,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs},String(v)));
          data.forEach((d, i) => {
            const count = d.bins[v] || 0;
            const share = count / totals[d.tier];
            const x = sx(v) + groupW/2 + (i - data.length/2 + .5) * barW;
            const y = sy(share);
            const rect = svgNode('rect',{x:x - barW/2 + 1,y:y,width:Math.max(1,barW - 2),height:Math.max(0,h - b - y),
              fill:colors[(d.tier-1)%colors.length],opacity:'.9'});
            rect.append(svgNode('title',{},`Tier ${d.tier} · ${v} installed RAM: ${pct(share)} of reaching games (${count}/${totals[d.tier]})`));
            svg.append(rect);
          });
        }
        svg.append(svgNode('text',{x:(l+w-r)/2,y:h-5,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs},'Installed RAM at the moment the tier clicked'));
        svg.append(svgNode('text',{x:14,y:t+8,'text-anchor':'start',fill:'#BCC4D0','font-size':fs},'% of games reaching the tier'));
        host.append(svg);
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
      if (parsed.mainframe) $('mainframe').value = parsed.mainframe.name;
      const validSize = parsed.deckCount >= 50 && parsed.deckCount <= 255;
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
    }
    function showError(message) {$('inputError').hidden=false;$('inputError').textContent=message;}
    $('analyze').addEventListener('click',async()=>{
      $('inputError').hidden=true; $('analyze').disabled=true; $('results').hidden=true;
      $('placeholder').hidden=true; $('status').hidden=false; progressState = null;
      $('phase').textContent='Validating decklist'; $('progressFill').style.width='0%'; $('progressText').textContent='';
      try {
        updateDeckCount();
        const mainframe=catalog.cards.find(card=>card.type==='MAINFRAME'&&card.name===$('mainframe').value);
        const result=await engine.analyze(currentParse,mainframe,
          {trials:5000,turns:Number($('turns').value),ram_target:$('ramTarget').value},status);
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
      $('mainframe').innerHTML=catalog.cards.filter(card=>card.type==='MAINFRAME')
        .map(card=>`<option value="${esc(card.name)}">${esc(card.name)}</option>`).join('');
      $('mainframe').value=catalog.example_mainframe;
      updateDeckCount();
    }
