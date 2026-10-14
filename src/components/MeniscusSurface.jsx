import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const POINTS = 48;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 72;
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildTopPath(position, velocity, settled) {
  const speed = Math.min(1, Math.abs(velocity) / 0.055);
  const direction = Math.sign(velocity) || 1;
  const lean = direction * speed * 13;
  const width = 62 + speed * 92;
  const depth = 29 - speed * 11;
  const center = position * (VIEWBOX_WIDTH / 4);
  const points = [];

  for (let i = 0; i <= POINTS; i += 1) {
    const x = (i / POINTS) * VIEWBOX_WIDTH;
    const dx = x - center - lean;
    const distance = Math.abs(dx) / width;
    const gaussian = Math.exp(-(distance * distance) * 1.5);
    const shoulder = Math.exp(-(((x - center) / (width * 1.9)) ** 2));
    const y = 22 + depth * gaussian + speed * 3 * shoulder;
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  // Keep a small, stable highlight around the resting cavity; it sells the liquid edge
  // without introducing a blur/filter pass on every frame.
  const end = `L${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT} L0 ${VIEWBOX_HEIGHT} Z`;
  const highlight = settled
    ? `M${Math.max(0, center - width * 1.45).toFixed(1)} 25 C${(center - width * 0.8).toFixed(1)} 18 ${(center + width * 0.8).toFixed(1)} 18 ${Math.min(VIEWBOX_WIDTH, center + width * 1.45).toFixed(1)} 25`
    : '';
  return { fill: `${points.join(' ')} ${end}`, highlight };
}

const MeniscusSurface = forwardRef(function MeniscusSurface({ position = 0 }, ref) {
  const fillRef = useRef(null);
  const highlightRef = useRef(null);
  const beadRef = useRef(null);
  const frameRef = useRef(0);
  const stateRef = useRef({ current: position, target: position, velocity: 0, last: performance.now() });
  const targetRef = useRef(position);

  useImperativeHandle(ref, () => ({
    setTarget(nextPosition, immediate = false) {
      targetRef.current = clamp(nextPosition, 0, 4);
      if (immediate || prefersReducedMotion()) {
        stateRef.current.current = targetRef.current;
        stateRef.current.velocity = 0;
      }
    },
  }), []);

  useEffect(() => {
    const state = stateRef.current;
    state.current = position;
    state.target = position;
    targetRef.current = position;
    const render = (now) => {
      const dt = Math.min(0.032, Math.max(0.001, (now - state.last) / 1000));
      state.last = now;
      state.target = targetRef.current;
      const distance = state.target - state.current;
      // Critically damped-ish spring: fast response, no oscillation after settling.
      const acceleration = distance * 92 - state.velocity * 19;
      state.velocity += acceleration * dt;
      state.current += state.velocity * dt;
      if (Math.abs(distance) < 0.0005 && Math.abs(state.velocity) < 0.0005) {
        state.current = state.target;
        state.velocity = 0;
      }
      const settled = state.velocity === 0;
      const paths = buildTopPath(state.current, state.velocity, settled);
      fillRef.current?.setAttribute('d', paths.fill);
      highlightRef.current?.setAttribute('d', paths.highlight);
      const x = state.current * (VIEWBOX_WIDTH / 4);
      const speed = Math.min(1, Math.abs(state.velocity) / 0.055);
      const scaleX = 1 + speed * 0.14;
      const scaleY = 1 - speed * 0.08;
      beadRef.current?.setAttribute('transform', `translate(${x.toFixed(2)} ${(27 + speed * 2).toFixed(2)}) scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)})`);
      frameRef.current = requestAnimationFrame(render);
    };
    frameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameRef.current);
  }, [position]);

  return (
    <svg
      className="meniscus-surface"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="meniscus-liquid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d97757" />
          <stop offset="1" stopColor="#9a4a32" />
        </linearGradient>
        <radialGradient id="meniscus-bead" cx="32%" cy="24%" r="78%">
          <stop offset="0" stopColor="#f8b49a" />
          <stop offset="0.2" stopColor="#e88363" />
          <stop offset="0.72" stopColor="#b85c3e" />
          <stop offset="1" stopColor="#8f3e2b" />
        </radialGradient>
      </defs>
      <path ref={fillRef} className="meniscus-liquid" d="" fill="url(#meniscus-liquid)" />
      <path ref={highlightRef} className="meniscus-highlight" d="" />
      <g ref={beadRef} className="meniscus-bead-svg" transform={`translate(${position * (VIEWBOX_WIDTH / 4)} 27)`}>
        <circle className="meniscus-bead-shadow" cy="7" r="25" />
        <circle r="27" fill="url(#meniscus-bead)" />
        <circle className="meniscus-bead-shine" cx="-9" cy="-10" r="5" />
      </g>
    </svg>
  );
});

export default MeniscusSurface;
