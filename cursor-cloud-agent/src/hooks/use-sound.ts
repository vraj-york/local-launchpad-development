"use client";

import { useCallback, useRef } from "react";

const MUTED_KEY = "clr_sound_muted";

function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function getContext(ref: React.RefObject<AudioContext | null>): AudioContext | null {
  if (ref.current) return ref.current;
  try {
    ref.current = new AudioContext();
    return ref.current;
  } catch {
    return null;
  }
}

function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number, gain: number) {
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(gain, startTime);
  vol.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function useSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const playComplete = useCallback(() => {
    if (isMuted()) return;
    const ctx = getContext(ctxRef);
    if (!ctx) return;
    const t = ctx.currentTime;
    playTone(ctx, 880, t, 0.12, 0.15);
    playTone(ctx, 1174.66, t + 0.1, 0.18, 0.12);
  }, []);

  const playError = useCallback(() => {
    if (isMuted()) return;
    const ctx = getContext(ctxRef);
    if (!ctx) return;
    const t = ctx.currentTime;
    playTone(ctx, 330, t, 0.2, 0.15);
    playTone(ctx, 220, t + 0.15, 0.25, 0.12);
  }, []);

  return { playComplete, playError };
}
