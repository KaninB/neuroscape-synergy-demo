    const $ = id => document.getElementById(id);
    const colors = ['#24C8A5','#E25C8D','#F4B942','#8B7CF6','#56B4E9','#F0785A'];
    const lineStyles = ['', '8 5', '2 4', '', '8 5', '2 4'];
    const TURN_LANDMARKS = [1,2,3,4,5,6,8,10,12,16,20,24,28,32,36,40];
    const SEEN_LANDMARKS = [5,6,8,10,12,15,20];
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
    function chart(hostId, rows, xKey, yKey, xMin, xMax, xLabel, seriesLabel) {
      const host = $(hostId); host.style.position = 'relative';
      const drawChart = () => {
        host.replaceChildren();
        const tall = host.clientWidth > 0 && host.clientWidth < 430;
        const w = tall ? 340 : 570, h = tall ? 430 : 345, l = tall ? 47 : 53, r = 14, t = 18, b = 45, fs = tall ? 13 : 12;
        const sx = x => l + (x - xMin) / Math.max(1, xMax - xMin) * (w - l - r);
        const sy = y => t + (1 - y) * (h - t - b);
        const svg = svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img',
          'aria-label':`${xLabel} synergy probability chart`});
        for (const value of [0,.25,.5,.75,1]) {
          svg.append(svgNode('line',{x1:l,y1:sy(value),x2:w-r,y2:sy(value),stroke:'#4B565E'}));
          svg.append(svgNode('text',{x:l-8,y:sy(value)+4,'text-anchor':'end',fill:'#BCC4D0','font-size':fs},`${value*100}%`));
        }
        const stride = xLabel === 'Own turn' ? (xMax > 16 ? 4 : xMax > 8 ? 2 : 1) : 5;
        const ticks = [];
        for (let x = xMin; x <= xMax; x += stride) ticks.push(x);
        if (ticks[ticks.length-1] !== xMax && xMax - ticks[ticks.length-1] < stride/2) ticks[ticks.length-1] = xMax;
        for (const value of ticks) {
          svg.append(svgNode('line',{x1:sx(value),y1:h-b,x2:sx(value),y2:h-b+5,stroke:'#7B8992'}));
          svg.append(svgNode('text',{x:sx(value),y:h-b+21,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs},String(value)));
        }
        svg.append(svgNode('text',{x:(l+w-r)/2,y:h-5,'text-anchor':'middle',fill:'#BCC4D0','font-size':fs},xLabel));
        const ordered = rows.slice().sort((a,b)=>a[xKey]-b[xKey]);
        const points = [];
        for (const tier of [...new Set(ordered.map(row=>row.tier))].sort((a,b)=>a-b)) {
          const color = colors[(tier-1)%colors.length];
          const series = ordered.filter(row=>row.tier===tier);
          if (!series.length) continue;
          const parts = [`M ${sx(series[0][xKey])} ${sy(series[0][yKey])}`];
          for (let i=1;i<series.length;i++) parts.push(`H ${sx(series[i][xKey])} V ${sy(series[i][yKey])}`);
          svg.append(svgNode('path',{d:parts.join(' '),fill:'none',stroke:color,
            'stroke-width':3,'stroke-linejoin':'round'}));
          for (const row of series) {
            const circle = svgNode('circle',{cx:sx(row[xKey]),cy:sy(row[yKey]),r:2.6,fill:color});
            svg.append(circle);
            points.push({px:sx(row[xKey]),py:sy(row[yKey]),x:row[xKey],y:row[yKey],circle,label:seriesLabel(row)});
          }
        }
        host.append(svg);
        const tip = document.createElement('div');
        tip.className = 'chart-tip';
        tip.style.display = 'none';
        host.append(tip);
        svg.addEventListener('pointermove', event => {
          const rect = svg.getBoundingClientRect();
          const mx = (event.clientX - rect.left) * w / rect.width;
          const my = (event.clientY - rect.top) * h / rect.height;
          let best = null, bestD = Infinity;
          for (const p of points) {
            const d = (p.px - mx) ** 2 + (p.py - my) ** 2;
            if (d < bestD) { bestD = d; best = p; }
          }
          if (!best) return;
          for (const p of points) p.circle.setAttribute('r', p === best ? 5.4 : 2.6);
          tip.innerHTML = `<b>${esc(best.label)}</b><br>${esc(xLabel)} ${best.x}: ${pct(best.y)}`;
          tip.style.display = 'block';
          const hostRect = host.getBoundingClientRect();
          let tx = event.clientX - hostRect.left + 13;
          if (tx + 190 > hostRect.width) tx -= 210;
          tip.style.left = Math.max(0, tx) + 'px';
          tip.style.top = Math.max(0, event.clientY - hostRect.top - 14) + 'px';
        });
        svg.addEventListener('pointerleave', () => {
          tip.style.display = 'none';
          for (const p of points) p.circle.setAttribute('r', 2.6);
        });
      };
      drawChart();
      chartRedraws.push(drawChart);
    }
    function legend(hostId, tiers) {
      $(hostId).innerHTML = tiers.map((tier,i)=>`<span><svg viewBox="0 0 38 8" aria-hidden="true"><line x1="1" y1="4" x2="37" y2="4" stroke="${colors[i%colors.length]}" stroke-width="3" stroke-dasharray="${lineStyles[i%lineStyles.length]}"/></svg><b>T${tier.tier}</b> = Tier ${tier.tier} · ${tier.board_requirement} board; ${Object.entries(tier.faction_requirements).map(([f,n])=>`${n} ${f}`).join(' + ')}</span>`).join('')+
        `<span><b>1st / 2nd</b> = going first / going second</span>`;
    }
    function table(headers, rows) {
      const cell = value => {
        if (value !== null && typeof value === 'object' && 'html' in value)
          return value.picked ? `<td class="picked">${value.html}</td>` : `<td>${value.html}</td>`;
        return `<td>${esc(value)}</td>`;
      };
      const header = h => h !== null && typeof h === 'object' && 'html' in h ? h.html : esc(h);
      return `<table><thead><tr>${headers.map(header).join('')}</tr></thead><tbody>`+
        rows.map(row=>{
          const cls = row && row.rowClass ? ` class="${esc(row.rowClass)}"` : '';
          const cells = row && row.cells ? row.cells : row;
          return `<tr${cls}>${cells.map(cell).join('')}</tr>`;
        }).join('')+'</tbody></table>';
    }
    function render(result) {
      latest = result; $('placeholder').hidden = true; $('status').hidden = true; $('results').hidden = false;
      const mf = result.mainframe, tiers = mf.tiers, curves = result.curves, draw = result.draw_only;
      $('resultTitle').textContent = `${mf.name} · ${result.deck_size} cards`;
      $('resultSubtitle').textContent = `n = ${result.settings.trials_per_position.toLocaleString()} simulated games per position · max turn ${result.settings.turns} · RAM budget ${result.settings.ram_target} (${result.settings.ram_target_selection})`;
      const high = tiers.at(-1), source = result.source_summary_by_tier[String(high.tier)];
      $('stats').innerHTML = `<div class="stat"><b>${result.deck_size}</b><small>Cyberdeck cards</small></div>`+
        `<div class="stat"><b>${source.source_cards}</b><small>High-tier faction sources</small></div>`+
        `<div class="stat"><b>${pct(source.source_fraction)}</b><small>Source density</small></div>`+
        `<div class="stat"><b>${result.settings.ram_target}</b><small>Selected RAM target</small></div>`;
      chart('firstChart',curves.filter(r=>r.position==='first'),'turn','probability',1,result.settings.turns,'Own turn',
        row=>`Tier ${row.tier} · going first`);
      chart('secondChart',curves.filter(r=>r.position==='second'),'turn','probability',1,result.settings.turns,'Own turn',
        row=>`Tier ${row.tier} · going second`);
      chart('factionChart',draw,'cards_seen','faction_only_probability',5,20,'Random cards seen',
        row=>`Tier ${row.tier} · faction icons present`);
      chart('jointChart',draw,'cards_seen','joint_threshold_probability',5,20,'Random cards seen',
        row=>`Tier ${row.tier} · icons + board count`);
      legend('turnLegend',tiers); legend('drawLegend',tiers);
      $('drawRelationship').textContent=draw.every(row=>Math.abs(row.faction_only_probability-row.joint_threshold_probability)<1e-12) ?
        'The exact panels coincide for this deck: seeing the required persistent faction sources already supplies the printed board count.' :
        'The gap between these panels is the extra printed board-count constraint in a random sample.';
      function medianFirstHit(tier, position) {
        const rows = curves.filter(r => r.tier === tier && r.position === position).sort((a,b) => a.turn - b.turn);
        const firstTurns = [];
        let previous = 0;
        for (const r of rows) {
          if (r.reached_count > previous) firstTurns.push(...Array(r.reached_count - previous).fill(r.turn));
          previous = Math.max(previous, r.reached_count);
        }
        return firstTurns.length ? firstTurns[Math.floor((firstTurns.length - 1) / 2)] : '—';
      }
      let positionView = 'both';
      const applyPositionView = () => {
        $('firstBox').hidden = positionView === 'second';
        $('secondBox').hidden = positionView === 'first';
        for (const b of document.querySelectorAll('#positionToggle button')) {
          const on = b.dataset.pos === positionView;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }
        requestAnimationFrame(() => { for (const redraw of chartRedraws) redraw(); });
      };
      for (const b of document.querySelectorAll('#positionToggle button'))
        b.addEventListener('click', () => { positionView = b.dataset.pos; applyPositionView(); });
      function renderMilestones() {
        const value = Math.max(1, Math.round(Number($('milestoneTurn').value) || 8));
        const shown = Math.min(value, result.settings.turns);
        const landmarkTurns = TURN_LANDMARKS.filter(t => t <= result.settings.turns && t !== shown);
        const turns = [...landmarkTurns, shown].sort((a,b) => a-b);
        const mark = (row, picked) => row ?
          {html:`<b>${pct(row.probability)}</b><span class="ci">${pct(row.wilson_95_low)}–${pct(row.wilson_95_high)}</span>`, picked} :
          {html:'<span class="dim">—</span>', picked};
        const cellsOf = (tier, position) => [
          {html:`<span class="swatch" style="background:${colors[(tier.tier-1)%colors.length]}"></span><b>T${tier.tier}</b> <span class="hint">${position === 'first' ? '1st' : '2nd'}</span>`},
          ...turns.map(t => mark(curves.find(r => r.tier === tier.tier && r.position === position && r.turn === t), t === shown)),
          {html:`turn ${medianFirstHit(tier.tier, position)}`}
        ];
        $('milestoneTable').innerHTML = table(
          [{html:'<span class="tierkey">Tier · position</span>'},
            ...turns.map(t => ({html:t === shown ? `<span class="picked">t=${t} ▾</span>` : `t=${t}`})),
            {html:'<span class="tierkey">Typical</span>'}],
          tiers.flatMap(tier => ['first','second'].map(position => ({
            rowClass: position === 'first' ? 'pos-first' : 'pos-second',
            cells: cellsOf(tier, position)
          }))));
      }
      $('milestoneTurn').addEventListener('input', renderMilestones);
      renderMilestones();
      function renderDraw() {
        const value = Math.max(5, Math.min(20, Math.round(Number($('cardsSeen').value) || 12)));
        const seen = [...SEEN_LANDMARKS.filter(h => h !== value), value].sort((a,b) => a-b);
        const mark = (v, tip, picked) => ({html:`<span title="${tip}"><b>${pct(v)}</b></span>`, picked});
        const cell = (tier, key, h) => h === value ?
          mark(draw.find(r => r.tier === tier.tier && r.cards_seen === h)[key], `${key === 'faction_only_probability' ? 'Faction icons present' : 'Faction icons + board count'} (your pick)`, true) :
          mark(draw.find(r => r.tier === tier.tier && r.cards_seen === h)[key], key === 'faction_only_probability' ? 'Faction icons present' : 'Faction icons + board count', false);
        $('drawTable').innerHTML = table(
          [{html:'<span class="tierkey">Tier · condition</span>'},
            ...seen.map(h => ({html:h === value ? `<span class="picked">${h} seen ▾</span>` : `${h} seen`})),
            {html:'<span class="tierkey">Condition</span>'}],
          tiers.flatMap(tier => [
            {cells: [
              {html:`<span class="swatch" style="background:${colors[(tier.tier-1)%colors.length]}"></span><b>T${tier.tier}</b> <span class="hint">icons</span>`},
              ...seen.map(h => cell(tier, 'faction_only_probability', h)),
              {html:'faction icons present'}
            ], rowClass: 'pos-first'},
            {cells: [
              {html:`<span class="swatch" style="background:${colors[(tier.tier-1)%colors.length]}"></span><b>T${tier.tier}</b> <span class="hint">full</span>`},
              ...seen.map(h => cell(tier, 'joint_threshold_probability', h)),
              {html:'icons + board count'}
            ], rowClass: 'pos-second'}
          ]));
      }
      $('cardsSeen').addEventListener('input', renderDraw);
      renderDraw();
      $('sourceSummary').innerHTML = tiers.map(tier=>{const s=result.source_summary_by_tier[String(tier.tier)];
        const overlap=Object.keys(tier.faction_requirements).length>1 ?
          ` ${s.multi_required_faction_sources} cards carry both required factions.` : '';
        return `<p><strong>Tier ${tier.tier}:</strong> ${s.source_cards} qualifying persistent cards (${pct(s.source_fraction)} of the deck); `+
          `${Object.entries(s.icons_by_faction).map(([f,n])=>`${n} ${esc(f)} icons`).join(', ')}.${overlap}</p>`;
      }).join('')+`<p><strong>High-tier sources by RAM cost:</strong> `+
        Object.entries(source.source_by_ram_cost).map(([cost,n])=>`<span class="pill">Cost ${esc(cost)}: ${n}</span>`).join('')+`</p>`+
        `<p class="hint">${source.persistent_cards} non-RAM persistents; ${source.script_cards} scripts. Source types: `+
        Object.entries(source.source_by_type).map(([type,n])=>`${n} ${esc(type.toLowerCase())}`).join(', ')+`.</p>`;
      $('warnings').innerHTML = result.warnings.map(w=>`<div>${esc(w)}</div>`).join('');
      $('results').scrollIntoView({behavior:'smooth',block:'start'});
    }
    let resizeTimer = null;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { for (const redraw of chartRedraws) redraw(); }, 160);
    });
    function status(p) {
      $('status').hidden=false; $('phase').textContent=p.phase || 'Calculating';
      const fraction=p.total ? Math.min(1,p.completed/p.total) : 0;
      $('progressFill').style.width=`${Math.round(100*fraction)}%`;
      const where=p.position==='first' ? ' · going first' : p.position==='second' ? ' · going second' : '';
      $('progressText').textContent=p.total>1 ?
        `${p.completed || 0} / ${p.total.toLocaleString()} ${p.stage==='pilot' ? 'pilot games' : 'games'}${where} · ${Math.round(100*fraction)}%` :
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
      $('placeholder').hidden=true; $('status').hidden=false;
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
          `Could not import that link. Tried: ${attempts.join('; ')}. You can download the deck file and use Choose file, or paste the list directly.`;
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
