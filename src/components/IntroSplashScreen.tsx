import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { FastForward } from 'lucide-react';

interface IntroSplashScreenProps {
  durationSec?: number;
  onFinish: () => void;
}

export const IntroSplashScreen: React.FC<IntroSplashScreenProps> = ({
  durationSec = 5,
  onFinish,
}) => {
  const [remainingMs, setRemainingMs] = useState(durationSec * 1000);
  const [exiting, setExiting] = useState(false);

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const completedRef = useRef(false);

  const triggerExit = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setExiting(true);
    window.setTimeout(() => {
      onFinishRef.current();
    }, 220);
  };

  useEffect(() => {
    completedRef.current = false;
    const start = Date.now();
    const totalMs = Math.max(1000, durationSec * 1000);
    setRemainingMs(totalMs);

    const tick = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, totalMs - elapsed);
      setRemainingMs(left);
      if (left <= 0) {
        window.clearInterval(tick);
        triggerExit();
      }
    }, 50);

    // Failsafe hard timeout in case interval is throttled in background tabs
    const failsafe = window.setTimeout(() => {
      window.clearInterval(tick);
      setRemainingMs(0);
      triggerExit();
    }, totalMs + 120);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(failsafe);
    };
  }, [durationSec]);

  const handleSkip = () => {
    triggerExit();
  };

  const progressPct = Math.min(100, Math.max(0, ((durationSec * 1000 - remainingMs) / (durationSec * 1000)) * 100));
  const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] bg-slate-950 text-white flex flex-col items-center justify-between px-6 py-8 sm:py-12 overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      aria-label="FaceBot Startup Intro"
    >
      {/* Subtle Ambient Background Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(56, 189, 248, 0.16) 0%, rgba(15, 23, 42, 0.92) 55%, #020617 100%)',
        }}
      />

      {/* Top Subtle Brand Line */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 text-xs font-mono tracking-widest text-cyan-300/80 uppercase"
      >
        FaceBot ESP32 AI Portal
      </motion.div>

      {/* Center Animated FaceBot Logo Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center my-auto w-full max-w-md">
        <div className="relative flex items-center justify-center">
          {/* Smooth breathing cyan aura rings */}
          <motion.div
            aria-hidden="true"
            animate={{
              scale: [1, 1.12, 1],
              opacity: [0.22, 0.45, 0.22],
            }}
            transition={{
              duration: 2.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-cyan-400/20 blur-3xl"
          />

          {/* Official Animated FaceBot Logo (Zero-broken-image local asset) */}
          <motion.div
            initial={{ scale: 0.78, opacity: 0, y: 18 }}
            animate={{
              scale: [0.96, 1.03, 0.98, 1.02, 1],
              opacity: 1,
              y: [0, -8, 0, -5, 0],
            }}
            transition={{
              scale: { duration: 4.6, ease: 'easeInOut' },
              y: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' },
              opacity: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
            }}
            className="relative w-56 h-56 sm:w-72 sm:h-72 rounded-[2.25rem] bg-white/5 p-3 border border-cyan-300/20 shadow-2xl shadow-cyan-500/20 backdrop-blur-sm flex items-center justify-center overflow-hidden"
          >
            <img
              src="/assets/aistudio/image_d35aba0a.png"
              alt="Muhib Creation FaceBot Logo"
              className="w-full h-full object-contain rounded-[1.75rem]"
              referrerPolicy="no-referrer"
            />
          </motion.div>
        </div>

        {/* Title & Progress Bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 text-center space-y-2 w-full max-w-xs"
        >
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Muhib Creation
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Initializing OLED Display · Voice AI · Cloud Sync
          </p>

          {/* Smooth 5-Second Progress Bar */}
          <div className="pt-3">
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 rounded-full transition-[width] duration-75 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] font-mono text-slate-400 tabular-nums">
              Starting in {secondsLeft}s
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Skip Button */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.35 }}
        className="relative z-10 w-full flex justify-center"
      >
        <button
          type="button"
          onClick={handleSkip}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold text-slate-100 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl transition-colors cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <span>Skip Intro</span>
          <FastForward className="w-4 h-4 text-cyan-300" />
        </button>
      </motion.div>
    </motion.div>
  );
};
