import { describe, expect, it } from 'vitest';
import {
  AMADEUS_MARKER_PATTERN,
  PRERELEASE_TAIL_PATTERN,
  classifyVariant,
} from './variantDetector';

describe('classifyVariant', () => {
  it('classifies a plain awslabs semver as aws', () => {
    const result = classifyVariant('aidlc 2.9.1', '/usr/local/bin/aidlc');
    expect(result).toEqual({
      variantId: 'aws',
      version: '2.9.1',
    });
  });

  it('classifies an Amadeus build (marker, no tail) as amadeus', () => {
    const result = classifyVariant(
      'aidlc 2.10.0 (amadeus)',
      '/home/u/.aidlc/bin/aidlc'
    );
    expect(result.variantId).toBe('amadeus');
    expect(result.version).toBe('2.10.0');
  });

  it('classifies an Amadeus build with a pre-release tail as amadeus', () => {
    const result = classifyVariant('aidlc 2.10.0-1a.1.0.0', '/home/u/.aidlc/bin/aidlc');
    expect(result.variantId).toBe('amadeus');
    expect(result.version).toBe('2.10.0');
  });

  it('classifies a real Amadeus version string with a long tail as amadeus', () => {
    // Real `aidlc --version` output shape from a Windows Amadeus install.
    const result = classifyVariant(
      'aidlc 2.10.0-1a.1.1.0 (core 2.10.0, runtime 2.10.0)',
      'C:\\Users\\sns\\AppData\\Local\\aidlc\\bin\\aidlc.cmd'
    );
    expect(result.variantId).toBe('amadeus');
    expect(result.version).toBe('2.10.0');
  });

  it('detects amadeus from the binary path when stdout has no marker', () => {
    const result = classifyVariant(
      'aidlc 2.10.0',
      'C:\\Users\\u\\AppData\\Local\\amadeus-aidlc\\bin\\aidlc'
    );
    expect(result.variantId).toBe('amadeus');
  });

  it('defaults unknown/empty input to aws', () => {
    expect(classifyVariant('', '')).toEqual({
      variantId: 'aws',
      version: null,
    });
    expect(classifyVariant('no version here', '/usr/local/bin/aidlc')).toEqual({
      variantId: 'aws',
      version: null,
    });
  });
});

describe('constants', () => {
  it('PRERELEASE_TAIL_PATTERN captures a full pre-release tail', () => {
    expect('2.10.0-1a.1.1.0'.match(PRERELEASE_TAIL_PATTERN)?.[1]).toBe('1a.1.1.0');
  });

  it('PRERELEASE_TAIL_PATTERN matches the shorter tail shape', () => {
    expect('2.10.0-1a.1.0.0'.match(PRERELEASE_TAIL_PATTERN)?.[1]).toBe('1a.1.0.0');
  });

  it('AMADEUS_MARKER_PATTERN matches amadeus and artifactory markers', () => {
    expect(AMADEUS_MARKER_PATTERN.test('amadeus')).toBe(true);
    expect(AMADEUS_MARKER_PATTERN.test('ARTIFACTORY')).toBe(true);
    expect(AMADEUS_MARKER_PATTERN.test('awslabs')).toBe(false);
  });
});
