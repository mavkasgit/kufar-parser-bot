import { IParser } from './IParser';
import { KufarParser } from './KufarParser';
import { OnlinerParser } from './OnlinerParser';
import { Platform } from '../types';

import { AvParser } from './AvParser';

// ... (imports)

export class ParserFactory {
  private static parsers: Map<Platform, IParser> = new Map<Platform, IParser>([
    ['kufar', new KufarParser()],
    ['onliner', new OnlinerParser()],
    ['av', new AvParser()],
  ]);

// ... (rest of the file)

  static getParser(platform: Platform): IParser | null {
    return this.parsers.get(platform) || null;
  }
}
