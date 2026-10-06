import type { CSSProperties } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { usePlayer } from "../context";
import { ScreenHeader, Toggle } from "../components";
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE } from "../audioEngine";

const label = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const signed = (n: number, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

function curvePath(bands: number[], width: number, height: number) {
  const pts = bands.map((db, i) => [(i / (bands.length - 1)) * width, height / 2 - (db / EQ_RANGE) * (height / 2 - 6)]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function Equalizer() {
  const { eq, customPresets, balance, boost, actions } = usePlayer();
  const presets = { ...EQ_PRESETS, ...customPresets };
  const path = curvePath(eq.bands, 300, 100);

  const choosePreset = (name: string) => actions.setEq((e) => ({ ...e, enabled: true, preset: name, bands: [...presets[name]] }));
  const setBand = (index: number, value: number) => actions.setEq((e) => ({ ...e, enabled: true, preset: "Custom", bands: e.bands.map((b, i) => (i === index ? value : b)) }));

  return (
    <section className="screen eqScreen">
      <ScreenHeader title="Equalizer" subtitle={eq.enabled ? `${eq.preset}${eq.preamp ? ` · preamp ${signed(eq.preamp)} dB` : ""}` : "Off"}>
        <Toggle checked={eq.enabled} onChange={(on) => actions.setEq((e) => ({ ...e, enabled: on }))} label="Equalizer" />
      </ScreenHeader>

      <div className={"eqPanel" + (eq.enabled ? "" : " off")}>
        <svg className="eqCurve" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.45" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="50" x2="300" y2="50" className="eqZero" />
          <path d={`${path} L 300 100 L 0 100 Z`} fill="url(#eqFill)" />
          <path d={path} className="eqLine" />
        </svg>

        <div className="eqBands">
          {EQ_BANDS.map((hz, i) => (
            <label key={hz} className="eqBand">
              <span className="eqValue">{signed(eq.bands[i] ?? 0)}</span>
              <input type="range" className="vrange" min={-EQ_RANGE} max={EQ_RANGE} step={0.5} value={eq.bands[i] ?? 0}
                aria-label={`${label(hz)} Hz`} onChange={(e) => setBand(i, Number(e.target.value))} onDoubleClick={() => setBand(i, 0)}
                style={{ "--pct": `${(((eq.bands[i] ?? 0) + EQ_RANGE) / (EQ_RANGE * 2)) * 100}%` } as CSSProperties} />
              <span className="eqHz">{label(hz)}</span>
            </label>
          ))}
        </div>
      </div>

      <h2 className="sectionLabel">Presets</h2>
      <div className="chips">
        {Object.keys(presets).map((name) => (
          <span key={name} className={"chip" + (eq.enabled && eq.preset === name ? " on" : "")} role="button" tabIndex={0}
            onClick={() => choosePreset(name)} onKeyDown={(e) => { if (e.key === "Enter") choosePreset(name); }}>
            {name}
            {name in customPresets && (
              <button className="chipX" aria-label={`Delete preset ${name}`} onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(`Delete preset “${name}”?`)) return;
                actions.setCustomPresets((p) => {
                  const copy = { ...p };
                  delete copy[name];
                  return copy;
                });
              }}><X size={12} /></button>
            )}
          </span>
        ))}
        <button className="chip ghost" onClick={() => {
          const name = window.prompt("Save current curve as preset", eq.preset === "Custom" ? "My preset" : `${eq.preset} (custom)`)?.trim();
          if (!name) return;
          if (name in EQ_PRESETS) return actions.toast("That name is used by a built-in preset");
          actions.setCustomPresets((p) => ({ ...p, [name]: [...eq.bands] }));
          actions.setEq((e) => ({ ...e, preset: name }));
          actions.toast(`Preset “${name}” saved`);
        }}><Save size={14} /> Save preset</button>
      </div>

      <div className="card">
        <SliderRow label="Preamp" value={`${signed(eq.preamp, 1)} dB`} min={-EQ_RANGE} max={EQ_RANGE} step={0.5} current={eq.preamp}
          onChange={(v) => actions.setEq((e) => ({ ...e, enabled: true, preamp: v }))} onReset={() => actions.setEq((e) => ({ ...e, preamp: 0 }))} />
        <SliderRow label="Balance" value={balance === 0 ? "Center" : balance < 0 ? `L ${Math.round(-balance * 100)}%` : `R ${Math.round(balance * 100)}%`}
          min={-1} max={1} step={0.05} current={balance} onChange={actions.setBalance} onReset={() => actions.setBalance(0)} />
        <SliderRow label="Volume boost" value={`${Math.round(boost * 100)}%`} min={1} max={2} step={0.05} current={boost}
          onChange={actions.setBoost} onReset={() => actions.setBoost(1)} />
        {boost > 1.3 && <p className="hint">High boost can distort loud tracks; a built-in limiter keeps it from clipping.</p>}
      </div>

      <button className="btn wide" onClick={() => {
        actions.setEq(() => ({ enabled: false, preset: "Flat", bands: [...EQ_PRESETS.Flat], preamp: 0 }));
        actions.setBalance(0);
        actions.setBoost(1);
      }}><RotateCcw size={16} /> Reset all audio effects</button>
      <p className="hint center">Tip: double-click a band to reset it. Effects apply to music and video.</p>
    </section>
  );
}

function SliderRow({ label: name, value, min, max, step, current, onChange, onReset }: {
  label: string; value: string; min: number; max: number; step: number; current: number; onChange: (v: number) => void; onReset: () => void;
}) {
  return (
    <div className="sliderRow">
      <div><span>{name}</span><button className="link" onClick={onReset}>{value}</button></div>
      <input type="range" className="range" min={min} max={max} step={step} value={current} aria-label={name}
        style={{ "--pct": `${((current - min) / (max - min)) * 100}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
