/**
 * app-info-parser ships no types. Only the narrow surface this project uses is
 * declared: construct with a path (Node) or File/Blob (browser), then parse().
 * The result is deliberately `unknown`-ish — the route validates every field
 * rather than trusting a shape we cannot verify.
 */
declare module "app-info-parser" {
  export default class AppInfoParser {
    constructor(file: string | File | Blob);
    parse(): Promise<Record<string, unknown>>;
  }
}
