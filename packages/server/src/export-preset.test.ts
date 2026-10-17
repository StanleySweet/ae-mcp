import { describe, it, expect } from 'vitest';
import { planExportPreset } from './export-preset.js';

describe('planExportPreset', () => {
  it('plans a two-format preset with one resized copy and one output per format', () => {
    const targets = planExportPreset({ comp: 'Main', formats: ['16:9', '9:16'], outputDir: '/out' });

    expect(targets).toEqual([
      { format: '16:9', name: 'Main 16:9', width: 1920, height: 1080, output: '/out/Main 16x9.mov' },
      { format: '9:16', name: 'Main 9:16', width: 1080, height: 1920, output: '/out/Main 9x16.mov' },
    ]);
  });

  it('expands a custom naming pattern with the comp name and format', () => {
    const targets = planExportPreset({
      comp: 'Promo',
      formats: ['1:1'],
      outputDir: '/out',
      pattern: 'social_{comp}_{format}',
    });

    expect(targets[0]?.output).toBe('/out/social_Promo_1x1.mov');
  });

  it('keeps a slash in the comp name out of the file name', () => {
    const targets = planExportPreset({ comp: 'a/b', formats: ['1:1'], outputDir: '/out' });

    expect(targets[0]?.output).toBe('/out/a_b 1x1.mov');
  });

  it('refuses an unknown format and lists the allowed ones', () => {
    expect(() => planExportPreset({ comp: 'Main', formats: ['5:4'], outputDir: '/out' })).toThrow(
      /unknown format '5:4'; allowed formats: 16:9, 9:16, 1:1, 4:5, 21:9/,
    );
  });

  it('refuses an empty list, a repeated format and an unknown pattern token', () => {
    expect(() => planExportPreset({ comp: 'Main', formats: [], outputDir: '/out' })).toThrow(/at least one/);
    expect(() => planExportPreset({ comp: 'Main', formats: ['1:1', '1:1'], outputDir: '/out' })).toThrow(/twice/);
    expect(() =>
      planExportPreset({ comp: 'Main', formats: ['1:1'], outputDir: '/out', pattern: '{date}' }),
    ).toThrow(/unknown pattern token '\{date\}'/);
  });
});
