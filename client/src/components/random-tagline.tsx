"use client";

import { useSyncExternalStore } from "react";

const taglines = [
  "find your corner of the web.",
  "claim your square on the internet.",
  "own your piece of the net.",
  "every great idea needs a home.",
  "pick your pixel, stake your name.",
  "the name you want shouldn't be taken.",
  "your spot on the web is waiting.",
];

const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];

const subscribe = () => () => {};

export function RandomTagline() {
  const tagline = useSyncExternalStore(
    subscribe,
    () => randomTagline,
    () => "",
  );

  return (
    <h1 className="text-balance px-4 text-center font-pixel text-lg leading-relaxed text-foreground sm:text-2xl">
      {tagline || "\u00a0"}
      <span className="ml-1 animate-blink text-primary">▍</span>
    </h1>
  );
}
