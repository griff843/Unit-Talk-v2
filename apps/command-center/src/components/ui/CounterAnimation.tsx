'use client';

import React, { useEffect, useRef, useState } from 'react';

type FormatValue = (value: number) => string;

export interface CounterAnimationProps {
  value: number;
  duration?: number;
  format?: FormatValue;
  className?: string;
  onSettled?: () => void;
}

function defaultFormat(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

export function CounterAnimation({
  value,
  duration = 300,
  format = defaultFormat,
  className = '',
  onSettled,
}: CounterAnimationProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [previousLabel, setPreviousLabel] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState(() => format(0));
  const [sliding, setSliding] = useState(false);
  const previousValueRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    let frame = 0;
    let slideTimeout = 0;
    const startValue = mountedRef.current ? previousValueRef.current : 0;
    const start = performance.now();

    const tick = (timestamp: number) => {
      const progress = duration <= 0 ? 1 : Math.min((timestamp - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const nextValue = startValue + (value - startValue) * eased;
      setDisplayValue(nextValue);
      setCurrentLabel(format(nextValue));

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
        return;
      }

      setDisplayValue(value);
      const nextLabel = format(value);
      setCurrentLabel(nextLabel);

      if (mountedRef.current && previousValueRef.current !== value) {
        setPreviousLabel(format(previousValueRef.current));
        setSliding(true);
        slideTimeout = window.setTimeout(() => {
          setSliding(false);
          setPreviousLabel(null);
        }, 180);
      }

      previousValueRef.current = value;
      mountedRef.current = true;
      onSettled?.();
    };

    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(slideTimeout);
    };
  }, [duration, format, onSettled, value]);

  const ariaValue = format(displayValue);

  return (
    <span className={`relative inline-flex h-[1.2em] overflow-hidden tabular-nums ${className}`} aria-label={ariaValue}>
      {previousLabel ? (
        <span
          aria-hidden="true"
          className={`absolute inset-0 transition-transform duration-[180ms] ease-out ${sliding ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}
        >
          {previousLabel}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={`transition-transform duration-[180ms] ease-out ${sliding ? 'translate-y-0 opacity-100' : 'translate-y-0 opacity-100'}`}
      >
        {currentLabel}
      </span>
      {previousLabel ? (
        <span
          aria-hidden="true"
          className={`absolute inset-0 translate-y-full transition-transform duration-[180ms] ease-out ${sliding ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
        >
          {currentLabel}
        </span>
      ) : null}
    </span>
  );
}
