/**
 * Secrets the desktop build keeps for the renderer — the Git module's access
 * tokens (Req 18.5) — in one file in the app's `userData` directory, each value
 * encrypted by the operating system's keychain (Electron `safeStorage`, which
 * the main process hands in as `Cipher`). The file holds base64 ciphertext
 * only; a key names a host (`git:github.com`), which is not secret.
 *
 * Without Electron in it, so the main process's logic is tested under Node.
 */

/** What encrypts: Electron's `safeStorage` in the main process. */
export interface Cipher {
  /** Whether a real keychain is there (not Linux's plain-text fallback). */
  available(): boolean;
  encrypt(text: string): Uint8Array;
  decrypt(data: Uint8Array): string;
}

/** Reading and writing the file. */
export interface SecretFileIo {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** Keys secrets may be kept under: `git:` and a host, with a port when it has one. */
const KEY = /^git:[a-z0-9.-]+(:\d{1,5})?$/;

/** The secrets file. */
export class SecretFile {
  constructor(
    private readonly cipher: Cipher,
    private readonly io: SecretFileIo,
  ) {}

  available(): boolean {
    return this.cipher.available();
  }

  async get(key: string): Promise<string | null> {
    check(key);
    if (!this.cipher.available()) return null;
    const stored = (await this.entries())[key];
    if (!stored) return null;
    try {
      return this.cipher.decrypt(Buffer.from(stored, 'base64'));
    } catch {
      return null; // encrypted under another keychain (the profile moved): as if not kept
    }
  }

  async set(key: string, value: string): Promise<void> {
    check(key);
    if (!this.cipher.available()) throw new Error('No system keychain to encrypt with: the token is kept for this session only');
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error('Not a token');
    const entries = await this.entries();
    entries[key] = Buffer.from(this.cipher.encrypt(value)).toString('base64');
    await this.io.write(JSON.stringify(entries, null, 1));
  }

  async delete(key: string): Promise<void> {
    check(key);
    const entries = await this.entries();
    if (!(key in entries)) return;
    delete entries[key];
    await this.io.write(JSON.stringify(entries, null, 1));
  }

  async keys(): Promise<string[]> {
    return Object.keys(await this.entries()).filter((k) => KEY.test(k)).sort();
  }

  private async entries(): Promise<Record<string, string>> {
    const text = await this.io.read().catch(() => undefined);
    if (!text) return {};
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}

function check(key: string): void {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('Not a secret key la-gram keeps');
}
