/** One-hue sequential ramp. The first stop means "near zero" and recedes toward the surface. */
const LIGHT_STOPS = [
  [0xcd, 0xe2, 0xfb],
  [0x86, 0xb6, 0xef],
  [0x39, 0x87, 0xe5],
  [0x1c, 0x5c, 0xab],
  [0x0d, 0x36, 0x6b],
];
const DARK_STOPS = [...LIGHT_STOPS].reverse();

export function isDarkTheme(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function rampRgb(
  value: number,
  dark: boolean,
): [number, number, number] {
  const stops = dark ? DARK_STOPS : LIGHT_STOPS;
  const position = Math.max(0, Math.min(1, value)) * (stops.length - 1);
  const index = Math.min(Math.floor(position), stops.length - 2);
  const fraction = position - index;
  const [from, to] = [stops[index], stops[index + 1]];
  return [0, 1, 2].map((part) =>
    Math.round(from[part] + (to[part] - from[part]) * fraction),
  ) as [number, number, number];
}

export function rampCss(value: number, dark: boolean): string {
  const [red, green, blue] = rampRgb(value, dark);
  return `rgb(${red} ${green} ${blue})`;
}
