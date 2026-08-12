import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type SceneType =
  | 'evidence'
  | 'diagram'
  | 'data'
  | 'process'
  | 'ai_scene'
  | 'licensed_external';

export type Scene = {
  start: number;
  end: number;
  type: SceneType;
  text: string;
  asset: string | null;
  source: string | null;
  kicker?: string;
  values?: Array<{label: string; value: string}>;
  steps?: string[];
  motion_kind?: 'branch' | 'comparison' | 'signal' | 'timeline' | 'barrier' | 'flow';
  motion_thesis?: string;
  main_moving_object?: string;
  state_change?: string;
  secondary_state_change?: string;
  camera_motion?: string;
  text_role?: string;
  asset_need?: string;
  ppt_risk?: string;
  labels?: string[];
};

export type Caption = {
  start: number;
  end: number;
  text: string;
};

export type VideoProps = {
  title: string;
  creatorName?: string;
  lane: 'thought' | 'project_sop';
  duration: number;
  audio: string;
  scenes: Scene[];
  captions: Caption[];
};

const colors = {
  thought: {
    bg: '#07111F',
    ink: '#F7FBFF',
    muted: '#93A4B8',
    accent: '#45D6E8',
    soft: '#15253A',
  },
  project_sop: {
    bg: '#F4F7FF',
    ink: '#0A2540',
    muted: '#425466',
    accent: '#635BFF',
    soft: '#DDE5FF',
  },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const MotionScene: React.FC<{
  scene: Scene;
  horizontal: boolean;
  accent: string;
  soft: string;
}> = ({scene, horizontal, accent, soft}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = Math.max(0, frame - scene.start * fps);
  const durationFrames = Math.max(1, (scene.end - scene.start) * fps);
  const phase = clamp01(localFrame / durationFrames);
  const reveal = (from: number, to: number) => clamp01((phase - from) / Math.max(0.001, to - from));
  const breathe = 1 + Math.sin(localFrame / 8) * 0.025;
  const labels = scene.labels?.length ? scene.labels : ['等待确定', '先做一轮'];
  const panel: React.CSSProperties = {
    border: `2px solid ${accent}66`,
    background: 'rgba(10,24,42,.88)',
    boxShadow: `0 0 50px ${accent}22`,
    borderRadius: 28,
  };

  const Branch = () => {
    const split = reveal(0.12, 0.42);
    const leftIn = reveal(0.34, 0.62);
    const rightIn = reveal(0.48, 0.76);
    return (
      <div style={{position: 'relative', width: '100%', height: horizontal ? 620 : 930}}>
        <div style={{...panel, position: 'absolute', left: '16%', right: '16%', top: 20, padding: '34px 28px', textAlign: 'center', transform: `scale(${0.9 + reveal(0, 0.2) * 0.1})`, opacity: reveal(0, 0.16)}}>
          <div style={{fontSize: horizontal ? 48 : 60, fontWeight: 950}}>{scene.main_moving_object || scene.text}</div>
        </div>
        <div style={{position: 'absolute', left: '50%', top: horizontal ? 180 : 220, width: 5, height: horizontal ? 130 : 190, background: accent, transformOrigin: 'top', transform: `scaleY(${split})`}} />
        <div style={{position: 'absolute', left: '22%', right: '22%', top: horizontal ? 306 : 406, height: 5, background: accent, transformOrigin: 'center', transform: `scaleX(${split})`}} />
        {[
          {label: labels[0], left: '4%', opacity: leftIn, color: '#FF7B72', drift: -30},
          {label: labels[1] || '先做一轮', left: '54%', opacity: rightIn, color: '#FFD166', drift: 30},
        ].map((item) => (
          <div key={item.label} style={{...panel, position: 'absolute', top: horizontal ? 350 : 470, left: item.left, width: '42%', padding: horizontal ? '34px 24px' : '46px 24px', textAlign: 'center', opacity: item.opacity, transform: `translateY(${(1 - item.opacity) * 70}px) translateX(${(1 - item.opacity) * item.drift}px)`}}>
            <div style={{fontSize: horizontal ? 38 : 50, fontWeight: 900, color: item.color}}>{item.label}</div>
          </div>
        ))}
      </div>
    );
  };

  const Comparison = () => {
    const school = reveal(0.05, 0.34);
    const marketDelay = reveal(0.42, 0.82);
    const rows = [
      {label: labels[0] || '学校：做完就有分数', progress: school, color: accent, note: '即时反馈'},
      {label: labels[1] || '市场：先行动，反馈后来', progress: marketDelay, color: '#FFD166', note: phase < 0.52 ? '暂时没动静' : '反馈出现'},
    ];
    return (
      <div style={{width: '100%'}}>
        <div style={{fontSize: horizontal ? 58 : 70, fontWeight: 950, lineHeight: 1.12, marginBottom: 70}}>{scene.motion_thesis || scene.text}</div>
        {rows.map((row, index) => (
          <div key={row.label} style={{marginTop: index ? 64 : 0}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 30}}>
              <div style={{fontSize: horizontal ? 34 : 44, fontWeight: 850}}>{row.label}</div>
              <div style={{fontSize: horizontal ? 24 : 30, color: row.color, fontWeight: 800}}>{row.note}</div>
            </div>
            <div style={{height: horizontal ? 30 : 38, borderRadius: 99, background: soft, marginTop: 20, overflow: 'hidden'}}>
              <div style={{height: '100%', width: `${Math.max(2, row.progress * 100)}%`, borderRadius: 99, background: row.color, boxShadow: `0 0 32px ${row.color}`, transition: 'none'}} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const Signal = () => {
    const appear = reveal(0.08, 0.3);
    const pulse = 0.82 + (Math.sin(localFrame / 5) + 1) * 0.09;
    return (
      <div style={{display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: horizontal ? 90 : 70, width: '100%'}}>
        <div style={{position: 'relative', width: horizontal ? 420 : 500, height: horizontal ? 420 : 500, display: 'grid', placeItems: 'center'}}>
          {[1, 0.76, 0.52].map((scale, index) => (
            <div key={scale} style={{position: 'absolute', inset: 0, margin: 'auto', width: '100%', height: '100%', borderRadius: '50%', border: `4px solid ${index === 2 ? '#FFD166' : accent}`, opacity: appear * (0.16 + index * 0.18), transform: `scale(${scale * pulse})`}} />
          ))}
          <div style={{fontSize: horizontal ? 86 : 110, fontWeight: 950, color: '#FFD166', transform: `scale(${0.7 + appear * 0.3})`}}>1</div>
        </div>
        <div style={{flex: 1, opacity: reveal(0.22, 0.48), transform: `translateY(${(1 - reveal(0.22, 0.48)) * 80}px)`}}>
          <div style={{fontSize: horizontal ? 30 : 36, color: accent, fontWeight: 900}}>第一次真实反馈</div>
          <div style={{fontSize: fitText(scene.text, horizontal), fontWeight: 950, lineHeight: 1.12, marginTop: 22}}>{scene.text}</div>
        </div>
      </div>
    );
  };

  const Flow = () => {
    const items = labels.length >= 3 ? labels : ['开始尝试', '等待反馈', '决定下一步'];
    return (
      <div style={{width: '100%'}}>
        <div style={{fontSize: horizontal ? 56 : 68, fontWeight: 950, lineHeight: 1.12, marginBottom: 64}}>{scene.motion_thesis || scene.text}</div>
        <div style={{display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'center', gap: horizontal ? 20 : 30}}>
          {items.slice(0, 4).map((item, index) => {
            const itemIn = reveal(0.1 + index * 0.18, 0.28 + index * 0.18);
            return (
              <React.Fragment key={item}>
                <div style={{...panel, flex: 1, width: horizontal ? undefined : '100%', padding: horizontal ? '34px 24px' : '38px 30px', opacity: itemIn, transform: `translateY(${(1 - itemIn) * 50}px) scale(${0.92 + itemIn * 0.08})`}}>
                  <div style={{fontSize: horizontal ? 26 : 30, color: accent, fontWeight: 900}}>0{index + 1}</div>
                  <div style={{fontSize: horizontal ? 34 : 42, fontWeight: 900, marginTop: 10}}>{item}</div>
                </div>
                {index < Math.min(items.length, 4) - 1 ? <div style={{fontSize: 46, color: accent, opacity: itemIn}}>{horizontal ? '→' : '↓'}</div> : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <AbsoluteFill style={{padding: horizontal ? '96px 112px 220px' : '180px 76px 520px', justifyContent: 'center', transform: `scale(${breathe})`}}>
      {scene.motion_kind === 'branch' ? <Branch /> : scene.motion_kind === 'comparison' ? <Comparison /> : scene.motion_kind === 'signal' ? <Signal /> : <Flow />}
    </AbsoluteFill>
  );
};

const fitText = (text: string, horizontal: boolean) => {
  if (text.length > 42) return horizontal ? 50 : 54;
  if (text.length > 28) return horizontal ? 58 : 64;
  return horizontal ? 68 : 76;
};

const EvidenceScene: React.FC<{scene: Scene; horizontal: boolean}> = ({scene, horizontal}) => {
  return (
    <AbsoluteFill
      style={{
        padding: horizontal ? '76px 108px 210px' : '132px 76px 520px',
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        gap: horizontal ? 56 : 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{flex: 1}}>
        <div style={{fontSize: horizontal ? 26 : 34, fontWeight: 800, letterSpacing: 3, opacity: 0.62}}>
          {scene.kicker || '真实证据'}
        </div>
        <div style={{fontSize: fitText(scene.text, horizontal), lineHeight: 1.18, fontWeight: 900, marginTop: 24}}>
          {scene.text}
        </div>
      </div>
      {scene.asset ? (
        <div
          style={{
            flex: horizontal ? 1.15 : undefined,
            width: horizontal ? undefined : '100%',
            height: horizontal ? '76%' : '52%',
            borderRadius: 32,
            overflow: 'hidden',
            background: '#fff',
            boxShadow: '0 28px 80px rgba(16,24,40,.18)',
          }}
        >
          <Img
            src={staticFile(scene.asset)}
            style={{width: '100%', height: '100%', objectFit: 'contain'}}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const DataScene: React.FC<{scene: Scene; horizontal: boolean; accent: string; soft: string}> = ({
  scene,
  horizontal,
  accent,
  soft,
}) => {
  const values = scene.values?.length
    ? scene.values
    : [
        {label: '事实', value: '01'},
        {label: '变化', value: '02'},
        {label: '结论', value: '03'},
      ];
  return (
    <AbsoluteFill style={{padding: horizontal ? '88px 112px 220px' : '150px 72px 540px', justifyContent: 'center'}}>
      <div style={{fontSize: fitText(scene.text, horizontal), lineHeight: 1.15, fontWeight: 900, maxWidth: horizontal ? 1320 : 920}}>
        {scene.text}
      </div>
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, values.length)}, 1fr)`, gap: 22, marginTop: 48}}>
        {values.slice(0, 3).map((item) => (
          <div key={item.label} style={{padding: horizontal ? '30px 34px' : '36px 22px', borderRadius: 24, background: soft}}>
            <div style={{fontSize: horizontal ? 48 : 54, color: accent, fontWeight: 950}}>{item.value}</div>
            <div style={{fontSize: horizontal ? 26 : 30, fontWeight: 750, marginTop: 12}}>{item.label}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const ProcessScene: React.FC<{scene: Scene; horizontal: boolean; accent: string}> = ({scene, horizontal, accent}) => {
  const steps = scene.steps?.length ? scene.steps : scene.text.split(/[→>|｜]/u).map((value) => value.trim()).filter(Boolean);
  return (
    <AbsoluteFill style={{padding: horizontal ? '80px 110px 220px' : '150px 72px 550px', justifyContent: 'center'}}>
      <div style={{fontSize: horizontal ? 30 : 38, fontWeight: 800, opacity: 0.6}}>流程</div>
      <div style={{display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'stretch', gap: horizontal ? 20 : 24, marginTop: 32}}>
        {steps.slice(0, 5).map((step, index) => (
          <React.Fragment key={`${index}-${step}`}>
            <div style={{flex: 1, padding: horizontal ? '32px 26px' : '28px 34px', border: `3px solid ${accent}`, borderRadius: 24, background: '#fff'}}>
              <div style={{fontSize: horizontal ? 22 : 26, color: accent, fontWeight: 900}}>0{index + 1}</div>
              <div style={{fontSize: horizontal ? 34 : 40, lineHeight: 1.25, fontWeight: 850, marginTop: 10}}>{step}</div>
            </div>
            {index < Math.min(steps.length, 5) - 1 ? (
              <div style={{alignSelf: 'center', color: accent, fontSize: horizontal ? 38 : 44, fontWeight: 900}}>
                {horizontal ? '→' : '↓'}
              </div>
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const ConceptScene: React.FC<{scene: Scene; horizontal: boolean; accent: string; soft: string}> = ({
  scene,
  horizontal,
  accent,
  soft,
}) => {
  return (
    <AbsoluteFill style={{padding: horizontal ? '90px 120px 220px' : '160px 80px 560px', justifyContent: 'center'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: horizontal ? 60 : 34, flexDirection: horizontal ? 'row' : 'column'}}>
        <div style={{width: horizontal ? 420 : 360, height: horizontal ? 420 : 360, borderRadius: '50%', background: soft, border: `22px solid ${accent}`, boxShadow: `inset 0 0 0 24px #fff`}} />
        <div style={{flex: 1}}>
          <div style={{fontSize: horizontal ? 28 : 34, color: accent, fontWeight: 900}}>核心观点</div>
          <div style={{fontSize: fitText(scene.text, horizontal), lineHeight: 1.18, fontWeight: 900, marginTop: 20}}>{scene.text}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CaptionLayer: React.FC<{caption: Caption | undefined; horizontal: boolean}> = ({caption, horizontal}) => {
  if (!caption) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: horizontal ? '12%' : '8%',
        right: horizontal ? '12%' : '8%',
        top: '68%',
        textAlign: 'center',
        color: '#fff',
        fontSize: horizontal ? 43 : 50,
        lineHeight: 1.28,
        fontWeight: 850,
        textShadow: '0 3px 10px rgba(0,0,0,.92),0 0 3px #000',
        maxHeight: horizontal ? 118 : 136,
        overflow: 'hidden',
      }}
    >
      {caption.text}
    </div>
  );
};

export const ContentVideo: React.FC<VideoProps> = ({title, creatorName = '创作者', lane, audio, scenes, captions}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const time = frame / fps;
  const horizontal = width > height;
  const palette = colors[lane];
  const scene = scenes.find((item) => time >= item.start && time < item.end) || scenes[scenes.length - 1];
  const caption = captions.find((item) => time >= item.start && time < item.end);
  const enter = interpolate(frame % Math.max(1, Math.round((scene.end - scene.start) * fps)), [0, 10], [0.94, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{background: palette.bg, color: palette.ink, fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif'}}>
      <Audio src={staticFile(audio)} />
      {lane === 'thought' ? (
        <AbsoluteFill style={{opacity: 0.24, backgroundImage: `linear-gradient(${palette.accent}16 1px, transparent 1px),linear-gradient(90deg, ${palette.accent}16 1px, transparent 1px)`, backgroundSize: '72px 72px', transform: `translate(${(frame % 72) - 72}px, ${(frame % 72) - 72}px)`}} />
      ) : null}
      <AbsoluteFill style={{transform: `scale(${enter})`}}>
        {scene.motion_kind ? (
          <MotionScene scene={scene} horizontal={horizontal} accent={palette.accent} soft={palette.soft} />
        ) : scene.type === 'evidence' || scene.type === 'licensed_external' || scene.type === 'ai_scene' ? (
          <EvidenceScene scene={scene} horizontal={horizontal} />
        ) : scene.type === 'data' ? (
          <DataScene scene={scene} horizontal={horizontal} accent={palette.accent} soft={palette.soft} />
        ) : scene.type === 'process' ? (
          <ProcessScene scene={scene} horizontal={horizontal} accent={palette.accent} />
        ) : (
          <ConceptScene scene={scene} horizontal={horizontal} accent={palette.accent} soft={palette.soft} />
        )}
      </AbsoluteFill>
      <div style={{position: 'absolute', top: horizontal ? 34 : 54, left: horizontal ? 60 : 48, fontSize: horizontal ? 24 : 30, fontWeight: 800, opacity: 0.55}}>
        {creatorName} · {title}
      </div>
      {scene.source ? (
        <div style={{position: 'absolute', right: 42, bottom: horizontal ? 34 : 58, fontSize: horizontal ? 18 : 22, opacity: 0.45}}>
          来源：{scene.source}
        </div>
      ) : null}
      <CaptionLayer caption={caption} horizontal={horizontal} />
    </AbsoluteFill>
  );
};
