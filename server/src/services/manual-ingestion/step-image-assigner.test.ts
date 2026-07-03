import { describe, expect, it } from 'vitest';
import { sortStepImageFilenames, assignStepImageUrls } from './step-image-assigner.js';

describe('sortStepImageFilenames', () => {
  it('sorts filenames using numeric-aware (natural) sort order', () => {
    const files = [
      { filename: 'file10.jpg' },
      { filename: 'file2.jpg' },
      { filename: 'FILE1.jpg' },
    ];

    const sorted = sortStepImageFilenames(files);

    expect(sorted).toEqual([
      { filename: 'FILE1.jpg' },
      { filename: 'file2.jpg' },
      { filename: 'file10.jpg' },
    ]);
  });

  it('sorts filenames case-insensitively', () => {
    const files = [
      { filename: 'STEP-b.jpg' },
      { filename: 'step-a.jpg' },
    ];

    const sorted = sortStepImageFilenames(files);

    expect(sorted).toEqual([
      { filename: 'step-a.jpg' },
      { filename: 'STEP-b.jpg' },
    ]);
  });
});

describe('assignStepImageUrls', () => {
  it('assigns images 1:1 when counts match', () => {
    const hostedUrls = [
      'http://example.com/image1.jpg',
      'http://example.com/image2.jpg',
      'http://example.com/image3.jpg',
    ];

    const result = assignStepImageUrls(hostedUrls, 3);

    expect(result.stepImageUrls).toEqual([
      'http://example.com/image1.jpg',
      'http://example.com/image2.jpg',
      'http://example.com/image3.jpg',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('assigns available images and fills remaining steps with undefined when fewer images than steps', () => {
    const hostedUrls = [
      'http://example.com/image1.jpg',
      'http://example.com/image2.jpg',
    ];

    const result = assignStepImageUrls(hostedUrls, 3);

    expect(result.stepImageUrls).toEqual([
      'http://example.com/image1.jpg',
      'http://example.com/image2.jpg',
      undefined,
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('assigns only needed images and produces warning when more images than steps', () => {
    const hostedUrls = [
      'http://example.com/image1.jpg',
      'http://example.com/image2.jpg',
      'http://example.com/image3.jpg',
      'http://example.com/image4.jpg',
    ];

    const result = assignStepImageUrls(hostedUrls, 2);

    expect(result.stepImageUrls).toEqual([
      'http://example.com/image1.jpg',
      'http://example.com/image2.jpg',
    ]);
    expect(result.warnings).toEqual([
      '2 step image(s) were ignored: more images were uploaded than recipe steps.',
    ]);
  });
});
