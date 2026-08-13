"use client";

import { useEffect, useRef } from "react";

export interface CaretAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function RetroCaret({
  target,
  enabled,
}: {
  target: CaretAnchor | null;
  enabled: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<CaretAnchor | null>(null);
  const animRef = useRef<Animation | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !target) return;

    const from = prev.current;
    prev.current = target;

    if (!from) {
      el.style.left = `${target.x}px`;
      el.style.top = `${target.y}px`;
      el.style.width = `${target.width}px`;
      el.style.height = `${target.height}px`;
      el.style.transform = "none";
      return;
    }

    const dx = from.x - target.x;
    const dy = from.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return;

    animRef.current?.cancel();
    el.style.left = `${target.x}px`;
    el.style.top = `${target.y}px`;
    el.dataset.moving = "true";

    const animation = el.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)`,
          width: `${from.width}px`,
          height: `${from.height}px`,
        },
        {
          transform: "translate(0px, 0px)",
          width: `${target.width}px`,
          height: `${target.height}px`,
        },
      ],
      {
        duration: distance < 60 ? 120 : 400,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
    animRef.current = animation;

    animation.onfinish = () => {
      animRef.current = null;
      el.dataset.moving = "false";
      el.style.width = `${target.width}px`;
      el.style.height = `${target.height}px`;
      el.style.transform = "none";
    };
  }, [target]);

  if (!enabled || !target) return null;

  return <span ref={ref} className="retro-caret" aria-hidden />;
}
