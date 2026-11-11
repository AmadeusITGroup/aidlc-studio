import * as vscode from 'vscode';
import { Shell } from './shell';
import { AidlcVariant } from './variants';

export interface VariantAccessResult {
  accessible: boolean;
  reason?: string;
}

/**
 * Classify a `git ls-remote` failure's stderr/message text into a friendly,
 * variant-aware reason — using the SAME patterns RuleLoader.cloneAidlcRepo
 * uses to raise RepoAccessError, so the two paths agree on what "auth" vs
 * "not found" means. Pure/unit-testable: no shell, no vscode.
 *
 * Returns a friendly reason string for auth/not-found failures, or undefined
 * for anything else (the caller treats "unclassified" as a clean, generic
 * inaccessible without exposing raw git output).
 */
export function classifyAccessFailure(
  message: string,
  variant: Pick<AidlcVariant, 'label' | 'repoUrl'>
): string | undefined {
  if (/Authentication|403|401|could not read Username|terminal prompts disabled/i.test(message)) {
    return (
      `You don't have access to "${variant.label}". This version is restricted — ` +
      `make sure you're on the required network and signed in, or choose the open-source version instead.`
    );
  }
  if (/not found|Repository not found|does not exist/i.test(message)) {
    return (
      `The repository for "${variant.label}" was not found or is inaccessible (${variant.repoUrl}). ` +
      `Check the URL in settings (amadeus-aidlc.rulesSource), or choose the open-source version instead.`
    );
  }
  return undefined;
}

/**
 * Sentinel reason returned when the access pre-check could not run because
 * `git` is not available on this machine. The checker reports
 * `{ accessible: true, reason: GIT_UNAVAILABLE_SKIP }` so setup PROCEEDS to the
 * normal install (whose RepoAccessError is the authoritative access backstop)
 * rather than falsely reporting "no access". git is never installed by the
 * setup flow, so a missing git must silently skip the pre-check.
 */
export const GIT_UNAVAILABLE_SKIP = 'git-unavailable-skip';

/**
 * Detect — from a failed `git ls-remote` message — whether the failure was
 * "git is not installed / not found" rather than an auth or not-found response
 * from the remote. Matches the shapes Node/exec and the OS produce when the
 * `git` executable itself can't be spawned (ENOENT, "command not found", the
 * Windows "is not recognized" message), distinct from git running and the
 * REMOTE reporting not-found. Pure/unit-testable.
 */
export function isGitUnavailable(message: string): boolean {
  return /ENOENT|command not found|not recognized as an internal or external command|No such file or directory.*git|spawn .*git.* ENOENT/i.test(
    message
  );
}

/**
 * Whether a variant's install path is access-gated (private/SSO repo) and so
 * warrants a network access pre-check before we install any prerequisites.
 * AWS (public native installer) is never gated.
 */
export function isAccessGated(variant: Pick<AidlcVariant, 'id' | 'installMethod'>): boolean {
  if (variant.id === 'aws') {
    return false;
  }
  return (
    variant.installMethod === 'amadeus-cli' ||
    variant.installMethod === 'repo-installer' ||
    variant.installMethod === 'git-clone-copy'
  );
}

/**
 * Checks whether the user can actually reach a variant's source BEFORE we
 * install prerequisites for it. Lets setup stop early with a friendly "you
 * don't have access" message instead of installing bun/git and then failing
 * deep inside the clone/installer.
 *
 * - AWS (public): always accessible — no network call.
 * - Amadeus / custom (private/SSO repo): a plain `git ls-remote <repoUrl>`
 *   with a short timeout. Exit 0 → accessible; auth/not-found failure → a
 *   friendly reason; anything else → a clean generic inaccessible. Requires
 *   git to be present (the caller ensures that first).
 */
export class VariantAccessChecker {
  constructor(private readonly outputChannel?: vscode.OutputChannel) {}

  async check(variant: AidlcVariant): Promise<VariantAccessResult> {
    if (!isAccessGated(variant)) {
      return { accessible: true };
    }

    this.outputChannel?.appendLine(`Checking access to ${variant.label} (${variant.repoUrl})...`);
    try {
      // Plain git — no SSH. A short timeout keeps setup responsive even when
      // the host stalls. GIT_TERMINAL_PROMPT=0 makes an auth-required repo
      // fail fast instead of blocking on a credentials prompt.
      await Shell.run(`git ls-remote "${variant.repoUrl}"`, {
        timeout: 15000,
        env: { GIT_TERMINAL_PROMPT: '0' },
      });
      this.outputChannel?.appendLine(`Access OK: ${variant.label}`);
      return { accessible: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // git is not installed by the setup flow — if it's missing we CANNOT
      // determine access here. Skip the pre-check (report accessible) and let
      // the normal install surface a real RepoAccessError if there's no access.
      if (isGitUnavailable(message)) {
        this.outputChannel?.appendLine(
          `Access check skipped for ${variant.label}: git not available (${message})`
        );
        return { accessible: true, reason: GIT_UNAVAILABLE_SKIP };
      }

      this.outputChannel?.appendLine(`Access check failed for ${variant.label}: ${message}`);
      const reason =
        classifyAccessFailure(message, variant) ??
        `You don't have access to "${variant.label}". This version is restricted — ` +
          `make sure you're on the required network and signed in, or choose the open-source version instead.`;
      return { accessible: false, reason };
    }
  }
}
