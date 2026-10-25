import { ToolPalette } from '@eclipse-glsp/client';

// Our server's palette follows the loaded model's metamodel (#97), so re-request it on every
// model update: the stock palette only does that for ghost-element ("dynamic") items.
export class IstarToolPalette extends ToolPalette {
  protected override async setPaletteItems(): Promise<void> {
    await super.setPaletteItems();
    this.dynamic = true;
  }
}
