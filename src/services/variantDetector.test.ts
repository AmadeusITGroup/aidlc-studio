import { describe, expect, it } from 'vitest';
import {
  AMADEUS_MARKER_PATTERN,
  PREVIEW_SUFFIX_PATTERN,
  classifyVariant,
  isPreviewVersion,
} from './variantDetector';

describe('classifyVariant', () => {
  it('classifies a plain awslabs semver as aws/release', () => {
    const result = classifyVariant('aidlc 2.9.1', '/usr/local/bin/aidlc');
    expect(result).toEqual({
      variantId: 'aws',
      channel: 'release',
      version: '2.9.1',
      versionSuffix: null,
    });
  });

  it('classifies an Amadeus release (marker, no suffix) as amadeus/release', () => {
    const result = classifyVariant(
      'aidlc 2.10.0 (amadeus)',
      '/home/u/.aidlc/bin/aidlc'
    );
    expect(result.variantId).toBe('amadeus');
    expect(result.channel).toBe('release');
    expect(result.version).toBe('2.10.0');
    expect(result.versionSuffix).toBeNull();
  });

  it('classifies an Amadeus preview (suffix) as amadeus/preview and keeps the suffix', () => {
    const result = classifyVariant('aidlc 2.10.0-1a.1.0.0', '/home/u/.aidlc/bin/aidlc');
    expect(result.variantId).toBe('amadeus');
    expect(result.channel).toBe('preview');
    expect(result.version).toBe('2.10.0');
    expect(result.versionSuffix).toBe('1a.1.0.0');
  });

  it('classifies the real Amadeus preview string as amadeus/preview', () => {
    // Real `aidlc --version` output from a Windows Amadeus PREVIEW install.
    const result = classifyVariant(
      'aidlc 2.10.0-1a.1.1.0-preview.3 (core 2.10.0, runtime 2.10.0)',
      'C:\\Users\\sns\\AppData\\Local\\aidlc\\bin\\aidlc.cmd'
    );
    expect(result.variantId).toBe('amadeus');
    expect(result.channel).toBe('preview');
    expect(result.version).toBe('2.10.0');
    expect(result.versionSuffix).toBe('1a.1.1.0-preview.3');
  });

  it('classifies a plain 2.10.0 release as release channel', () => {
    const result = classifyVariant('aidlc 2.10.0 (amadeus)', '/home/u/.aidlc/bin/aidlc');
    expect(result.channel).toBe('release');
  });

  it('detects amadeus from the binary path when stdout has no marker', () => {
    const result = classifyVariant(
      'aidlc 2.10.0',
      'C:\\Users\\u\\AppData\\Local\\amadeus-aidlc\\bin\\aidlc'
    );
    expect(result.variantId).toBe('amadeus');
    expect(result.channel).toBe('release');
  });

  it('defaults unknown/empty input to aws/release', () => {
    expect(classifyVariant('', '')).toEqual({
      variantId: 'aws',
      channel: 'release',
      version: null,
      versionSuffix: null,
    });
    expect(classifyVariant('no version here', '/usr/local/bin/aidlc')).toEqual({
      variantId: 'aws',
      channel: 'release',
      version: null,
      versionSuffix: null,
    });
  });
});

describe('isPreviewVersion', () => {
  it('treats a -preview token as preview (real string)', () => {
    expect(isPreviewVersion('2.10.0-1a.1.1.0-preview.3')).toBe(true);
  });

  it('treats any pre-release tail as preview', () => {
    expect(isPreviewVersion('2.10.0-1a.1.0.0')).toBe(true);
  });

  it('treats a plain release semver as not preview', () => {
    expect(isPreviewVersion('2.10.0')).toBe(false);
    expect(isPreviewVersion('aidlc 2.10.0')).toBe(false);
  });
});

describe('constants', () => {
  it('PREVIEW_SUFFIX_PATTERN captures the full real preview suffix', () => {
    expect('2.10.0-1a.1.1.0-preview.3'.match(PREVIEW_SUFFIX_PATTERN)?.[1]).toBe(
      '1a.1.1.0-preview.3'
    );
  });

  it('PREVIEW_SUFFIX_PATTERN matches the older preview suffix shape', () => {
    expect('2.10.0-1a.1.0.0'.match(PREVIEW_SUFFIX_PATTERN)?.[1]).toBe('1a.1.0.0');
  });

  it('AMADEUS_MARKER_PATTERN matches amadeus and artifactory markers', () => {
    expect(AMADEUS_MARKER_PATTERN.test('amadeus')).toBe(true);
    expect(AMADEUS_MARKER_PATTERN.test('ARTIFACTORY')).toBe(true);
    expect(AMADEUS_MARKER_PATTERN.test('awslabs')).toBe(false);
  });
});
