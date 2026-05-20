/**
 * Wavescope - Canvas 2D vintage green oscilloscope visualization.
 * Renders a CRT-style green waveform that animates during audio playback.
 * When idle, shows a flat scanning line with subtle noise.
 */
import { useRef, useEffect, useCallback } from 'react';

export default function Wavescope({ isActive, analyserNode }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const phaseRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // CRT-style dark background with subtle scanlines
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Draw scanlines
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.03)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Grid lines (dim)
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.06)';
    ctx.lineWidth = 0.5;
    const gridSize = 30;
    for (let x = gridSize; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = gridSize; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    phaseRef.current += 0.02;

    if (isActive && analyserNode) {
      // Real audio visualization from AnalyserNode
      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserNode.getByteTimeDomainData(dataArray);

      // Main waveform
      ctx.strokeStyle = '#00ff66';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ff66';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const sliceWidth = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();

      // Glow pass
      ctx.strokeStyle = 'rgba(0, 255, 102, 0.3)';
      ctx.lineWidth = 6;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();

      // Frequency bars at the bottom (subtle)
      const freqData = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(freqData);
      const barCount = 32;
      const barWidth = w / barCount;
      ctx.shadowBlur = 4;
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor(i * (freqData.length / barCount));
        const barH = (freqData[idx] / 255) * (h * 0.25);
        ctx.fillStyle = `rgba(0, 255, 102, ${0.15 + (freqData[idx] / 255) * 0.3})`;
        ctx.fillRect(i * barWidth, h - barH, barWidth - 2, barH);
      }
    } else {
      // Idle: gentle sine wave with noise
      ctx.strokeStyle = '#00ff66';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#00ff66';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const noise = (Math.random() - 0.5) * 4;
        const y = h / 2 + Math.sin((x / w) * Math.PI * 4 + phaseRef.current) * 8 + noise;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // Vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.55);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    animFrameRef.current = requestAnimationFrame(draw);
  }, [isActive, analyserNode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas resolution
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
    };
    resize();
    window.addEventListener('resize', resize);

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  return (
    <div className="speaker-grill">
      <canvas ref={canvasRef} />
    </div>
  );
}
