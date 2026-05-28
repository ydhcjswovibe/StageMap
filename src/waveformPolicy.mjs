export function buildWaveformBars(count = 96) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index * 0.55) * 0.5 + Math.sin(index * 0.17) * 0.35;
    return Math.max(0.18, Math.min(1, Math.abs(wave)));
  });
}
