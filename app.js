    const $ = id => document.getElementById(id);
    const colors = ['#24C8A5','#E25C8D','#F4B942','#8B7CF6','#56B4E9','#F0785A'];
    const lineStyles = ['', '8 5', '2 4', '', '8 5', '2 4'];
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
    function chart(hostId, rows, xKey, yKey, xMin, xMax, xLabel) {
      const host = $(hostId); host.replaceChildren();
      const w = 570, h = 345, l = 53, r = 14, t = 18, b = 45;
      const sx = x => l + (x - xMin) / Math.max(1, xMax - xMin) * (w - l - r);
      const sy = y => t + (1 - y) * (h - t - b);
      const svg = svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img',
        'aria-label':`${xLabel} synergy probability chart`});
      for (const value of [0,.25,.5,.75,1]) {
        svg.append(svgNode('line',{x1:l,y1:sy(value),x2:w-r,y2:sy(value),stroke:'#4B565E'}));
        svg.append(svgNode('text',{x:l-8,y:sy(value)+4,'text-anchor':'end',fill:'#BCC4D0','font-size':12},`${value*100}%`));
      }
      const ticks = xLabel === 'Own turn' ? [1,3,5,8,10,12,16,20].filter(x=>x>=xMin&&x<=xMax)
        : [5,8,12,16,20].filter(x=>x>=xMin&&x<=xMax);
      for (const value of ticks) {
        svg.append(svgNode('line',{x1:sx(value),y1:h-b,x2:sx(value),y2:h-b+5,stroke:'#7B8992'}));
        svg.append(svgNode('text',{x:sx(value),y:h-b+21,'text-anchor':'middle',fill:'#BCC4D0','font-size':12},String(value)));
      }
      svg.append(svgNode('text',{x:(l+w-r)/2,y:h-5,'text-anchor':'middle',fill:'#BCC4D0','font-size':12},xLabel));
      const tiers = [...new Set(rows.map(row=>row.tier))].sort((a,b)=>a-b);
      for (const [index,tier] of tiers.entries()) {
        const points = rows.filter(row=>row.tier===tier).sort((a,b)=>a[xKey]-b[xKey]);
        if (!points.length) continue;
        const parts = [`M ${sx(points[0][xKey])} ${sy(points[0][yKey])}`];
        for (let i=1;i<points.length;i++) {
          parts.push(`H ${sx(points[i][xKey])} V ${sy(points[i][yKey])}`);
        }
        svg.append(svgNode('path',{d:parts.join(' '),fill:'none',stroke:colors[index%colors.length],
          'stroke-width':3,'stroke-linejoin':'round','stroke-dasharray':lineStyles[index%lineStyles.length]}));
        for (const point of points) svg.append(svgNode('circle',{cx:sx(point[xKey]),cy:sy(point[yKey]),r:2.6,
          fill:colors[index%colors.length]}));
      }
      host.append(svg);
    }
    function legend(hostId, tiers) {
      $(hostId).innerHTML = tiers.map((tier,i)=>`<span><svg viewBox="0 0 38 8" aria-hidden="true"><line x1="1" y1="4" x2="37" y2="4" stroke="${colors[i%colors.length]}" stroke-width="3" stroke-dasharray="${lineStyles[i%lineStyles.length]}"/></svg>Tier ${tier.tier}: ${tier.board_requirement} board; ${Object.entries(tier.faction_requirements).map(([f,n])=>`${n} ${f}`).join(' + ')}</span>`).join('');
    }
    function table(headers, rows) {
      return `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`+
        rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
    }
    function render(result) {
      latest = result; $('placeholder').hidden = true; $('status').hidden = true; $('results').hidden = false;
      const mf = result.mainframe, tiers = mf.tiers, curves = result.curves, draw = result.draw_only;
      $('resultTitle').textContent = `${mf.name} · ${result.deck_size} cards`;
      $('resultSubtitle').textContent = `${result.settings.trials_per_position.toLocaleString()} trials per position · ${result.settings.turns} own turns · RAM target ${result.settings.ram_target} (${result.settings.ram_target_selection})`;
      const high = tiers.at(-1), source = result.source_summary_by_tier[String(high.tier)];
      $('stats').innerHTML = `<div class="stat"><b>${result.deck_size}</b><small>Cyberdeck cards</small></div>`+
        `<div class="stat"><b>${source.source_cards}</b><small>High-tier faction sources</small></div>`+
        `<div class="stat"><b>${pct(source.source_fraction)}</b><small>Source density</small></div>`+
        `<div class="stat"><b>${result.settings.ram_target}</b><small>Selected RAM target</small></div>`;
      chart('firstChart',curves.filter(r=>r.position==='first'),'turn','probability',1,result.settings.turns,'Own turn');
      chart('secondChart',curves.filter(r=>r.position==='second'),'turn','probability',1,result.settings.turns,'Own turn');
      chart('factionChart',draw,'cards_seen','faction_only_probability',5,20,'Random cards seen');
      chart('jointChart',draw,'cards_seen','joint_threshold_probability',5,20,'Random cards seen');
      legend('turnLegend',tiers); legend('drawLegend',tiers);
      $('drawRelationship').textContent=draw.every(row=>Math.abs(row.faction_only_probability-row.joint_threshold_probability)<1e-12) ?
        'The exact panels coincide for this deck: seeing the required persistent faction sources already supplies the printed board count.' :
        'The gap between these panels is the extra printed board-count constraint in a random sample.';
      const milestones = [3,5,8,12,20].filter(x=>x<=result.settings.turns);
      $('milestoneTable').innerHTML = table(['Tier','Position',...milestones.map(t=>`Turn ${t}`)],
        tiers.flatMap(tier=>['first','second'].map(position=>[
          `Tier ${tier.tier}`,position[0].toUpperCase()+position.slice(1),
          ...milestones.map(turn=>{const row=curves.find(r=>r.tier===tier.tier&&r.position===position&&r.turn===turn);
            return `${pct(row.probability)} (${pct(row.wilson_95_low)}–${pct(row.wilson_95_high)})`;})])));
      const samples=[5,8,12,20];
      $('drawTable').innerHTML = table(['Tier','Condition',...samples.map(h=>`${h} cards seen`)],
        tiers.flatMap(tier=>[
          [`Tier ${tier.tier}`,'Faction icons',...samples.map(h=>pct(draw.find(r=>r.tier===tier.tier&&r.cards_seen===h).faction_only_probability))],
          [`Tier ${tier.tier}`,'Full printed threshold',...samples.map(h=>pct(draw.find(r=>r.tier===tier.tier&&r.cards_seen===h).joint_threshold_probability))]
        ]));
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
    function status(p) {
      $('status').hidden=false; $('phase').textContent=p.phase || 'Calculating';
      const fraction=p.total ? Math.min(1,p.completed/p.total) : 0;
      $('progressFill').style.width=`${Math.round(100*fraction)}%`;
      $('progressText').textContent=p.total>1 ?
        `${p.completed || 0} / ${p.total} simulations · ${Math.round(100*fraction)}%` :
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
          {trials:Number($('trials').value),turns:Number($('turns').value),ram_target:$('ramTarget').value},status);
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
