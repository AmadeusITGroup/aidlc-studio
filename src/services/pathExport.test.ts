import { describe, expect, it } from 'vitest';
import { buildPathExportBlock, nonInteractiveShellEnvFiles, planPathExport } from './pathExport';

describe('buildPathExportBlock', () => {
  it('embeds the marker as a comment and exports the bin dir onto PATH', () => {
    const block = buildPathExportBlock('AIDLC Studio — aidlc on PATH', '/home/dev/.local/bin');
    expect(block).toContain('# AIDLC Studio — aidlc on PATH');
    expect(block).toContain('export PATH="/home/dev/.local/bin:$PATH"');
  });
});

describe('nonInteractiveShellEnvFiles', () => {
  it('targets ~/.zshenv (zsh) and ~/.bashrc (bash), in that order', () => {
    const files = nonInteractiveShellEnvFiles('/home/dev');
    expect(files[0].endsWith('.zshenv')).toBe(true);
    expect(files[1].endsWith('.bashrc')).toBe(true);
  });
});

describe('planPathExport (marker / idempotency)', () => {
  const marker = 'AIDLC Studio — aidlc on PATH';
  const block = buildPathExportBlock(marker, '/home/dev/.local/bin');

  it('appends the block when the marker is absent', () => {
    const plan = planPathExport('# existing rc\n', block, marker);
    expect(plan.needsWrite).toBe(true);
    expect(plan.newContent).toBe('# existing rc\n' + block);
  });

  it('is a no-op when the marker is already present (idempotent)', () => {
    const alreadyThere = '# existing rc\n' + block;
    const plan = planPathExport(alreadyThere, block, marker);
    expect(plan.needsWrite).toBe(false);
    expect(plan.newContent).toBe(alreadyThere);
  });

  it('appends onto an empty file', () => {
    const plan = planPathExport('', block, marker);
    expect(plan.needsWrite).toBe(true);
    expect(plan.newContent).toBe(block);
  });

  it('does not write twice across repeated plans', () => {
    const first = planPathExport('', block, marker);
    const second = planPathExport(first.newContent, block, marker);
    expect(first.needsWrite).toBe(true);
    expect(second.needsWrite).toBe(false);
  });
});
