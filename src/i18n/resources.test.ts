import { describe, expect, it } from "vitest";
import en from "./en.json";
import es from "./es.json";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object"
      ? keys(child as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function placeholders(value: object, prefix = ""): Record<string, string[]> {
  return Object.entries(value).reduce<Record<string, string[]>>(
    (result, [key, child]) =>
      typeof child === "object"
        ? { ...result, ...placeholders(child as object, `${prefix}${key}.`) }
        : {
            ...result,
            [`${prefix}${key}`]: String(child).match(/{{\w+}}/g) ?? [],
          },
    {},
  );
}

describe("translations", () => {
  it("defines the same keys in every language", () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });

  it("uses the same placeholders in every language", () => {
    expect(placeholders(es)).toEqual(placeholders(en));
  });
});
