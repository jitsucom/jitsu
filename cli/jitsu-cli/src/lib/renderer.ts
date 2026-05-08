import yaml from "js-yaml";

export interface Renderer {
  format: string;
  render(value: unknown): string;
}

const renderers: Record<string, Renderer> = {
  yaml: {
    format: "yaml",
    render(value) {
      if (value === undefined) return "";
      // skipInvalid drops things like undefined/functions silently.
      // noRefs avoids YAML anchors (`&id001`) which confuse readers and most YAML consumers.
      return yaml.dump(value, { skipInvalid: true, noRefs: true, sortKeys: false, lineWidth: 120 });
    },
  },
  json: {
    format: "json",
    render(value) {
      return JSON.stringify(value, null, 2) + "\n";
    },
  },
};

export const SUPPORTED_OUTPUTS = Object.keys(renderers);
export const DEFAULT_OUTPUT = "yaml";

export function getRenderer(format?: string): Renderer {
  const key = (format ?? DEFAULT_OUTPUT).toLowerCase();
  const r = renderers[key];
  if (!r) {
    throw new Error(`Unsupported output format '${format}'. Supported: ${SUPPORTED_OUTPUTS.join(", ")}`);
  }
  return r;
}

export function registerRenderer(r: Renderer) {
  renderers[r.format.toLowerCase()] = r;
}

export function print(value: unknown, format?: string) {
  process.stdout.write(getRenderer(format).render(value));
}
