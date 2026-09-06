/**
 * yauzl ships no types. Only the narrow, structural-inspection surface this
 * project uses is declared: open a file, walk its central-directory entries
 * (name + sizes only, nothing is ever decompressed), then close. It is
 * already an installed dependency of app-info-parser; lib/apk/validate.ts
 * depends on it directly for pre-parse ZIP structure checks.
 */
declare module "yauzl" {
  export interface Entry {
    fileName: string;
    uncompressedSize: number;
    compressedSize: number;
  }

  export interface ZipFile {
    entryCount: number;
    readEntry(): void;
    close(): void;
    on(event: "entry", listener: (entry: Entry) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
  }

  export interface OpenOptions {
    lazyEntries?: boolean;
    autoClose?: boolean;
    validateEntrySizes?: boolean;
    strictFileNames?: boolean;
  }

  export function open(
    path: string,
    options: OpenOptions,
    callback: (err: Error | null, zipfile?: ZipFile) => void,
  ): void;
}
