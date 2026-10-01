'use client';

import { useMemo, useState } from 'react';
import data from '../data/dashboard-data.json';
import computed from '../data/hesi-computed.json';

type V = {
  name: string;
  block: string;
  baseline: number;
  weight: number;
  sign: 1 | -1;
  status: string;
  methodClass: string;
  note: string;
};

const vars = data.hsi.variables as V[];

const registry = data.registry.map((r) => [
  r.feature,
  r.domain,
  r.class,
  r.status,
  r.evidence
]);

const forecasts = data.experiments.map((r) => [
  r.horizon,
  r.marketRF,
  r.marketEventRF,
  r.scope
]);

const calc = (x: number[]) =>
  Math.max(
    0,
    Math.min(
      100,
      data.hsi.neutralReference +
        vars.reduce(
          (s, v, i) =>
            s +
            (x[i] - data.hsi.neutralReference) *
              v.weight *
              v.sign,
          0
        )
    )
  );

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function Page() {
  const base = vars.map((v) => v.baseline);

  const [sc, setSc] = useState(base);

  const [tab, setTab] = useState<
    'overview' | 'scenario' | 'registry'
  >('overview');

  const b = useMemo(
    () => calc(base),
    []
  );

  const s = useMemo(
    () => calc(sc),
    [sc]
  );

  const d = s - b;

  const interp =
    s < 25
      ? 'Low stress'
      : s < 50
        ? 'Moderate-low stress'
        : s < 75
          ? 'Moderate-high stress'
          : 'Extreme stress';

  const liveMarketStress =
    computed.marketStressExperimental;

  const brentValue =
    computed.inputs.brent.value;

  const cftcNet =
    computed.inputs.cftc.managedMoneyNet;

  const physicalStatus =
    computed.physicalStress.status;

  const physicalComputable =
    computed.physicalStress
      .physicalStressExperimental !== null;

  const effectiveComputable =
    computed.hesiEffectiveExperimental !== null;

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">
            HORMUZ ANALYTICS · THESIS DASHBOARD
          </p>

          <h1>
            HESI / HSI Decision Dashboard
          </h1>

          <p>
            Observed stress · scenario analysis ·
            predictive governance · multi-horizon ML
          </p>
        </div>

        <div className="version">
          {data.meta.version}
        </div>
      </header>

      <nav>
        <button
          className={
            tab === 'overview'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('overview')
          }
        >
          Overview
        </button>

        <button
          className={
            tab === 'scenario'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('scenario')
          }
        >
          HSI Scenario Lab
        </button>

        <button
          className={
            tab === 'registry'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('registry')
          }
        >
          Feature Registry
        </button>
      </nav>

      {tab === 'overview' && (
        <>
          <section className="panel">
            <p className="eyebrow">
              EXPERIMENTAL LIVE · NOT VALIDATED
            </p>

            <h2>
              Experimental Live Market Stress
            </h2>

            <div className="kpis">
              <article>
                <span>
                  LIVE MARKET STRESS
                </span>

                <strong>
                  {liveMarketStress.toFixed(2)}
                </strong>

                <small>
                  Experimental index · 0–100
                </small>
              </article>

              <article>
                <span>
                  DATA AS-OF
                </span>

                <strong
                  style={{
                    fontSize: '1.45rem'
                  }}
                >
                  {computed.asOf}
                </strong>

                <small>
                  Latest pipeline information set
                </small>
              </article>

              <article>
                <span>
                  BRENT
                </span>

                <strong>
                  ${brentValue.toFixed(2)}
                </strong>

                <small>
                  Observation ·{' '}
                  {
                    computed.inputs.brent
                      .observationDate
                  }
                </small>
              </article>

              <article>
                <span>
                  CFTC MM NET
                </span>

                <strong>
                  {cftcNet.toLocaleString()}
                </strong>

                <small>
                  contracts ·{' '}
                  {
                    computed.inputs.cftc
                      .observationDate
                  }
                </small>
              </article>
            </div>

            <div className="notice">
              <b>
                LIVE EXPERIMENTAL INDICATOR — NOT
                OFFICIAL HESI.
              </b>{' '}
              Automatically refreshed from the
              leakage-protected pipeline. The value
              can change when new admissible market
              observations become available.
              AvailableAt protection:{' '}
              <b>
                {computed.availableAtProtection}
              </b>.
            </div>

            <p className="foot">
              Pipeline computed:{' '}
              {formatTimestamp(
                computed.executionTimestamp
              )}
              . This indicator currently represents
              the experimental market layer only.
              It must not be interpreted as the
              complete HESI Effective while the
              physical layer remains unvalidated.
            </p>
          </section>

          <section className="kpis">
            <article>
              <span>
                Official HESI Effective
              </span>

              <strong>
                {data.hesi.effective.toFixed(2)}
              </strong>

              <small>
                Frozen validated reference ·{' '}
                {data.hesi.asOf}
              </small>
            </article>

            <article>
              <span>
                Official Physical Stress
              </span>

              <strong>
                {data.hesi.physical.toFixed(2)}
              </strong>

              <small>
                {data.hesi.physicalNote}
              </small>
            </article>

            <article>
              <span>
                Official Market Stress
              </span>

              <strong>
                {data.hesi.market.toFixed(2)}
              </strong>

              <small>
                {data.hesi.marketNote}
              </small>
            </article>

            <article>
              <span>
                HSI Baseline
              </span>

              <strong>
                {b.toFixed(2)}
              </strong>

              <small>
                Interactive scenario reference
              </small>
            </article>
          </section>

          <div className="notice">
            <b>
              Official vs experimental.
            </b>{' '}
            The official HESI checkpoint remains
            frozen at {data.hesi.asOf}. The live
            experimental market indicator above is
            updated separately and is not promoted
            automatically to official HESI.
          </div>

          <section className="grid overview">
            <div className="panel">
              <h2>
                Experimental methodology
              </h2>

              <p className="sub">
                Automatically refreshed,
                leakage-protected experimental
                market layer.
              </p>

              <div className="notice">
                <b>
                  Status:{' '}
                  {computed.status}
                </b>

                <br />

                AvailableAt protection:{' '}
                {
                  computed.availableAtProtection
                }

                <br />

                Pipeline as-of:{' '}
                {computed.asOf}

                <br />

                Computed:{' '}
                {formatTimestamp(
                  computed.executionTimestamp
                )}
              </div>

              <p className="foot">
                Current experimental composition:
                Brent stress{' '}
                {
                  computed.components
                    .brentStress
                }{' '}
                × 70% + CFTC positioning stress{' '}
                {
                  computed.components
                    .cftcPositioningStress
                }{' '}
                × 30%. These anchors and weights
                remain provisional until
                leakage-safe historical calibration
                and out-of-sample validation are
                completed.
              </p>
            </div>

            <aside className="panel">
              <h2>
                Experimental HESI status
              </h2>

              <div className="class core">
                <b>
                  Market layer
                </b>

                <span>
                  ACTIVE EXPERIMENTAL ·{' '}
                  {liveMarketStress.toFixed(2)}
                </span>
              </div>

              <div className="class econ">
                <b>
                  Physical layer
                </b>

                <span>
                  {physicalComputable
                    ? 'EXPERIMENTAL VALUE AVAILABLE'
                    : physicalStatus}
                </span>
              </div>

              <div className="class excl">
                <b>
                  HESI Effective
                </b>

                <span>
                  {effectiveComputable
                    ? computed
                        .hesiEffectiveExperimental
                    : 'NOT COMPUTED — awaiting validated physical methodology'}
                </span>
              </div>

              <p className="foot">
                Missing physical events are never
                interpreted as zero physical
                stress. Automatic promotion to the
                official HESI remains disabled.
              </p>
            </aside>
          </section>

          <section className="grid overview">
            <div className="panel">
              <h2>
                ML forecast evidence
              </h2>

              <p className="sub">
                Validated experiment metrics are
                shown below rather than inventing
                a live Brent-price forecast. RMSE
                values are from the 2026 daily
                pilot.
              </p>

              <div className="forecastHead">
                <span>Horizon</span>
                <span>Market RF</span>
                <span>
                  Market+Event RF
                </span>
                <span>Scope</span>
              </div>

              {forecasts.map((r) => (
                <div
                  className="forecast"
                  key={r[0]}
                >
                  {r.map((x, i) => (
                    <b key={i}>
                      {x}
                    </b>
                  ))}
                </div>
              ))}

              <p className="foot">
                +3d is a 3-observation proxy in
                the EIA daily series. A live Brent
                forecast will be activated only
                after the historical calibration
                and forecast pipeline passes the
                leakage-safe validation rules.
              </p>
            </div>

            <aside className="panel">
              <h2>
                Model governance
              </h2>

              <div className="class core">
                <b>
                  Predictive Core
                </b>

                <span>
                  Market return / momentum /
                  volatility features with OOS
                  support.
                </span>
              </div>

              <div className="class econ">
                <b>
                  Economic / Scenario
                </b>

                <span>
                  Physical, buffer, route,
                  exposure and diagnostic
                  variables without robust
                  incremental OOS admission.
                </span>
              </div>

              <div className="class excl">
                <b>
                  Excluded / Robustness
                </b>

                <span>
                  TOCI negative robustness;
                  Polymarket external benchmark
                  only.
                </span>
              </div>

              <p className="foot">
                Economic relevance ≠ incremental
                predictive relevance.
              </p>
            </aside>
          </section>
        </>
      )}

      {tab === 'scenario' && (
        <>
          <section className="kpis">
            <article>
              <span>
                Baseline HSI
              </span>

              <strong>
                {b.toFixed(2)}
              </strong>
            </article>

            <article>
              <span>
                Scenario HSI
              </span>

              <strong>
                {s.toFixed(2)}
              </strong>
            </article>

            <article>
              <span>
                Δ HSI
              </span>

              <strong>
                {d >= 0 ? '+' : ''}
                {d.toFixed(2)}
              </strong>
            </article>

            <article>
              <span>
                Regime
              </span>

              <strong className="regime">
                {interp}
              </strong>
            </article>
          </section>

          <div className="notice">
            <b>
              Scenario ≠ causal forecast.
            </b>{' '}
            Slider changes are not translated
            into Brent dollars unless an
            empirical mapping is validated.
          </div>

          <section className="grid">
            <div className="panel">
              <div className="panelTitle">
                <h2>
                  Scenario controls
                </h2>

                <button
                  className="reset"
                  onClick={() =>
                    setSc(base)
                  }
                >
                  Reset baseline
                </button>
              </div>

              {vars.map((v, i) => (
                <div
                  className="row"
                  key={v.name}
                >
                  <div className="meta">
                    <div>
                      <b>
                        {v.name}
                      </b>

                      <small>
                        {v.block} · Economic /
                        Scenario
                      </small>
                    </div>

                    <span
                      className={
                        'tag ' +
                        v.status.toLowerCase()
                      }
                    >
                      {v.status}
                    </span>
                  </div>

                  <div className="control">
                    <span>
                      {v.baseline}
                    </span>

                    <input
                      aria-label={v.name}
                      type="range"
                      min="0"
                      max="100"
                      value={sc[i]}
                      onChange={(e) => {
                        const n = [...sc];

                        n[i] =
                          +e.target.value;

                        setSc(n);
                      }}
                    />

                    <output>
                      {sc[i]}
                    </output>
                  </div>

                  <small>
                    {v.note} · weight{' '}
                    {(v.weight * 100).toFixed(
                      0
                    )}
                    % ·{' '}
                    {v.sign > 0
                      ? 'stress ↑'
                      : 'buffer ↓'}
                  </small>
                </div>
              ))}
            </div>

            <aside className="panel sticky">
              <h2>
                Scenario decomposition
              </h2>

              {vars.map((v, i) => {
                const c =
                  (sc[i] - base[i]) *
                  v.weight *
                  v.sign;

                return (
                  <div
                    className="impact"
                    key={v.name}
                  >
                    <span>
                      {v.name}
                    </span>

                    <b>
                      {c >= 0
                        ? '+'
                        : ''}
                      {c.toFixed(2)}
                    </b>
                  </div>
                );
              })}

              <hr />

              <div className="impact total">
                <span>
                  Net ΔHSI
                </span>

                <b>
                  {d >= 0 ? '+' : ''}
                  {d.toFixed(2)}
                </b>
              </div>
            </aside>
          </section>
        </>
      )}

      {tab === 'registry' && (
        <section className="panel registry">
          <h2>
            Master Feature Registry
          </h2>

          <p className="sub">
            Web feed of the methodological
            classification used by the thesis.
            Data status and methodological class
            remain separate.
          </p>

          <div className="table">
            <div className="tr th">
              <span>
                Feature / block
              </span>
              <span>Domain</span>
              <span>Class</span>
              <span>Status</span>
              <span>
                Evidence / decision
              </span>
            </div>

            {registry.map((r, i) => (
              <div
                className="tr"
                key={i}
              >
                {r.map((x, j) => (
                  <span
                    key={j}
                    className={
                      j === 2
                        ? x.startsWith(
                            'Predictive'
                          )
                          ? 'txtcore'
                          : x.startsWith(
                                'Economic'
                              )
                            ? 'txtecon'
                            : 'txtexcl'
                        : ''
                    }
                  >
                    {x}
                  </span>
                ))}
              </div>
            ))}
          </div>

          <div className="notice">
            <b>
              Promotion rule:
            </b>{' '}
            anti-leakage →
            chronological/purged walk-forward →
            ablation → common-sample OOS
            comparison. Classification changes
            only with new empirical evidence.
          </div>
        </section>
      )}

      <footer>
        Source of truth:{' '}
        {data.meta.registry} ·{' '}
        {data.meta.hsi} ·{' '}
        {data.meta.version} · structured data
        layer
      </footer>
    </main>
  );
}
