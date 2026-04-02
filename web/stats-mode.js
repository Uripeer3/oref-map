(function() {
  'use strict';

  function initStatsMode() {
    var A = window.AppState;
    if (!A) return;

    var statsBtn = document.getElementById('stats-btn');
    var statsBtnRow = document.getElementById('stats-btn-row');
    var fromInput = document.getElementById('stats-from-date');
    var toInput = document.getElementById('stats-to-date');
    var typeSelect = document.getElementById('stats-type-select');
    var applyBtn = document.getElementById('stats-apply-btn');
    var clearBtn = document.getElementById('stats-clear-btn');
    var summaryEl = document.getElementById('stats-summary');
    var resultsEl = document.getElementById('stats-results');
    if (!statsBtn || !statsBtnRow || !fromInput || !toInput || !typeSelect || !applyBtn || !clearBtn || !summaryEl || !resultsEl) {
      return;
    }

    var DATE_MIN = '2026-02-28';
    var typesLoadToken = 0;
    var applyToken = 0;
    var histogramToken = 0;
    var statsOverlay = null;
    var currentQuery = null;

    function todayIsraelDate() {
      return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    }

    function addDays(dateStr, days) {
      var d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function(ch) {
        if (ch === '&') return '&amp;';
        if (ch === '<') return '&lt;';
        if (ch === '>') return '&gt;';
        if (ch === '"') return '&quot;';
        return '&#39;';
      });
    }

    function setSummary(text, isError) {
      summaryEl.style.color = isError ? '#b91c1c' : '#334155';
      summaryEl.textContent = text || '';
    }

    function setLoading(btn, loading) {
      btn.disabled = !!loading;
      btn.style.opacity = loading ? '0.65' : '';
      btn.style.cursor = loading ? 'default' : 'pointer';
    }

    function normalizeDateRange() {
      var today = todayIsraelDate();
      fromInput.min = DATE_MIN;
      toInput.min = DATE_MIN;
      fromInput.max = today;
      toInput.max = today;

      if (!fromInput.value) fromInput.value = addDays(today, -7);
      if (!toInput.value) toInput.value = today;

      if (fromInput.value < DATE_MIN) fromInput.value = DATE_MIN;
      if (toInput.value < DATE_MIN) toInput.value = DATE_MIN;
      if (fromInput.value > today) fromInput.value = today;
      if (toInput.value > today) toInput.value = today;
      if (fromInput.value > toInput.value) fromInput.value = toInput.value;

      return {
        from: fromInput.value,
        to: toInput.value,
      };
    }

    function closePanel() {
      statsBtn.classList.remove('open');
      clearOverlay();
      A.map.closePopup();
      if (typeof A.refreshOverlay === 'function') A.refreshOverlay();
    }

    function openPanel() {
      if (typeof window.closeTimelinePanel === 'function') {
        window.closeTimelinePanel();
      }
      A.map.closePopup();
      statsBtn.classList.add('open');
      if (typeof A.refreshOverlay === 'function') A.refreshOverlay();
      loadAlertTypes();
    }

    function fetchJson(url) {
      return fetch(url).then(function(resp) {
        return resp.text().then(function(text) {
          var json = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch (e) {
            json = {};
          }
          if (!resp.ok) {
            throw new Error((json && json.error) || ('HTTP ' + resp.status));
          }
          return json;
        });
      });
    }

    function clearOverlay() {
      if (statsOverlay) {
        A.map.removeLayer(statsOverlay);
        statsOverlay = null;
      }
      currentQuery = null;
      histogramToken++;
    }

    function colorForRatio(ratio) {
      var clamped = Math.max(0, Math.min(1, ratio));
      var hue = 58 - (58 * clamped); // yellow -> red
      return 'hsl(' + hue + ', 92%, 52%)';
    }

    function buildResults(counts) {
      if (!counts || counts.length === 0) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px;">\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05dc\u05d8\u05d5\u05d5\u05d7 \u05e9\u05e0\u05d1\u05d7\u05e8.</div>';
        return;
      }

      var rows = counts.slice(0, 200).map(function(item, idx) {
        return (
          '<div class="stats-result-row" data-loc="' + escapeHtml(item.polygon) + '">' +
            '<span class="stats-result-index">' + (idx + 1) + '.</span>' +
            '<span class="stats-result-name">' + escapeHtml(item.polygon) + '</span>' +
            '<span class="stats-result-count">' + item.count + '</span>' +
          '</div>'
        );
      }).join('');

      if (counts.length > 200) {
        rows += '<div style="padding:8px;color:#64748b;font-size:12px;">\u05de\u05d5\u05e6\u05d2\u05d9\u05dd 200 \u05e8\u05d0\u05e9\u05d5\u05e0\u05d9\u05dd \u05de\u05ea\u05d5\u05da ' + counts.length + '.</div>';
      }

      resultsEl.innerHTML = rows;
    }

    function rebuildTypeOptions(titles, previousValue) {
      typeSelect.innerHTML = '';

      var allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = '\u05d4\u05db\u05dc';
      typeSelect.appendChild(allOpt);

      for (var i = 0; i < titles.length; i++) {
        var opt = document.createElement('option');
        opt.value = titles[i];
        opt.textContent = titles[i];
        typeSelect.appendChild(opt);
      }

      if (previousValue && titles.indexOf(previousValue) >= 0) {
        typeSelect.value = previousValue;
      } else {
        typeSelect.value = '';
      }
    }

    function loadAlertTypes() {
      var range = normalizeDateRange();
      var token = ++typesLoadToken;
      var previousValue = typeSelect.value;
      setLoading(applyBtn, true);
      typeSelect.disabled = true;
      setSummary('\u05d8\u05d5\u05e2\u05df \u05e1\u05d5\u05d2\u05d9 \u05d4\u05ea\u05e8\u05e2\u05d4...', false);

      fetchJson('/api/alert-types?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to))
        .then(function(data) {
          if (token !== typesLoadToken) return;
          var titles = (data.types || []).map(function(row) { return row.title; });
          rebuildTypeOptions(titles, previousValue);
          setSummary('\u05d6\u05d5\u05d4\u05d5 ' + titles.length + ' \u05e1\u05d5\u05d2\u05d9 \u05d4\u05ea\u05e8\u05e2\u05d4 \u05d1\u05d8\u05d5\u05d5\u05d7 \u05d4\u05e0\u05d1\u05d7\u05e8.', false);
        })
        .catch(function(error) {
          if (token !== typesLoadToken) return;
          rebuildTypeOptions([], '');
          setSummary(error.message || '\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d8\u05e2\u05d9\u05e0\u05ea \u05e1\u05d5\u05d2\u05d9 \u05d4\u05ea\u05e8\u05e2\u05d4.', true);
        })
        .finally(function() {
          if (token !== typesLoadToken) return;
          typeSelect.disabled = false;
          setLoading(applyBtn, false);
        });
    }

    function buildHistogramHtml(locationName, data, selectedType) {
      var hourBuckets = Array.isArray(data.hourBuckets) ? data.hourBuckets : [];
      var minuteBuckets = Array.isArray(data.minuteBuckets) ? data.minuteBuckets : [];
      var maxHourBucket = Number(data.maxHourBucket || 0);
      var maxMinuteBucket = Number(data.maxMinuteBucket || 0);
      var total = Number(data.totalAlerts || 0);

      var hourRows = '';
      for (var h = 0; h < 24; h++) {
        var count = Number(hourBuckets[h] || 0);
        var width = maxHourBucket > 0 ? Math.round((count / maxHourBucket) * 100) : 0;
        if (count > 0 && width < 8) width = 8;
        hourRows += '<div style="display:flex;align-items:center;gap:8px;direction:ltr;margin:3px 0;">' +
          '<span style="width:42px;font-size:11px;color:#555;text-align:left;">' + String(h).padStart(2, '0') + ':00</span>' +
          '<div style="flex:1;height:10px;background:#f1f5f9;border-radius:999px;overflow:hidden;">' +
          (count > 0 ? '<span style="display:block;height:100%;width:' + width + '%;background:#f59e0b;"></span>' : '') +
          '</div>' +
          '<span style="width:24px;font-size:11px;color:#111;text-align:right;">' + count + '</span>' +
          '</div>';
      }

      var minuteBars = '';
      for (var m = 0; m < 60; m++) {
        var minuteCount = Number(minuteBuckets[m] || 0);
        var height = maxMinuteBucket > 0 ? Math.round((minuteCount / maxMinuteBucket) * 34) : 2;
        if (minuteCount > 0 && height < 2) height = 2;
        if (height < 2) height = 2;
        var minuteColor = minuteCount > 0 ? '#3b82f6' : '#e5e7eb';
        minuteBars += '<span title="' + String(m).padStart(2, '0') + ' - ' + minuteCount + '" style="display:block;width:100%;height:' + height + 'px;background:' + minuteColor + ';border-radius:2px;"></span>';
      }

      var minuteHistogramHtml =
        '<div style="margin-top:10px;font-size:12px;color:#333;">\u05e4\u05d9\u05dc\u05d5\u05d7 \u05d4\u05ea\u05e8\u05e2\u05d5\u05ea \u05dc\u05e4\u05d9 \u05d3\u05e7\u05d4 \u05d1\u05e9\u05e2\u05d4 (00-59)</div>' +
        '<div style="margin-top:4px;border:1px solid #e5e7eb;border-radius:6px;padding:6px;">' +
          '<div style="display:grid;grid-template-columns:repeat(60,minmax(0,1fr));column-gap:1px;align-items:end;height:36px;direction:ltr;">' + minuteBars + '</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:#666;direction:ltr;margin-top:4px;">' +
            '<span>00</span><span>15</span><span>30</span><span>45</span><span>59</span>' +
          '</div>' +
        '</div>';

      var selectedTypeLabel = selectedType || '\u05d4\u05db\u05dc';
      var bodyHtml = total === 0
        ? '<div style="margin-top:8px;font-size:12px;color:#888;">\u05d0\u05d9\u05df \u05d4\u05ea\u05e8\u05e2\u05d5\u05ea \u05dc\u05d9\u05d9\u05e9\u05d5\u05d1 \u05d1\u05d8\u05d5\u05d5\u05d7 \u05e9\u05e0\u05d1\u05d7\u05e8.</div>'
        : '<div style="margin-top:8px;font-size:12px;color:#333;">\u05e4\u05d9\u05dc\u05d5\u05d7 \u05d4\u05ea\u05e8\u05e2\u05d5\u05ea \u05dc\u05e4\u05d9 \u05e9\u05e2\u05d4</div><div style="margin-top:4px;">' + hourRows + '</div>' + minuteHistogramHtml;

      return '<div style="direction:rtl;width:min(430px,88vw);text-align:right;">' +
        '<b>' + escapeHtml(locationName) + '</b>' +
        '<div style="margin-top:4px;font-size:12px;color:#555;">\u05e1\u05d5\u05d2 \u05d4\u05ea\u05e8\u05e2\u05d4: ' + escapeHtml(selectedTypeLabel) + '</div>' +
        '<div style="margin-top:4px;font-size:13px;color:#111;font-weight:bold;">\u05e1\u05d4\u05f4\u05db \u05d4\u05ea\u05e8\u05e2\u05d5\u05ea: ' + total + '</div>' +
        bodyHtml +
      '</div>';
    }

    function showHistogramPopup(locationName, latlng) {
      if (!currentQuery) return;
      var selectedType = currentQuery.type || '';
      var popup = L.popup({ maxWidth: 460 })
        .setLatLng(latlng)
        .setContent('<div style="direction:rtl;text-align:right;padding:4px 0;">\u05d8\u05d5\u05e2\u05df \u05e4\u05d9\u05dc\u05d5\u05d7 \u05d1\u05e9\u05d1\u05d9\u05dc ' + escapeHtml(locationName) + '...</div>')
        .openOn(A.map);

      var token = ++histogramToken;
      var histUrl = '/api/polygon-histogram?from=' + encodeURIComponent(currentQuery.from) +
        '&to=' + encodeURIComponent(currentQuery.to) +
        '&polygon=' + encodeURIComponent(locationName);
      if (selectedType) histUrl += '&type=' + encodeURIComponent(selectedType);

      fetchJson(histUrl)
        .then(function(data) {
          if (token !== histogramToken) return;
          popup.setContent(buildHistogramHtml(locationName, data, selectedType));
        })
        .catch(function(error) {
          if (token !== histogramToken) return;
          popup.setContent('<div style="direction:rtl;text-align:right;color:#b91c1c;">' + escapeHtml(error.message || '\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d8\u05e2\u05d9\u05e0\u05ea \u05e0\u05ea\u05d5\u05e0\u05d9 \u05e4\u05d9\u05dc\u05d5\u05d7.') + '</div>');
        });
    }

    function applyOverlay(counts) {
      clearOverlay();
      if (!counts || counts.length === 0) return;

      var maxCount = 0;
      for (var i = 0; i < counts.length; i++) {
        if (counts[i].count > maxCount) maxCount = counts[i].count;
      }
      if (maxCount <= 0) return;

      statsOverlay = L.layerGroup();
      for (var j = 0; j < counts.length; j++) {
        var item = counts[j];
        var srcPoly = A.locationPolygons[item.polygon];
        if (!srcPoly) continue;

        var ratio = item.count / maxCount;
        var fillColor = colorForRatio(ratio);
        var fillOpacity = 0.15 + (0.65 * ratio);

        var overlayPoly = L.polygon(srcPoly.getLatLngs(), {
          color: fillColor,
          fillColor: fillColor,
          fillOpacity: fillOpacity,
          opacity: Math.min(0.95, fillOpacity + 0.2),
          weight: ratio > 0.7 ? 1.4 : 1,
          interactive: true,
          bubblingMouseEvents: false,
        });
        overlayPoly.bindTooltip('<b>' + escapeHtml(item.polygon) + '</b><br>\u05d4\u05ea\u05e8\u05e2\u05d5\u05ea: ' + item.count, {
          direction: 'top',
          offset: [0, -20],
        });
        (function(locName) {
          overlayPoly.on('click', function(e) {
            showHistogramPopup(locName, e.latlng);
          });
        })(item.polygon);
        overlayPoly.addTo(statsOverlay);
      }

      statsOverlay.addTo(A.map);
    }

    function runStats() {
      var range = normalizeDateRange();
      var token = ++applyToken;
      currentQuery = {
        from: range.from,
        to: range.to,
        type: typeSelect.value || '',
      };

      setLoading(applyBtn, true);
      setSummary('\u05d8\u05d5\u05e2\u05df \u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4...', false);
      A.map.closePopup();

      var countsUrl = '/api/polygon-counts?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to);
      if (currentQuery.type) {
        countsUrl += '&type=' + encodeURIComponent(currentQuery.type);
      }

      fetchJson(countsUrl)
        .then(function(data) {
          if (token !== applyToken) return;
          var typeLabel = currentQuery.type || '\u05d4\u05db\u05dc';
          setSummary(
            '\u05e0\u05de\u05e6\u05d0\u05d5 ' + data.totalAlerts + ' \u05d4\u05ea\u05e8\u05e2\u05d5\u05ea \u05d1-' +
            data.uniquePolygons + ' \u05e4\u05d5\u05dc\u05d9\u05d2\u05d5\u05e0\u05d9\u05dd (\u05e1\u05d5\u05d2: ' + typeLabel + ').'
          );
          buildResults(data.counts || []);
          applyOverlay(data.counts || []);
          A.showToast('\u05de\u05e6\u05d1 \u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4 \u05e4\u05e2\u05d9\u05dc');
        })
        .catch(function(error) {
          if (token !== applyToken) return;
          clearOverlay();
          resultsEl.innerHTML = '';
          setSummary(error.message || '\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d8\u05e2\u05d9\u05e0\u05ea \u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4.', true);
        })
        .finally(function() {
          if (token !== applyToken) return;
          setLoading(applyBtn, false);
        });
    }

    statsBtnRow.addEventListener('click', function(e) {
      if (e.target.classList.contains('tl-close')) {
        closePanel();
        return;
      }
      if (statsBtn.classList.contains('open')) return;
      openPanel();
    });

    fromInput.addEventListener('change', loadAlertTypes);
    toInput.addEventListener('change', loadAlertTypes);

    applyBtn.addEventListener('click', function(e) {
      e.preventDefault();
      runStats();
    });

    clearBtn.addEventListener('click', function(e) {
      e.preventDefault();
      clearOverlay();
      resultsEl.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px;">\u05d1\u05d7\u05e8\u05d5 \u05d8\u05d5\u05d5\u05d7 \u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd \u05d5\u05e1\u05d5\u05d2 \u05d4\u05ea\u05e8\u05e2\u05d4, \u05d5\u05dc\u05d7\u05e6\u05d5 \u05d4\u05e6\u05d2 \u05e2\u05dc \u05d4\u05de\u05e4\u05d4.</div>';
      setSummary('\u05de\u05e6\u05d1 \u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4 \u05e0\u05d5\u05e7\u05d4.', false);
      A.showToast('\u05d7\u05d6\u05e8\u05d4 \u05dc\u05ea\u05e6\u05d5\u05d2\u05d4 \u05d7\u05d9\u05d4');
    });

    resultsEl.addEventListener('click', function(e) {
      var row = e.target.closest('.stats-result-row');
      if (!row) return;
      var name = row.getAttribute('data-loc');
      if (!name) return;
      var srcPoly = A.locationPolygons[name];
      if (!srcPoly) return;
      var center = srcPoly.getBounds().getCenter();
      showHistogramPopup(name, center);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && statsBtn.classList.contains('open')) {
        closePanel();
      }
    });

    window.closeStatsModePanel = closePanel;

    normalizeDateRange();
    resultsEl.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px;">\u05d1\u05d7\u05e8\u05d5 \u05d8\u05d5\u05d5\u05d7 \u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd \u05d5\u05e1\u05d5\u05d2 \u05d4\u05ea\u05e8\u05e2\u05d4, \u05d5\u05dc\u05d7\u05e6\u05d5 \u05d4\u05e6\u05d2 \u05e2\u05dc \u05d4\u05de\u05e4\u05d4.</div>';
  }

  if (window.AppState) {
    initStatsMode();
  } else {
    document.addEventListener('app:ready', initStatsMode);
  }
})();
